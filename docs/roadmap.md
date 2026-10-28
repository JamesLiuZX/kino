# Kino roadmap: from studio to a product people download

The goal: a studio a small brand can download, open, and use to make finished
images, videos and ads **on their own computer**, with no account, no key and
no subscription, and with a GPU server or cloud as an option, never a
requirement. Better than [Open Generative AI](open-generative-ai.md) where it
counts: it finishes the work (edit, captions, sizes, compliance, posting), it
keeps your files, and it's simple enough not to need a model zoo.

Principles, in order:

1. **Local first.** Everything that can run on the person's machine does. The
   network is for downloading models once and, if they choose, posting.
2. **One studio everywhere.** The desktop app, `node server.mjs`, the Docker
   image and the web demo share one interface and one API.
3. **Tasks, not models.** People pick what they want to make; Kino picks the
   model, writes the prompt and does the editing. Models stay visible in
   Advanced for people who care.
4. **Real files.** Every result is a file on disk with how it was made.
5. **Few dependencies.** Node's standard library on the server, no front-end
   framework, no build step. Electron only for the desktop shell.

## Done

- Kino moved to its own repository, history kept.
- **This computer**: stable-diffusion.cpp as a fourth backend, with model packs
  for fast images, pro images and edits and cut-outs, video drafts and
  upscaling; ffmpeg for smooth motion; plain-language readiness for every app.
- **Desktop app** for Mac, Windows and Linux, with "This computer" as the
  default, release checks, and "Show in folder" for library files.
- **CI**: tests on every push, installers on every packaging change and on
  tags, the Metal engine build, and a weekly check that every download URL
  still answers.
- **A first-run guide** (`#/welcome`): the desktop app opens on it until this
  computer is set up. It shows the machine (memory, free disk, Metal or
  Vulkan), ticks the starter packs (Fast images and Upscaling, about 7 GB) and
  warns where a pack wants more memory than there is, then installs the engine
  and downloads the packs in one go with progress, and hands over to a first
  picture. "Use a GPU server" and "Look around first" (demo mode) are one click
  away. Model files can come from a Hugging Face mirror (`HF_ENDPOINT`).
- **Recipes** (`#/recipes`): chains of apps as small JSON files
  ([docs/recipes.md](recipes.md)), with a gallery of six: marketplace listing
  set, Xiaohongshu carousel, story set, festive promotion, sale poster and
  three camera moves with no GPU. Steps wait for the ones they need, run once
  per earlier result and per `each` value, and keep in-between results out of
  the library's main view; runs can be cancelled and every run's results stay
  on the recipe's page. Import, export, and duplicate-and-edit with checks that
  name each problem. **Reframe** (ffmpeg, instant) makes every platform size,
  and puts cut-outs on white for marketplace main images.
- **Posts** (`#/posts`): media, words, hashtags, platforms and a time, with
  each platform's caption limit checked. Drafts until Schedule or Send now;
  when due, a signed webhook (multipart: fields, files and the post as JSON)
  reaches Zapier, Make, n8n and Buffer, or, with no webhook, a reminder with
  the words and files ready ([docs/posting.md](posting.md)). Missed times stay
  missed. **Export packs**: every post, recipe run and finished ad downloads as
  one zip with its words (an ad's post text and script; a run's `kino.json`).
- **Live previews**: on This computer the picture sharpens on the stage and in
  the Studio's feed as the engine works (sd-server's preview frame for each
  step), under a small progress badge. Frames go straight to the browser, at
  most four a second, and are never stored. Demo mode previews too.

### Shipping 0.3.0

- [x] Metal build for Apple Silicon published (`engine-metal` release).
- [x] Every model and ffmpeg URL checked by the **Engine / files** job, sizes
  corrected from what it measured; it runs weekly.
- [x] GHCR write access for this repository; the image publishes from `main`.
- [x] `v0.2.0` tagged and drafted with installers, before the first-run guide,
  previews, recipes and posts.
- [x] `main` is 0.3.0, with release notes in `CHANGELOG.md` that the Desktop
  workflow puts on the draft.
- [x] `v0.3.0` tagged and published (2026-10-27).
- [x] Releasing needs no terminal: run the Desktop workflow by hand with
  *Draft a release* ticked and it tags `main` with package.json's version and
  drafts the release with every installer.
- [ ] James: **Publish** the Kino 0.3.1 draft on the Releases page (drafts are
  private; 0.3.1 has the installer window that says how to open it the first
  time) and delete the old v0.2.0 draft.
- [ ] James: an Apple Developer ID, so the Mac app opens with no warning
  ([signing.md](signing.md)).
- [ ] On a real Mac and a Windows PC: run the first-run guide, make a picture,
  a camera move, one recipe and an ad. Windows paths inside ffmpeg filters
  (captions) are the most likely thing to need a fix.

## Next: first run and the everyday interface

- **Previews from ComfyUI too**: its WebSocket sends preview frames when the
  server runs with `--preview-method`; pass them on the same way.
- **Each app where it runs best.** Today one backend runs everything. Let
  pictures run on this computer while H3 video goes to RunPod, automatically,
  with the choice visible on each app.
- **Lighter packs for 16 GB machines**: GGUF quantisations of Qwen Image 2.1
  and Wan 2.2 once their file names are verified, and bigger-machine packs for
  MiniMax H3 (video with sound) and LTX-2.3 (talking photos), which
  stable-diffusion.cpp now runs.
