# Kino on the web

The studio's real interface with the server swapped for an engine that runs in
the page, so Kino works from a static host with no server, no GPU and no ffmpeg.
It's what [jamesliuzx.com/kino](https://jamesliuzx.com/kino/) serves. With the
visitor's own fal.ai key the AI apps run for real on fal.ai; without one, two
models still run on the visitor's device (IS-Net for background removal,
Real-ESRGAN for upscaling) and the rest are labelled stand-ins.

| File | What it does |
|---|---|
| `engine.mjs` | Answers the same `/api` routes as `src/server.mjs`: library, jobs, ads, brands, recipes and their runs (with the studio's own recipe engine, `src/recipes.mjs`). Jobs run in two lanes: the page's own work one at a time, fal.ai jobs four at once. The interface reaches it through `window.kinoDemo` (see `api()` and `upload()` in `public/js/ui.mjs` and `connect()` in `public/js/main.mjs`). |
| `cloud.mjs` | The AI apps on fal.ai with the visitor's key: which endpoint each app uses and what it sends, then fal's queue (submit, follow, fetch the result, cancel). The key is kept in `localStorage` and sent only to fal; photos go as data URIs; results are fetched into the library. `scripts/check-cloud.mjs` (the weekly *Cloud models* workflow) checks every endpoint and field against fal's published schemas, and that fal still lets a page call it. |
| `keep.mjs` | The library (with its files), jobs, ads, recipes and runs in IndexedDB, so they're there next visit. If the browser won't keep anything (a private window), the page works and forgets on reload. |
| `render.mjs` | Camera moves (the instant mode's maths from `src/media/motion.mjs`), the ad edit (the server's caption and end-card layout from `src/ads/captions.mjs`, plus a soft music bed), talking photos and labelled stand-ins for AI stills, all recorded with MediaRecorder. |
| `ai.mjs` | The two in-browser models, on ONNX Runtime Web: WebGPU when the device has it, WebAssembly otherwise, and WebAssembly again if the graphics chip fails or stalls mid-run. Models download once, with progress, into the browser's cache. Cut-outs feed "Remove the background" and put an uploaded product into "Product photo, new scene"; upscaling works in overlapping tiles. |
| `models/` | Not in git. `cutout.onnx` (IS-Net general use, Apache-2.0: 178 MB cut to its final mask with 8-bit per-channel weights, 47 MB) and `upscale.onnx` (Real-ESRGAN general x4v3, BSD-3-Clause, with its default denoise strength baked in, 5 MB), made from the projects' releases by `scripts/web-models.py`, which checks each against its original. The *Web models* workflow publishes them as the `web-models` release, and `build.mjs --fetch-models` downloads them from there, so any host can build the site. |
| `build.mjs` | Assembles a static folder: `public/`, the engine, the server modules it shares (presets, prompts, ad templates, compliance, captions), the brand files, the seed, the models with a manifest that names each by its hash, and the parts of ONNX Runtime Web that run them. `--strict` fails if the models or the runtime are missing; without it the demo is built with stand-ins in their place. |
| `export-seed.mjs` | Exports the starting library (brand photos, two finished ads, two camera moves) from a running Kino. |
| `seed/` | That library. Videos are re-encoded to 720p for the web. |

```bash
npm install                                   # ONNX Runtime Web
pip install onnx onnxruntime numpy
python3 scripts/web-models.py                 # the two models, into web/models
node web/build.mjs ../public/kino --strict    # add --fetch-models to skip the two lines above
npx serve ../public                           # then open /kino/
```

jamesliuzx.com is served by Vercel. Every deploy of the portfolio
(JamesLiuZX/james-portfolio) runs its `scripts/build-kino.mjs` first: it
clones this repo's main, installs ONNX Runtime Web and runs
`web/build.mjs public/kino --strict --fetch-models`. Then `next build` copies
the result into the site at `/kino/`.

```text
kino main ──push──▶ Website workflow ──deploy hook──▶ Vercel: build-kino.mjs, next build ──▶ jamesliuzx.com/kino/
```

What's real, as the site's Settings page says: camera moves, reframing, ad
scripts (from the approved templates), the compliance check and the finished ad
edit always are. With a fal.ai key, so are generated images, photo edits,
cut-outs, AI video with sound, talking photos, upscaling and smoother motion,
each saying which model made it. Without one, background removal and photo
upscaling run on the device and the other AI apps come back as stand-ins
marked "Demo". Nothing goes to Kino's site: the library stays in the browser,
and AI jobs go from the browser straight to fal.ai.

`test/web.test.mjs` keeps it honest: the build must succeed, every shared
module must stay free of Node built-ins, the seed must point at real files, and
the models and runtime files must land where `ai.mjs` looks for them.

The *Website* workflow asks Vercel to rebuild the site when main changes
what it's built from, if the `VERCEL_DEPLOY_HOOK` secret holds a deploy hook
for the portfolio. It also checks the live site every day
(`scripts/check-website.mjs`): it reports where the domain points and which
host answers. The build records the commit it was made from,
so the workflow can tell when main has changed the website since the last
deploy. It then opens the site in Chromium and WebKit (Safari's engine) and
checks that it starts without errors or missing files, that it has Recipes
and the fal.ai key card, and that it switches to fal.ai once a key is saved.
