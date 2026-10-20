# Third-party notices

Kino's own code is in this repository. These are the other people's work it
uses, adapts or fetches.

## Code adapted into Kino

**Open Generative AI** (MIT), https://github.com/anil-matcha/open-generative-ai.
The approach to resumable model downloads and to choosing stable-diffusion.cpp's
release build per platform, in `src/engine/download.mjs` and
`src/engine/catalog.mjs`, follows its `electron/lib/localInference.js` and
`electron/lib/localInferenceAssets.js`.

```
MIT License

Copyright (c) 2026 Open Generative AI Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**ComfyUI workflow templates** (Comfy-Org): the workflows in `workflows/` are
built from them by `scripts/build-workflows.mjs`.

## Shipped with Kino

- **Electron** (MIT) and **Chromium** (BSD-style and others): the desktop app.
  Their licence files are inside every installer.
- **Inter**, **Instrument Serif** and **JetBrains Mono** (SIL Open Font
  Licence 1.1): `public/fonts/`.
- **Claude SDK** `@anthropic-ai/sdk` (MIT), optional, for writing help.
- **The Metal engine build** for Apple Silicon, published by
  `.github/workflows/engine.yml`: stable-diffusion.cpp and ggml (both MIT),
  with their licence files inside the zip.

## Fetched by Kino on your machine, not distributed with it

- **stable-diffusion.cpp** (MIT), https://github.com/leejet/stable-diffusion.cpp,
  from its own releases, when you install This computer's engine.
- **ffmpeg** (GPL builds), from BtbN's FFmpeg-Builds on Windows and Martin
  Riedl's builds on macOS, only if your computer has no ffmpeg.
- **Model weights** for each pack, from Hugging Face and GitHub, listed with
  their sources in `src/engine/catalog.mjs`. Each model has its own licence,
  and some restrict commercial use: read the model's page before using its
  results in ads.
- **runpod/worker-comfyui** (AGPL-3.0), which the RunPod Serverless image in
  `runpod/` builds on without modifying it.
