// ==UserScript==
// @name         VRoid Character Downloader
// @namespace    https://github.com/RubyDevil
// @version      1.0.0
// @description  Captures the VRM rendered on the page, including shader-side edits, and downloads it as a .vrm.
// @author       RubyDevil
// @license      MIT
// @homepageURL  https://github.com/RubyDevil/VRoid-Character-Downloader
// @supportURL   https://github.com/RubyDevil/VRoid-Character-Downloader/issues
// @downloadURL  https://raw.githubusercontent.com/RubyDevil/VRoid-Character-Downloader/main/vroid-character-downloader.user.js
// @updateURL    https://raw.githubusercontent.com/RubyDevil/VRoid-Character-Downloader/main/vroid-character-downloader.user.js
// @match        https://*.vroid.com/*
// @exclude-match https://*.vroid.com/playground*
// @exclude-match https://*.vroid.com/*/playground*
// @run-at       document-start
// @grant        none
// @inject-into  page
// ==/UserScript==

(() => {
  'use strict';
  let dismiss, job = null;

  // ── GPU capture: every three.js vertex shader also outputs its position after shader edits, before skinning
  const GL = WebGL2RenderingContext.prototype, { shaderSource, attachShader, linkProgram, drawElements, drawArrays } = GL;
  const MV = /vec4\s+mvPosition\s*=\s*vec4\(\s*transformed\s*,\s*1\.0\s*\)\s*;/, SKIN = /vec4\s+skinVertex\s*=\s*bindMatrix\s*\*/;
  const tf = new WeakSet(); // shaders + programs carrying vrmgrab_pos

  GL.shaderSource = function (sh, src) {
    if (MV.test(src)) {
      src = src.replace(/\bvoid\s+main\s*\(/, 'out vec3 vrmgrab_pos;\n$&')
        .replace(SKIN, 'vrmgrab_pos = transformed;\n$&')
        .replace(MV, '#ifndef USE_SKINNING\nvrmgrab_pos = transformed;\n#endif\n$&');
      tf.add(sh);
    }
    return shaderSource.call(this, sh, src);
  };
  GL.attachShader = function (p, sh) { if (tf.has(sh)) tf.add(p); return attachShader.call(this, p, sh); };
  GL.linkProgram = function (p) {
    if (tf.has(p)) this.transformFeedbackVaryings(p, ['vrmgrab_pos'], this.SEPARATE_ATTRIBS);
    return linkProgram.call(this, p);
  };
  const hook = draw => function (...args) {
    const j = job;
    job = null;
    const r = draw.apply(this, args);
    if (j) { j.restore(); if (tf.has(this.getParameter(this.CURRENT_PROGRAM))) j.done(readBack(this, j.count)); }
    return r;
  };
  GL.drawElements = hook(drawElements);
  GL.drawArrays = hook(drawArrays);

  // Redraw the mesh just drawn as invisible points with transform feedback → positions in vertex order
  function readBack(gl, n) {
    const out = new Float32Array(n * 3), buf = gl.createBuffer(), t = gl.createTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, t);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, n * 12, gl.STREAM_READ);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    drawArrays.call(gl, gl.POINTS, 0, n);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.deleteTransformFeedback(t);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    gl.deleteBuffer(buf);
    return out;
  }

  // Arm meshes for their next draw (blendshapes zeroed so expressions aren't baked in)
  const captureGpu = meshes => new Promise(resolve => {
    const res = new Map(), saved = new Map(meshes.map(m => [m, [m.onBeforeRender, m.frustumCulled]]));
    const release = m => { if (saved.has(m)) { [m.onBeforeRender, m.frustumCulled] = saved.get(m); saved.delete(m); } };
    const finish = () => { clearTimeout(timer); saved.forEach((_, m) => release(m)); resolve(res); };
    for (const [m, [obr]] of saved) {
      m.frustumCulled = false;
      m.onBeforeRender = function (...a) {
        const inf = m.morphTargetInfluences, keep = inf?.slice();
        job?.restore();
        inf?.fill(0);
        job = {
          count: m.geometry.attributes.position.count,
          restore: () => keep?.forEach((v, i) => (inf[i] = v)),
          done: out => { res.set(m, out); release(m); if (!saved.size) finish(); },
        };
        return obr.apply(this, a);
      };
    }
    const timer = setTimeout(finish, 2000);
  });

  // ── GLTFParser's constructor does `this.associations = new Map()` → catch every VRM parser
  Object.defineProperty(Object.prototype, 'associations', {
    configurable: true,
    get() {},
    set(map) {
      Object.defineProperty(this, 'associations', { value: map, writable: true, enumerable: true, configurable: true });
      const ext = this.json?.extensions;
      if (ext?.VRMC_vrm || ext?.VRM) watch(this, map);
    },
  });

  // Show the popup right before the first of the parser's meshes is drawn
  function watch(parser, map) {
    const orig = new Map(), set = map.set;
    let fired = false;
    map.set = function (obj, v) {
      if (obj?.isMesh && !fired && !orig.has(obj)) {
        const fn = obj.onBeforeRender;
        orig.set(obj, fn);
        obj.onBeforeRender = function (...args) {
          if (!fired) {
            fired = true;
            orig.forEach((o, m) => (m.onBeforeRender = o));
            try { show(parser); } catch (e) { console.error('[vrm-grabber]', e); }
          }
          return fn.apply(this, args);
        };
      }
      return set.call(this, obj, v);
    };
  }

  // ── Export: original GLB with every mesh primitive rewritten from the live geometry
  const NAMES = { position: 'POSITION', normal: 'NORMAL', tangent: 'TANGENT', uv: 'TEXCOORD_0', uv1: 'TEXCOORD_1',
    uv2: 'TEXCOORD_2', uv3: 'TEXCOORD_3', color: 'COLOR_0', skinIndex: 'JOINTS_0', skinWeight: 'WEIGHTS_0' };
  const TYPES = [, 'SCALAR', 'VEC2', 'VEC3', 'VEC4'];
  const COMPONENT = new Map([[Int8Array, 5120], [Uint8Array, 5121], [Int16Array, 5122],
    [Uint16Array, 5123], [Uint32Array, 5125], [Float32Array, 5126]]);

  function exportVrm(parser, gpu) {
    const { content, body: bin } = parser.extensions.KHR_binary_glTF, json = JSON.parse(content), assoc = parser.associations;
    const cache = new Map(), claimed = new Set();

    // new accessor for arr, reusing the original accessor slot if free; shared three attributes are written once
    const put = (orig, key, arr, size, normalized, target, isPos) => {
      if (cache.has(key)) return cache.get(key);
      const acc = { componentType: COMPONENT.get(arr.constructor), count: arr.length / size, type: TYPES[size],
        bufferView: json.bufferViews.push({ buffer: 0, byteLength: arr.byteLength, target,
          data: new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength) }) - 1 };
      if (normalized) acc.normalized = true;
      if (isPos) {
        acc.min = [Infinity, Infinity, Infinity]; acc.max = [-Infinity, -Infinity, -Infinity];
        arr.forEach((v, i) => { const k = i % 3; if (v < acc.min[k]) acc.min[k] = v; if (v > acc.max[k]) acc.max[k] = v; });
      }
      const idx = orig != null && !claimed.has(orig) ? ((json.accessors[orig] = acc), orig) : json.accessors.push(acc) - 1;
      claimed.add(idx);
      cache.set(key, idx);
      return idx;
    };

    // three's skinIndex points into mesh.skeleton.bones; glTF JOINTS point into skin.joints
    const remapJoints = (mesh, arr) => {
      const joints = json.skins?.[json.nodes[assoc.get(mesh)?.nodes ?? assoc.get(mesh.parent)?.nodes]?.skin]?.joints;
      if (!joints) return arr;
      const map = mesh.skeleton.bones.map(b => Math.max(0, joints.indexOf(assoc.get(b)?.nodes)));
      return arr.map(j => map[j] ?? 0);
    };

    for (const [mesh, a] of assoc) {
      if (!mesh?.isMesh || a.primitives === undefined) continue;
      const prim = json.meshes[a.meshes].primitives[a.primitives], g = mesh.geometry, old = prim.attributes;
      prim.attributes = {};
      for (const [name, attr] of Object.entries(g.attributes)) {
        const key = NAMES[name] ?? name.toUpperCase(), fromGpu = key === 'POSITION' && gpu.get(mesh);
        let arr = fromGpu || attr.array;
        if (key === 'JOINTS_0' && mesh.skeleton) arr = remapJoints(mesh, arr);
        prim.attributes[key] = put(old[key], fromGpu || attr, arr, attr.itemSize, attr.normalized, 34962, key === 'POSITION');
      }
      if (g.index) prim.indices = put(prim.indices, g.index, g.index.array, 1, false, 34963);
      if (g.morphAttributes.position?.length) {
        prim.targets = g.morphAttributes.position.map((p, i) => {
          const n = g.morphAttributes.normal?.[i], t = { POSITION: put(prim.targets?.[i]?.POSITION, p, p.array, 3, false, 34962, true) };
          if (n) t.NORMAL = put(prim.targets?.[i]?.NORMAL, n, n.array, 3, false, 34962);
          return t;
        });
      }
    }

    // rebuild BIN with only the buffer views still referenced
    const oldViews = json.bufferViews, remap = new Map(), parts = [];
    let len = 0;
    json.bufferViews = [];
    const view = i => {
      if (!remap.has(i)) {
        const { data, ...v } = oldViews[i], bytes = data || new Uint8Array(bin, v.byteOffset || 0, v.byteLength);
        len += (4 - (len % 4)) % 4;
        parts.push([len, bytes]);
        remap.set(i, json.bufferViews.push({ ...v, byteOffset: len }) - 1);
        len += bytes.byteLength;
      }
      return remap.get(i);
    };
    (function walk(o) {
      for (const k in o) {
        if (k === 'bufferView' && typeof o[k] === 'number') o[k] = view(o[k]);
        else if (o[k] && typeof o[k] === 'object' && o[k] !== json.bufferViews) walk(o[k]);
      }
    })(json);
    json.buffers = [{ byteLength: len }];

    // write GLB
    const jb = new TextEncoder().encode(JSON.stringify(json));
    const jl = Math.ceil(jb.length / 4) * 4, bl = Math.ceil(len / 4) * 4;
    const out = new Uint8Array(28 + jl + bl), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
    dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true);
    out.set(jb, 20); out.fill(0x20, 20 + jb.length, 20 + jl);
    dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004E4942, true);
    for (const [off, bytes] of parts) out.set(bytes, 28 + jl + off);
    return out;
  }

  // ── Popup
  function findThumb() {
    const a = [...document.querySelectorAll('a[href]')].find(a => a.getAttribute('href') === location.pathname);
    if (!a) return null;
    const m = a.innerHTML.match(/https?:\/\/[^"'\s)]+?\.(?:png|jpe?g|webp|gif|avif)(?:\?[^"'\s)]*)?/i);
    if (m) return m[0].replace(/&amp;/g, '&');
    const prev = a.previousElementSibling;
    return a.querySelector('img')?.src || (prev?.tagName === 'IMG' && prev.src) || null;
  }

  function show(parser) {
    dismiss?.(true);
    const ext = parser.json.extensions, meta = (ext.VRMC_vrm || ext.VRM).meta || {};
    const name = String(meta.name || meta.title || 'Untitled VRM');
    const author = [].concat(meta.authors || meta.author || []).join(', ');
    const size = parser.extensions.KHR_binary_glTF?.body?.byteLength || 0;

    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host{all:initial;position:fixed;top:20px;right:20px;z-index:2147483647;
        font:13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#f4f4f6}
      .card{position:relative;display:flex;gap:14px;width:340px;max-width:calc(100vw - 40px);box-sizing:border-box;padding:14px;
        background:rgba(20,20,26,.82);backdrop-filter:blur(20px) saturate(1.6);-webkit-backdrop-filter:blur(20px) saturate(1.6);
        border:1px solid rgba(255,255,255,.08);border-radius:16px;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 24px 60px -16px rgba(0,0,0,.65),0 4px 14px rgba(0,0,0,.3);
        animation:in .38s cubic-bezier(.2,.9,.3,1.15) both}
      .card.out{animation:out .2s ease-in forwards}
      @keyframes in{from{opacity:0;transform:translateY(-10px) scale(.97)}}
      @keyframes out{to{opacity:0;transform:translateY(-6px) scale(.97)}}
      .thumb{flex:none;width:96px;height:96px;border-radius:11px;overflow:hidden;display:grid;place-items:center;
        background:linear-gradient(135deg,#3a3a52,#20202b);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);
        font-size:11px;font-weight:700;letter-spacing:.1em;color:rgba(255,255,255,.3)}
      .thumb img{width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s}
      .body{flex:1;min-width:0;display:flex;flex-direction:column}
      .eyebrow{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:600;letter-spacing:.08em;
        text-transform:uppercase;color:rgba(255,255,255,.5)}
      .eyebrow i{width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.18)}
      .title{margin:4px 22px 1px 0;font-size:15px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sub{font-size:12px;color:rgba(255,255,255,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .btn{margin-top:auto;display:flex;align-items:center;justify-content:center;gap:7px;width:100%;height:32px;
        padding:0;border:0;border-radius:9px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;
        background:#f4f4f6;color:#111;transition:background .15s,transform .15s,box-shadow .15s}
      .btn:hover{background:#fff;transform:translateY(-1px);box-shadow:0 6px 16px -6px rgba(255,255,255,.35)}
      .btn:active{transform:none}
      .x{position:absolute;top:10px;right:10px;width:24px;height:24px;padding:0;border:0;border-radius:7px;cursor:pointer;
        display:grid;place-items:center;background:transparent;color:rgba(255,255,255,.45);transition:background .15s,color .15s}
      .x:hover{background:rgba(255,255,255,.08);color:#fff}
      .card{flex-wrap:wrap}
      .foot{flex-basis:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;
        margin-top:-2px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07)}
      .warn{display:flex;align-items:center;gap:4px;min-width:0;font-size:10px;line-height:1.3;color:#fbbf24;white-space:nowrap}
      .warn b{font-weight:inherit;overflow:hidden;text-overflow:ellipsis}
      .warn svg{flex:none}
      .star{flex:none;display:flex;white-space:nowrap;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:8px;
        font-size:11.5px;font-weight:600;color:#fff;text-decoration:none;background:linear-gradient(135deg,#6366f1,#a855f7);
        box-shadow:0 4px 14px -4px rgba(168,85,247,.6);transition:transform .15s,box-shadow .15s}
      .star:hover{transform:translateY(-1px);box-shadow:0 6px 18px -4px rgba(168,85,247,.85)}
    </style>
    <div class="card">
      <div class="thumb">VRM</div>
      <div class="body">
        <div class="eyebrow"><i></i>VRM captured</div>
        <div class="title"></div>
        <div class="sub"></div>
        <button class="btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14"/></svg>Download .vrm</button>
      </div>
      <button class="x" aria-label="Dismiss"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="foot">
        <span class="warn"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3zM12 10v4M12 17h.01"/></svg><b>Only download what's allowed</b></span>
        <a class="star" href="https://github.com/RubyDevil/VRoid-Character-Downloader" target="_blank" rel="noopener"><svg width="12" height="12"
          viewBox="0 0 24 24" fill="#fde047"><path d="m12 2 3 6.6 7 .7-5.3 4.8 1.6 7L12 17.5 5.7 21.1l1.6-7L2 9.3l7-.7z"/></svg>Star on GitHub</a>
      </div>
    </div>`;

    const $ = s => root.querySelector(s);
    $('.title').textContent = $('.title').title = name;
    $('.sub').textContent = [author, 'VRM ' + (ext.VRMC_vrm ? '1.0' : '0.x'), (size / 1048576).toFixed(1) + ' MB'].filter(Boolean).join(' · ');

    $('.btn').onclick = async () => {
      const label = $('.btn').lastChild;
      label.textContent = 'Preparing…';
      try {
        const gpu = await captureGpu([...parser.associations.keys()].filter(o => o?.isMesh));
        for (const [m, p] of gpu) {          // drop unchanged meshes so shared vertex buffers stay shared
          const cpu = m.geometry.attributes.position.array;
          if (p.every((v, i) => Math.abs(v - cpu[i]) < 1e-6)) gpu.delete(m);
        }
        const url = URL.createObjectURL(new Blob([exportVrm(parser, gpu)], { type: 'model/gltf-binary' }));
        const a = Object.assign(document.createElement('a'), {
          href: url, download: name.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 120) + '.vrm' });
        document.documentElement.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        label.textContent = 'Download .vrm';
      } catch (e) {
        console.error('[vrm-grabber] export failed', e);
        label.textContent = 'Export failed (see console)';
      }
    };

    let tries = 0;
    (function poll() {
      const src = findThumb();
      if (!src) return void (++tries < 20 && setTimeout(poll, 500));
      const img = new Image();
      img.onload = () => { $('.thumb').textContent = ''; $('.thumb').append(img); requestAnimationFrame(() => (img.style.opacity = 1)); };
      img.src = src;
    })();

    dismiss = instant => {
      dismiss = null;
      instant ? host.remove() : ($('.card').classList.add('out'), setTimeout(() => host.remove(), 200));
    };
    $('.x').onclick = () => dismiss?.();
    document.documentElement.appendChild(host);
  }

  // Unblur toggle (bottom-right): strips the site's inline filter: blur(...), on by default, saved in localStorage.
  let unblurOn = true;
  try { unblurOn = localStorage.vrmgrabUnblur !== '0'; } catch {}
  const unblur = Object.assign(document.createElement('style'), { textContent: '[style*="blur("]{filter:none!important}' });
  const tgl = document.createElement('button');
  tgl.style.cssText = 'all:unset;position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:7px 12px;border-radius:999px;' +
    'background:rgba(18,18,22,.85);color:#fff;font:500 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  const setUnblur = on => {
    unblurOn = on;
    try { localStorage.vrmgrabUnblur = +on; } catch {}
    on ? document.documentElement.append(unblur) : unblur.remove();
    tgl.textContent = `Unblur: ${on ? 'on' : 'off'}`;
    tgl.style.opacity = on ? 1 : 0.6;
  };
  tgl.onclick = () => setUnblur(!unblurOn);
  setUnblur(unblurOn);
  addEventListener('DOMContentLoaded', () => document.documentElement.append(tgl));
})();
