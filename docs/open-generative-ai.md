# Open Generative AI, and what Kino takes from it

A review of [anil-matcha/open-generative-ai](https://github.com/anil-matcha/open-generative-ai)
(v2.0.0, read in full at commit `093d71f`, October 2026), done to decide how
Kino should grow into a desktop studio that can be handed to other people.

## What it is

A desktop and web front end for one paid API. Seventeen studios (Image,
Video, Audio, Lip Sync, Cinema, Marketing, Workflows, Agents, Apps…) send
every request to [MuAPI](https://muapi.ai), which hosts about 420 cloud models;
the README opens with MuAPI's white-label reselling plan. Without a MuAPI key
the only things that work are text-to-image on six local models
(stable-diffusion.cpp, desktop app only) and video through a Wan2GP install you
set up yourself.

| | |
|---|---|
| Web app | Next.js 15 + React 19, `app/` and `packages/studio` (17 studios, about 25,000 lines of JSX). API routes proxy `api.muapi.ai` to dodge CORS. |
| Desktop app | Electron 33 over a **different** front end: vanilla JS + Vite in `src/` with 7 of the studios. |
| Model catalogue | `packages/studio/src/models.js`: 35,146 lines of MuAPI endpoint definitions, plus per-family parameter files. |
| Submodules | Vibe-Workflow, Open-Poe-AI, Open-AI-Design-Agent: workflow builder, agents and design agent, all MuAPI clients too. |
| Local engine 1 | `electron/lib/localInference.js`: downloads `sd-cli` (their own Metal build on Apple Silicon), spawns it once **per image**, so the weights reload every time. Text-to-image only: Z-Image Turbo/Base, three SD 1.5 checkpoints, SDXL. |
| Local engine 2 | `electron/lib/wan2gp*.js`: your own [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) folder (`wgp.py --process`) or its MCP server on another machine, for Wan, Hunyuan and LTX video. |
| History | `localStorage` keys holding URLs on MuAPI's CDN. Nothing is saved on your disk unless you click download. |
| Packaging | electron-builder: DMG, NSIS, AppImage, .deb with an AppArmor profile for Ubuntu 24.04. Unsigned, so the README teaches `xattr -cr` and "Run anyway". No updates. |
| Tests | Eight files, all for the local engines. None for the studios or the API client. |
| Licence | MIT. |

## What's good, and worth having

- **It installs.** One download per platform, including the Ubuntu 24.04
  sandbox problem most Electron apps trip over. Kino had a Docker image and a
  web demo, but nothing a non-developer could double-click.
- **A C++ engine instead of Python.** stable-diffusion.cpp is one small
  program with Metal, CUDA, Vulkan and CPU builds. No Python, no PyTorch, no
  CUDA toolkit to install; it runs on a MacBook. As of October 2026 it also runs
  every model family Kino uses: Z-Image, Qwen Image 2.1 (with edits and
  transparent output), Wan 2.2, MiniMax H3, LTX-2.3 and ESRGAN.
- **Careful download code.** Resume after a dropped connection, retries,
  progress, and choosing the right upstream build per platform, including
  releases that only shipped some platforms.
- **Wan2GP over MCP.** A Mac user can keep the app and send video to a GPU box
  on the network.
- **Reference-image handling.** Up to 14 references, ordered, with a picker
  that remembers uploads.
- **A strict prompt-bar contract** (`packages/studio/src/components/prompt/README.md`):
  one size and style for every control, enforced across studios.
- **Cinema presets.** Camera bodies, lenses, focal lengths and apertures
  written into the prompt.
- **English and Chinese** throughout.

## What isn't, and why Kino shouldn't inherit it

- **Everything depends on one paid API.** Every studio but the local image
  generator is a MuAPI call, including the Workflows, Agents and Marketing
  studios. Remove the key and you have a text-to-image app.
- **Two front ends that drift.** The desktop app runs the older vanilla UI with
  half the studios; fixes land in one or the other.
- **"Your data stays local" doesn't hold.** Prompts and uploads go to MuAPI,
  results live on its CDN, and history is a list of links in browser storage.
- **A model zoo, not a studio.** 420 models across 14 tabs leave the person to
  know which model does what. "Explore Apps" is mostly "register interest"
  cards for products that don't exist yet.
- **It stops at the generation.** No editing, captions, sizes per platform,
  brand rules or compliance checks, and no way to publish.
- **A slow local path.** A fresh `sd-cli` process per image reloads gigabytes
  of weights each time; there's no image editing, cut-out, video or upscaling
  locally.
- **Unsigned builds and no updates.** Every user meets a security warning, and
  stays on the version they downloaded.

## What Kino took

Kino keeps its own engine and interface, which already do the parts above that
Open Generative AI lacks (a real library on disk, task-first Simple mode, the
Ad Studio with captions and compliance, ComfyUI and RunPod, tests), and adds
the parts that make it distributable:

| From Open Generative AI | In Kino | What changed |
|---|---|---|
| stable-diffusion.cpp as the local engine | [`src/engine/`](../src/engine), [`src/providers/local.mjs`](../src/providers/local.mjs) | Runs `sd-server` and keeps a model pack loaded between jobs, with live step progress and cancel. Covers images, edits, cut-outs, video drafts, upscaling and smooth motion, not only text-to-image. |
| Resumable downloads | [`src/engine/download.mjs`](../src/engine/download.mjs) | fetch and streams, cancellable, with a disk-space check per pack and real sizes before you download. |
| Picking the upstream build per platform | `pickAssets` in [`src/engine/catalog.mjs`](../src/engine/catalog.mjs) | Vulkan by default on PCs, CUDA on request, Kino's own Metal build on Apple Silicon. |
| Self-hosted Metal build | [`.github/workflows/engine.yml`](../.github/workflows/engine.yml) | Built in CI from a chosen upstream commit, not uploaded by hand. |
| Electron packaging | [`desktop/`](../desktop), [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) | The desktop app runs the same studio server as `node server.mjs` and Docker, so there's one interface. Signing switches on with secrets; a release check replaces "no updates". |

Not taken: the MuAPI client and model catalogue, Next.js and React, the
submodules, and the localStorage history. A cloud provider can come back later
as one more backend beside ComfyUI and RunPod (see the [roadmap](roadmap.md)),
optional rather than the foundation.

## Why not fork the code

Forking would have started Kino from a MuAPI front end and two UIs, and every
upstream change worth merging would be a MuAPI change. Kino already had the
harder half (a local library, the editor, the Ad Studio, provider tests); what
it lacked was the packaging and the C++ engine, and those were small enough to
take as ideas and code, with credit, under the MIT licence (see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)).
