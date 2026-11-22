<img width="2172" height="724" alt="Vroid Character Downloader Shader Research" src="https://github.com/user-attachments/assets/f0d7fdc3-e160-4e8a-83cf-41b425f9fdc5" />

# VRoid Character Downloader — Shader Research

<p align="center">
  <strong>Educational Research Project</strong>
  <br/>
  Three.js • WebGL • GPU Vertex Capture • VRM Reconstruction
</p>

<p align="center">
  <a href="https://raw.githubusercontent.com/RubyDevil/VRoid-Character-Downloader/main/vroid-character-downloader.user.js"><img alt="Install userscript" width="360" src="assets/install-button.svg" /></a>
  <br/>
  <sub>Requires a userscript manager such as <a href="https://www.tampermonkey.net/">Tampermonkey</a> or <a href="https://violentmonkey.github.io/get-it/">Violentmonkey</a>.</sub>
</p>

## About

VRoid Character Downloader is an experimental educational research project that explores how 3D character geometry can be captured from a browser-based three.js rendering environment and reconstructed into a downloadable VRM file.

The project investigates GPU vertex capture, shader instrumentation, and VRM binary reconstruction to study how character geometry is processed between the original model data and the final rendered result.

Its functionality allows users to download reconstructed VRM character files from compatible environments.

> [!IMPORTANT]
> This project is intended for educational research, personal experimentation, and authorized model preservation.

## Features

- **Character geometry capture:** Captures GPU-processed vertex positions.
- **Shader instrumentation:** Observes vertex positions after editor shader modifications.
- **Transform feedback:** Uses WebGL transform feedback to capture vertex data.
- **Blendshape handling:** Accounts for blendshape data during reconstruction.
- **Skeleton mapping:** Preserves the relationship between runtime bone indices and original skeleton structures.
- **VRM reconstruction:** Reconstructs mesh data and associated attributes.
- **Binary repacking:** Updates relevant VRM file structures and offsets.
- **VRM export:** Produces a downloadable `.vrm` file.

## How It Works

### 1. Shader Instrumentation

The script modifies three.js vertex shaders during compilation to expose an additional vertex-position output.

This output represents the vertex position after editor shader modifications but before skeletal deformation.

### 2. Transform Feedback

WebGL transform feedback is configured to capture the additional shader output when the relevant shader programs are linked.

### 3. Character Capture

During the download process, the character meshes are temporarily configured for a dedicated capture pass.

A separate rendering pass processes one point per vertex, writing captured positions into a GPU buffer while preserving vertex order.

### 4. GPU Readback

The captured vertex buffer is transferred into JavaScript memory.

Captured positions are compared against the original geometry to identify modified vertex data.

### 5. VRM Reconstruction

The original VRM data and three.js loader mappings are used to associate captured geometry with the corresponding source structures.

The reconstruction accounts for:

- Vertex attributes.
- Triangle and index data.
- Blendshape information.
- Shared mesh data.
- Skeleton and bone index mappings.

### 6. File Repacking

The reconstructed data is written into the VRM structure.

Relevant offsets are updated, unused data is removed where appropriate, and original file data is retained wherever possible.

### 7. Download

The reconstructed character is exported as a `.vrm` file.

## Research Goals

This project explores several areas of computer graphics and 3D model interoperability:

- GPU-based geometry capture.
- Three.js shader modification.
- WebGL transform feedback.
- Runtime-to-source geometry mapping.
- VRM binary serialization.
- Character model preservation and interoperability.

## Responsible Use & Copyright

This project is published for educational research and technical experimentation.

> [!WARNING]
> Users must only download, reconstruct, modify, or redistribute characters when they have the necessary rights or authorization.

Please respect:

- Original character creators and artists.
- VRoid and platform terms of service.
- Model-specific licenses.
- Copyright and intellectual property rights.
- Restrictions on redistribution and commercial use.

Downloading a character does not transfer ownership or grant permission to redistribute it.

> [!CAUTION]
> Do not use this software to obtain or redistribute characters without authorization.

## Disclaimer

This project is independent and is not affiliated with or endorsed by VRoid, Pixiv, or any third-party character platform.

The software is provided as-is, without warranties or guarantees.

The developer is not responsible for misuse, unauthorized downloads, or violations of third-party rights or platform terms.

## License

The source code license applies only to this project's original code.

> [!NOTE]
> It does not grant rights to third-party characters, models, textures, or other assets processed using the software.

<p align="center">
  <strong>For educational research and authorized character preservation.</strong>
</p>
