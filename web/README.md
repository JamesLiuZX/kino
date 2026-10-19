# Kino web demo

The studio's real interface with the server swapped for an engine that runs in
the page, so Kino can be tried on a static host with no GPU, no ffmpeg and no
uploads. It's what [jamesliuzx.com/kino](https://jamesliuzx.com/kino/) serves.
Two real models run on the visitor's device: IS-Net for background removal and
Real-ESRGAN for upscaling.

| File | What it does |
|---|---|
| `engine.mjs` | Answers the same `/api` routes as `src/server.mjs`, from memory: library, jobs, ads, brands. The interface reaches it through `window.kinoDemo` (see `api()` and `upload()` in `public/js/ui.mjs` and `connect()` in `public/js/main.mjs`). |
| `render.mjs` | Camera moves (the instant mode's maths from `src/media/motion.mjs`), the ad edit (the server's caption and end-card layout from `src/ads/captions.mjs`, plus a soft music bed), talking photos and labelled stand-ins for AI stills, all recorded with MediaRecorder. |
| `ai.mjs` | The two in-browser models, on ONNX Runtime Web: WebGPU when the device has it, WebAssembly otherwise, and WebAssembly again if the graphics chip fails or stalls mid-run. Models download once, with progress, into the browser's cache. Cut-outs feed "Remove the background" and put an uploaded product into "Product photo, new scene"; upscaling works in overlapping tiles. |
| `models/` | Not in git. `cutout.onnx` (IS-Net general use, Apache-2.0: 178 MB cut to its final mask with 8-bit per-channel weights, 47 MB) and `upscale.onnx` (Real-ESRGAN general x4v3, BSD-3-Clause, with its default denoise strength baked in, 5 MB), made from the projects' releases by `scripts/web-models.py`, which checks each against its original. |
| `build.mjs` | Assembles a static folder: `public/`, the engine, the server modules it shares (presets, prompts, ad templates, compliance, captions), the brand files, the seed, the models with a manifest that names each by its hash, and the parts of ONNX Runtime Web that run them. `--strict` fails if the models or the runtime are missing; without it the demo is built with stand-ins in their place. |
| `export-seed.mjs` | Exports the starting library (brand photos, two finished ads, two camera moves) from a running Kino. |
| `seed/` | That library. Videos are re-encoded to 720p for the web. |

```bash
npm install                                   # ONNX Runtime Web
pip install onnx onnxruntime numpy
python3 scripts/web-models.py                 # the two models, into web/models
node web/build.mjs ../public/kino --strict    # the portfolio's deploy does all this on every push
npx serve ../public                           # then open /kino/
```

What's real and what isn't, as the demo's Settings page says: camera moves, ad
scripts (from the approved templates), the compliance check, the finished ad
edit, background removal and photo upscaling are real, and results say which
model made them. Generated images, AI video, photo edits, talking photos and
video upscaling need the models on a GPU, so they come back as stand-ins marked
"Demo". Nothing is uploaded or saved; reloading starts fresh.

`test/web.test.mjs` keeps it honest: the build must succeed, every shared
module must stay free of Node built-ins, the seed must point at real files, and
the models and runtime files must land where `ai.mjs` looks for them.
