# Kino

An AI image and video studio with a one-box interface. Type a line, pick a
camera move, press Generate. Kino runs 2026's best open models **on your own
computer** (no account, no key), on your own GPU server through ComfyUI, or on
RunPod. Its Ad Studio turns a brand profile into finished, captioned TikTok and
Meta ads that have been checked against health-ad rules.

## Get it

**Desktop app** for Mac (Apple Silicon and Intel), Windows and Linux: download
it from [Releases](https://github.com/JamesLiuZX/kino/releases). On first run
it looks at your computer, suggests the model packs to start with, and sets up
the engine and those packs in one go (Fast images is about 7 GB, once).
Until the builds are notarized, macOS says it can't verify Kino the first time:
click **Done**, then System Settings → Privacy & Security → **Open Anyway**
(the installer window says so too). Windows shows SmartScreen: More info → Run
anyway. Signing them for good takes an Apple Developer ID:
[docs/signing.md](docs/signing.md).

**From source** (Node 22+; ffmpeg recommended):

```bash
git clone https://github.com/JamesLiuZX/kino && cd kino
node server.mjs          # the studio in your browser at http://localhost:7860
npm install && npm run desktop   # or as the desktop app
```

From source it starts in **demo mode**: every tool works and produces real files
(placeholder renders, real camera moves, real ad edits), so you can try the
whole studio before choosing where models run. Change it in **Settings**.

## This computer

Kino runs the models itself with [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp):
one small program with Metal on Apple Silicon, Vulkan or CUDA on PCs and a CPU
path everywhere. No Python, no CUDA toolkit, no account. The first-run guide
(`#/welcome`, or Settings → This computer piece by piece) installs it for your
machine (and ffmpeg on Mac and Windows if you don't have it), then downloads
the model packs you want, once:

| Pack | Model | Makes | Download | Memory |
|---|---|---|---|---|
| Fast images | Z-Image-Turbo (GGUF) | Image · Fast | about 7 GB | 12 GB+ |
| Pro images, edits and cut-outs | Qwen Image 2.1 Turbo | Image · Pro, Edit, Cut out | about 17 GB | 32 GB+ |
| Video drafts | Wan 2.2 5B | Video · Draft | about 17 GB | 24 GB+ |
| Upscaling | Real-ESRGAN x4 | Upscale image | 67 MB | 4 GB+ |

Smooth motion uses ffmpeg's motion-compensated interpolation, and instant
camera moves and the Ad Studio's editor need only ffmpeg. MiniMax H3 (video with
sound), LTX-2.3 (talking photos) and SeedVR2 (video upscaling) are too big for
most personal computers; those apps say so and run on a GPU server. The engine
keeps one pack loaded between jobs and frees the memory after ten idle minutes,
and while it works the picture sharpens on the stage, step by step.
Packs live in the data folder (`KINO_ENGINE_DIR` moves them); **Advanced** lets
you use your own stable-diffusion.cpp build, pin a release, or download the
models from a Hugging Face mirror where Hugging Face is slow or blocked
(`HF_ENDPOINT`, as huggingface_hub reads it).

## Try it in your browser

[jamesliuzx.com/kino](https://jamesliuzx.com/kino/) is Kino on the web: this
interface with the server swapped for an engine in the page
([web/](web/README.md)), nothing to install. Paste a
[fal.ai key](https://fal.ai/dashboard/keys) in Settings and every AI app runs
for real on fal.ai, with the same open models as the desktop app (Z-Image, Qwen
Image and Qwen Image Edit, LTX-2 with sound, Wan 2.2, InfiniteTalk, SeedVR2,
BiRefNet, FILM), billed to the visitor's own fal.ai account. The key stays in
that browser and goes only to fal.ai. Recipes run there too, and the library,
recipes and runs are kept in the browser between visits.

Camera moves, reframing, ad scripts, the compliance check and the finished ad
edit run in the page. Without a key, background removal (IS-Net) and photo
upscaling (Real-ESRGAN) still run on the visitor's device with WebGPU or
WebAssembly, and the other AI apps return labelled stand-ins.

## What's inside

Two depths over the same engine, switched from the top bar (Kino remembers
your choice and carries what you were doing across):

- **Simple** starts from the task, not the tool: *a video ad*, *product photo
  in a new scene*, *bring it to life*, *change a photo*, *remove the
  background*, *image from words*, *make it talk*, *sharpen and enlarge*. One
  page per task, one decision per step, a live preview of the result before
  anything is made, and "keep going" next steps after it. The ad maker
  previews the script as a storyboard on a phone, explains compliance in plain
  words, and lets you edit any line before making.
- **Advanced** is the full studio: every model, every setting, your own
  ComfyUI workflows, and the multi-angle ad studio.
- **Recipes** turn one photo into a finished set in one go: a marketplace
  listing (main image on white, lifestyle shots, cut-out), a Xiaohongshu
  carousel, a story set, a festive promotion with your offer written in, a
  sale poster, or three camera moves with no GPU at all. A recipe is a small
  JSON file of steps, so you can import, export and write your own
  ([docs/recipes.md](docs/recipes.md)).
- **Posts** take finished work out: pictures and videos, words, hashtags,
  platforms and a time. Drafts until you press Schedule; when one is due Kino
  sends it to your webhook (Zapier, Make, n8n, Buffer), signed if you like, or
  reminds you to post it by hand. Every post, recipe run and ad also downloads
  as one zip with its words ([docs/posting.md](docs/posting.md)).

The user stories and flows behind both are in
[docs/user-flows.md](docs/user-flows.md).

| Tool | Apps | Models (official ComfyUI templates) |
|---|---|---|
| Image | Fast · Pro (text and posters) | Z-Image-Turbo · Qwen Image 2.1 Turbo |
| Video | Pro with sound · Scene from text · Draft · **Instant camera move** | MiniMax H3 (FastH3, native audio) · Wan 2.2 5B · ffmpeg (free, local) |
| Edit | Edit with words, optional second reference · **Reframe** to any platform size | Qwen Image 2.1 Edit · ffmpeg (free, local) |
| Cut out | Transparent PNG | Qwen Image 2.1 background removal |
| Talking photo | Face + voice → lip-synced video | LTX-2.3 |
| Enhance | Upscale image · Upscale video · Smooth motion | SeedVR2 7B / 3B · FILM |

- **20 camera moves**, previewed live on your own photo (push-in, orbit, crash
  zoom, dolly zoom, FPV dive, bullet time, product spin, hero reveal…). The
  same preset is written into the prompt for AI video models and rendered
  exactly by the free instant mode.
- **13 looks and 7 sound moods**, one-click prompt improvement (Claude, or
  built-in rules), up to 4 variations, locked seeds, remix of any result.
- **Library** with favourites, search, and lineage ("made from") for every
  file. Animate, edit, upscale or cut out anything in one click.
- **Bring your own workflow.** Drop any ComfyUI workflow (the editor's JSON or
  its API export, e.g. from Civitai or OpenArt) and Kino turns it into a
  one-box app: it finds the prompt, negative prompt, image/audio/video inputs,
  size and seed by itself.

### Ad Studio

1. Pick a brand, where the ad runs (TikTok, Reels, Feed 4:5, Square),
   the language (中文 / English) and up to three angles (daily ritual, gift for
   parents, ancient tradition, how to use, the offer, Singapore homes).
2. **Write scripts.** Claude writes storyboards from the brand profile and the
   product photo, constrained to a strict JSON schema
   ([`src/ads/schema.mjs`](src/ads/schema.mjs)); without a key, templates
   built only from the brand's approved wording do it.
3. Every script is **compliance-checked** ([`src/ads/compliance.mjs`](src/ads/compliance.mjs)):
   the brand's banned words in both languages, effect claims that aren't
   approved word for word, Meta's personal-attributes policy ("your knee
   pain", "您的膝盖…"), before-and-after, superlatives, medical settings, and
   generated shots that would invent a fake product. Blocking issues need an
   explicit "make it anyway".
4. **Make this ad.** Product shots animate the real product photo; scenes are
   generated (Instant: still + camera move, free; Pro: MiniMax H3 with native
   sound and optional voice lines; Draft: Wan 2.2). The editor
   ([`src/ads/render.mjs`](src/ads/render.mjs)) cuts them to length, burns in
   large, safe-zone-aware captions with libass (CJK line breaking that never
   splits a price or phone number), composes an end card from the product
   cut-out, adds a royalty-free music bed, and normalises loudness to −14 LUFS.
5. Download the MP4, copy the post text and hashtags, or re-cut the same shots
   for another platform. The player shades where each app's UI sits.

The HerbalBath profile ([`brands/herbalbath.json`](brands/herbalbath.json))
uses only claims copied word for word from herbalbathsg.com. Edit the offer,
call to action, claims and banned words in the Ad Studio (saved on your
machine).

## Connect a GPU server

- **A ComfyUI server** (a RunPod GPU pod, a cloud GPU, or your own PC running
  ComfyUI 0.41+): paste its address in Settings. Live step-by-step progress.
- **RunPod Serverless**: pay per second, scale to zero. Build the worker image
  in [`runpod/`](runpod/), fill a network volume with
  `runpod/download-models.sh`, paste the endpoint ID and API key in Settings.

[`runpod/README.md`](runpod/README.md) walks through both, including GPU sizes.
**Save and test** tells you which apps have all their models.

Optional: `npm install` adds the Claude SDK; with an API key in Settings,
Claude improves prompts and writes ad scripts (`claude-opus-5-5` by default,
with server-side refusal fallbacks enabled).

## Run it on a server

To reach the studio from your phone or share it with a teammate, run it on any
small server (a VPS, Fly.io, Railway or a RunPod CPU pod). It needs no GPU of
its own; that's what the ComfyUI or RunPod connection is for. Every change on
main publishes the image for Intel and ARM servers, after it has started,
rendered a camera move and passed its health check
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

```bash
docker run -d --restart unless-stopped -p 7860:7860 \
  -e KINO_TOKEN=<pick an access code> \
  -v kino-data:/data ghcr.io/jamesliuzx/kino
```

Or build it yourself: `docker build -t kino .` in this folder.

- **`KINO_TOKEN` is required** once the studio is reachable from the internet:
  anyone who can open it can spend your GPU time and API credit. The studio asks
  for the code once per browser.
- Put HTTPS in front of it (Caddy, or the platform's own TLS) so the code
  isn't sent in the clear.
- Everything lives in the `/data` volume: your files, the library and the
  settings you save in the studio (GPU connection, Claude key). Back it up
  like any other data.
- Settings can also come from the environment instead of the Settings page,
  e.g. `KINO_PROVIDER`, `KINO_CAPTION_FONT`, `KINO_CLAUDE_MODEL` (see
  `src/settings.mjs`).
- `GET /healthz` answers without the access code (and says nothing but
  `{"ok":true}`), for the platform's health check; the image has a Docker
  `HEALTHCHECK` on it.

The image has ffmpeg and a Chinese caption font, so instant camera moves and ad
renders work out of the box.

HerbalBath's Autopilot also runs Kino without the UI: its media job loads the
studio in-process in GitHub Actions and renders queued briefs (see
`scripts/ops/render-media.mjs` in herbalbath-myrrh).

## How it works

```
browser or desktop window: vanilla JS, no build step ──REST + server-sent events── server.mjs (Node 22, no dependencies)
                                                                                      ├─ apps      catalogue of one-box apps → workflows/*.json
                                                                                      ├─ jobs      queue with lanes: local ffmpeg | model backend
                                                                                      ├─ providers demo | this computer | ComfyUI (HTTP + WebSocket) | RunPod Serverless
                                                                                      ├─ engine    stable-diffusion.cpp: install, model packs, sd-server
                                                                                      ├─ library   files + one JSON file (data/)
                                                                                      └─ ads       schema · compliance · writer · ffmpeg editor
```

The desktop app ([`desktop/`](desktop/)) is this same server running inside
Electron on 127.0.0.1, behind an access code made at each launch, so the
browser, Docker and desktop studios are one codebase.

- **Workflows are generated, not hand-written.**
  [`scripts/core-nodes.py`](scripts/core-nodes.py) reads every core node
  definition out of ComfyUI's source (AST only, no torch) into
  `comfy/core_nodes.json` (647 nodes, ComfyUI 0.41.0).
  [`scripts/build-workflows.mjs`](scripts/build-workflows.mjs) converts the
  official templates to API format (subgraphs, promoted widgets, primitives,
  dynamic combos, bypassed nodes) with [`src/comfy/ui2api.mjs`](src/comfy/ui2api.mjs),
  validates each graph, and collects its model files into `runpod/models.json`.
- **Apps are declarative.** [`apps/catalog.mjs`](apps/catalog.mjs) binds each
  knob to the graph (`exposed:prompt`, `node:142.megapixels`,
  `inject:LoadImage@105:104.last_frame` for optional inputs, `seeds`) and maps
  presets into each model's prompt dialect ([`src/prompt.mjs`](src/prompt.mjs):
  shot lists with `<Picture 1>` and an `Audio:` line for H3, style tails for
  image models).
- **Providers speak each backend's real protocol**: ComfyUI's `/upload/image`,
  `/prompt` with a client-chosen `prompt_id`, WebSocket progress with
  `/history` polling as a fallback, `/interrupt`; RunPod's `/run`, `/status`,
  `/cancel` with runpod/worker-comfyui's input and output format;
  stable-diffusion.cpp's native `/sdcpp/v1` jobs (submit, poll with step
  previews, cancel) for This computer, with each app's request in
  [`src/engine/catalog.mjs`](src/engine/catalog.mjs).

```
Dockerfile   the studio as a container, for running it on a server (ghcr.io/jamesliuzx/kino)
apps/        app catalogue and template sources
brands/      brand profiles and product photos for the Ad Studio
comfy/       ComfyUI 0.41 node registry
desktop/     the desktop app: Electron shell, installer config, icon
docs/        user flows, the Open Generative AI review, the roadmap
public/      the studio UI (HTML, CSS, ES modules)
runpod/      Serverless worker, model paths, model downloader, setup guide
scripts/     registry extractor, workflow builder, engine download check
src/         server, queue, providers, engine, media, ads
test/        node:test suites and fake ComfyUI, RunPod and sd-server
web/         the web demo: this interface on an in-browser engine
workflows/   API-format workflows built from the official templates
```

Where Kino is going next (first-run guide, recipes and brand kits, projects,
a posting calendar with Meta, webhooks and phone hand-off, signed builds) is in
[docs/roadmap.md](docs/roadmap.md); what it took from Open Generative AI and why
is in [docs/open-generative-ai.md](docs/open-generative-ai.md).

## Tests

```bash
npm test
```

65 tests: every shipped workflow validates against ComfyUI 0.41's node
definitions and stays valid once an app fills it in; the ComfyUI and RunPod
providers run against fake servers that implement their protocols (uploads,
WebSocket progress, cancellation, errors); live previews reaching the browser
throttled and unstored; recipes (the format's checks, and runs that wait,
fan out over results and sizes, keep in-between results aside, cancel, and
download as one zip); posting (drafts until Schedule, a due post reaching a
webhook as fields, files and a signature, missed times staying missed, and
reminders without a webhook); zip packs read back by Kino's own unzip;
This computer's engine (its zip
reader, resumed downloads, choosing and installing a build, the one-go
first-run setup through a mirror, ffmpeg's fallback sources and retries) and provider,
driving a fake sd-server through real jobs (steps, reuse, swapping packs,
cancel, out-of-memory, video, upscaling, one job at a time); compliance rules; caption wrapping
and safe zones; end-to-end runs through the HTTP API, including a full ad
render with ffmpeg; and the web demo's build, with its models and runtime
(skipped until `npm run build:web-models` has made the models). GitHub
Actions runs them on every push and pull request.

## Updating to a newer ComfyUI

```bash
python3 scripts/core-nodes.py /path/to/ComfyUI > comfy/core_nodes.json
pip download --no-deps comfyui-workflow-templates-json==<version pinned by that ComfyUI>
unzip comfyui_workflow_templates_json-*.whl -d /tmp/templates
node scripts/build-workflows.mjs /tmp/templates/comfyui_workflow_templates_json/templates
npm test
```

Then bump `COMFYUI_VERSION` in `runpod/Dockerfile`.

## Desktop builds

`npm run dist` builds installers for the machine you're on into
`dist-desktop/`. [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)
builds all of them on every packaging change, and on a version tag (`v0.2.0`,
matching `package.json`) drafts a GitHub release with them attached. Add the
signing secrets it lists to get signed, notarised builds.
[`.github/workflows/engine.yml`](.github/workflows/engine.yml) builds
stable-diffusion.cpp with Metal for Apple Silicon (run it once by hand) and
checks every model download URL each week.

## Licences

The workflows are derived from Comfy-Org's official workflow templates. Each
model has its own licence, and some restrict commercial use: check the model
pages linked in `runpod/models.json` and `src/engine/catalog.mjs` before you
run ads with them. The Serverless image builds on runpod/worker-comfyui
(AGPL-3.0) without modifying its code. Other people's work Kino uses, adapts or
fetches is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
