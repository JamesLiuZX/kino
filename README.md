# Kino

An AI image and video studio with a one-box interface. Type a line, pick a
camera move, press Generate. Underneath, Kino runs the official ComfyUI
workflows for 2026's best open models on your own GPU or on RunPod. Its Ad
Studio turns a brand profile into finished, captioned TikTok and Meta ads that
have been checked against health-ad rules.

```bash
cd kino
node server.mjs          # Node 22+; ffmpeg recommended
# open http://localhost:7860
```

It starts in **demo mode**: every tool works and produces real files
(placeholder renders, real camera moves, real ad edits), so you can try the
whole studio before connecting a GPU. Connect one in **Settings**.

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

The user stories and flows behind both are in
[docs/user-flows.md](docs/user-flows.md).

| Tool | Apps | Models (official ComfyUI templates) |
|---|---|---|
| Image | Fast · Pro (text and posters) | Z-Image-Turbo · Qwen Image 2.1 Turbo |
| Video | Pro with sound · Scene from text · Draft · **Instant camera move** | MiniMax H3 (FastH3, native audio) · Wan 2.2 5B · ffmpeg (free, local) |
| Edit | Edit with words, optional second reference | Qwen Image 2.1 Edit |
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

## Connect a GPU

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
its own; that's what the ComfyUI or RunPod connection is for.

```bash
cd kino
docker build -t kino .
docker run -d --restart unless-stopped -p 7860:7860 \
  -e KINO_TOKEN=<pick an access code> \
  -v kino-data:/data kino
```

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

The image has ffmpeg and a Chinese caption font, so instant camera moves and ad
renders work out of the box.

HerbalBath's Autopilot also runs Kino without the UI: its media job checks out
this folder in GitHub Actions and renders queued briefs (see
`scripts/ops/render-media.mjs` in herbalbath-myrrh).

## How it works

```
browser: vanilla JS, no build step ──REST + server-sent events── server.mjs (Node 22, no dependencies)
                                                                   ├─ apps      catalogue of one-box apps → workflows/*.json
                                                                   ├─ jobs      queue with lanes: local ffmpeg | GPU backend
                                                                   ├─ providers demo | ComfyUI (HTTP + WebSocket) | RunPod Serverless
                                                                   ├─ library   files + one JSON file (data/)
                                                                   └─ ads       schema · compliance · writer · ffmpeg editor
```

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
  `/cancel` with runpod/worker-comfyui's input and output format.

```
Dockerfile   the studio as a container, for running it on a server
apps/        app catalogue and template sources
brands/      brand profiles and product photos for the Ad Studio
comfy/       ComfyUI 0.41 node registry
public/      the studio UI (HTML, CSS, ES modules)
runpod/      Serverless worker, model paths, model downloader, setup guide
scripts/     registry extractor and workflow builder
src/         server, queue, providers, media, ads
test/        node:test suites and fake ComfyUI / RunPod servers
workflows/   API-format workflows built from the official templates
```

## Tests

```bash
npm test
```

39 tests: every shipped workflow validates against ComfyUI 0.41's node
definitions and stays valid once an app fills it in; the ComfyUI and RunPod
providers run against fake servers that implement their protocols (uploads,
WebSocket progress, cancellation, errors); compliance rules; caption wrapping
and safe zones; and end-to-end runs through the HTTP API, including a full ad
render with ffmpeg.

## Updating to a newer ComfyUI

```bash
python3 scripts/core-nodes.py /path/to/ComfyUI > comfy/core_nodes.json
pip download --no-deps comfyui-workflow-templates-json==<version pinned by that ComfyUI>
unzip comfyui_workflow_templates_json-*.whl -d /tmp/templates
node scripts/build-workflows.mjs /tmp/templates/comfyui_workflow_templates_json/templates
npm test
```

Then bump `COMFYUI_VERSION` in `runpod/Dockerfile`.

## Licences

The workflows are derived from Comfy-Org's official workflow templates. Each
model has its own licence, and some restrict commercial use: check the model
pages linked in `runpod/models.json` before you run ads with them. The
Serverless image builds on runpod/worker-comfyui (AGPL-3.0) without modifying
its code.