- **Engine folder on another drive**, chosen in Settings (models are tens of
  GB).
- **The web demo's in-browser models** (IS-Net cut-outs, Real-ESRGAN) as an
  instant fallback in the desktop app before any pack is downloaded.

## Presets, recipes and brand kits

Open Generative AI offers 420 models; what people want is a result they can
use. Kino's answer is recipes:

- **More recipes**: captions and end cards as a step (the Ad Studio's editor
  as an app), a TikTok product ad, wellness ads that pass health-ad rules, UGC
  talking-head ads; a brand kit as a recipe input; "Save this as a recipe"
  from a finished run; recipes in the web demo.
- **Brand kits for every tool**, not just ads: colours, fonts, logo, voice,
  approved claims and banned words, applied to captions, end cards and
  prompts. The HerbalBath profile is the first one.
- **Batch**: run a recipe over a folder of product photos for a whole
  catalogue.
- **More looks**: Open Generative AI's cinema presets (camera body, lens,
  focal length, aperture) as one more picker beside Kino's 20 camera moves, 13
  looks and 7 sound moods.

## Saving and finding things

Open Generative AI keeps links to a CDN in browser storage. Kino keeps files;
next is making them easy to live with:

- **Projects** (a launch, a client, a season) with their own library view.
- **A readable folder on disk**: files named by project, date and what they
  are, with a sidecar `.json` of how each was made, so the library still makes
  sense outside Kino and in backups.
- **Export packs**: one click for every platform size of an ad plus captions,
  post text and hashtags, as a folder or zip.
- **Import a folder**: drop in a photographer's shoot and it lands in the
  library, ready for recipes.

## Publishing and auto-posting

Making the ad is half the job; this is where Kino can go furthest past Open
Generative AI, which has no publishing at all. In order of value for effort:

1. ~~A posting calendar~~ and 3. ~~a webhook connector~~: done, see above.
2. **Facebook Pages and Instagram** through Meta's Graph API with one token,
   reusing HerbalBath's `scripts/facebook/schedule-posts.mjs`, which already
   schedules Page posts. Meta only accepts times 10 minutes to 30 days ahead,
   which suits a weekly rhythm.
4. **Phone hand-off**: a QR code that opens the finished file on the phone over
   the local network. TikTok, Xiaohongshu and WhatsApp posting mostly happens
   on phones anyway.
5. **YouTube Shorts and TikTok** direct posting later: both need OAuth apps,
   and TikTok's Content Posting API only posts publicly after an app audit, so
   they're worth doing once there are users asking.

The compliance check runs before a post made from an ad is scheduled or sent,
so words that break the brand's rules or the platforms' health-ad policies
can't go out unattended. Next: pick a brand for any post, so every post gets
the same check.

## Distribution and trust

- **Signed and notarised builds**, so nobody meets "unidentified developer":
  an Apple Developer ID (Apple Developer Program, about US$99 a year) and a
  Windows code-signing certificate or Azure Trusted Signing. The Desktop
  workflow already takes the secrets.
- **Automatic updates** once builds are signed (electron-updater from GitHub
  Releases). Until then Kino checks GitHub and offers the download.
- **Homebrew cask and winget manifests** for people who install that way.
- **A landing page** with the downloads and the web demo, at jamesliuzx.com/kino
  or its own domain.
- **No telemetry by default**; opt-in crash reports at most.
- **Model licences on the pack cards.** Some models restrict commercial use;
  show each pack's licence before it downloads.
- **Kino's own licence** is still to choose: MIT or Apache-2.0 for the widest
  use, AGPL-3.0 to keep hosted copies open, or source-available if a paid
  edition is the plan. The third-party pieces are listed in
  [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Kino and Open Generative AI, side by side

| | Open Generative AI | Kino |
|---|---|---|
| Works without an account or key | Text-to-image only, desktop only | Images, edits, cut-outs, video drafts, upscaling, camera moves and the ad editor |
| Where results live | Links to a CDN in browser storage | Files on your disk with lineage, favourites and search |
| Local engine | `sd-cli` per image (weights reload each time) | `sd-server` kept loaded, live steps, cancel |
| Choosing | 420 models in 17 studios | Tasks in Simple mode, models in Advanced |
| Finishing | None | Captions, end cards, sizes per platform, loudness, compliance |
| Publishing | None | Planned: calendar, Meta, webhooks, phone hand-off |
| Interfaces to maintain | Two (React web, vanilla desktop) | One |
| Tests | Local engines only | Providers, engine, workflows, ads, server, web demo |
| Backends | MuAPI; Wan2GP if you install it | This computer, ComfyUI, RunPod, demo |

## Risks to keep an eye on

- **stable-diffusion.cpp moves fast** ("API and command-line options may
  change frequently"). Kino uses its native `/sdcpp/v1` API, pins nothing by
  default, and can pin a release in Settings. A CI job that runs a real CPU
  build on a tiny model would catch breaking changes early.
- **Model files move.** The weekly URL check finds it; packs can carry
  fallbacks.
- **Memory.** Packs list what they need and warn on smaller machines, and the
  engine frees memory after ten idle minutes. 8 GB machines will be limited to
  camera moves, upscaling and the ad editor.
- **Windows** is the least tested platform: ffmpeg filter paths and CUDA
  runtime discovery need a real PC before release.
