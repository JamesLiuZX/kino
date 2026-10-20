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

## Done (this branch)

- Kino moved to its own repository, history kept.
- **This computer**: stable-diffusion.cpp as a fourth backend, with model packs
  for fast images, pro images and edits and cut-outs, video drafts and
  upscaling; ffmpeg for smooth motion; plain-language readiness for every app.
- **Desktop app** for Mac, Windows and Linux, with "This computer" as the
  default, release checks, and "Show in folder" for library files.
- **CI**: tests on every push, installers on every packaging change and on
  tags, the Metal engine build, and a weekly check that every download URL
  still answers.

### To ship 0.2.0

1. Merge, then run **Actions → Engine → Run workflow** once to publish the
   Metal build for Apple Silicon.
2. Check the **Engine / files** job: any model or ffmpeg URL marked GONE needs
   its file name fixed in `src/engine/catalog.mjs` (the Hugging Face file names
   couldn't be checked from where this branch was written).
3. On a real Mac and a Windows PC: install the engine, download Fast images,
   make a picture, a camera move and an ad. Windows paths inside ffmpeg
   filters (captions) are the most likely thing to need a fix.
4. Tag `v0.2.0`; the Desktop workflow drafts the release with the installers.
5. GHCR: the `kino` image was first published from james-portfolio, so give
   this repository write access under the package's settings (Manage Actions
   access), or the image job fails with 403.

## Next: first run and the everyday interface

- **A first-run guide** that looks at the machine (memory, Apple Silicon or
  graphics card) and recommends packs: "Your Mac can make pictures in about 10
  seconds. Download Fast images (5 GB)?", then makes a first picture from a
  sample product photo, so people see a result in minutes.
- **Live previews while it works.** sd-server already sends a preview frame
  with each step; show it on the stage instead of only a progress ring.
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

- **Recipes**: a saved chain of steps with the knobs that matter exposed, e.g.
  *product photo → new scene → camera move → captions → 9:16, 4:5 and 1:1*.
  Stored as small JSON files, so they can be shared, imported and versioned
  like imported ComfyUI workflows are today.
- **A recipe gallery** for small brands, starting with: Amazon/Shopee listing
  set, Xiaohongshu carousel, TikTok product ad, Instagram story set, festive
  promotions (Lunar New Year, 11.11, Christmas), wellness ads that pass
  health-ad rules, and UGC talking-head ads.
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

1. **A posting calendar** inside Kino: each post has media, text, platform and
   a time. Drafts by default; nothing posts without an explicit "schedule".
2. **Facebook Pages and Instagram** through Meta's Graph API with one token,
   reusing HerbalBath's `scripts/facebook/schedule-posts.mjs`, which already
   schedules Page posts. Meta only accepts times 10 minutes to 30 days ahead,
   which suits a weekly rhythm.
3. **A webhook connector**: "when a post is due, send it to this URL". One
   feature that reaches Zapier, Make, n8n and Buffer, and through them every
   platform, with no SDKs in Kino.
4. **Phone hand-off**: a QR code that opens the finished file on the phone over
   the local network. TikTok, Xiaohongshu and WhatsApp posting mostly happens
   on phones anyway.
5. **YouTube Shorts and TikTok** direct posting later: both need OAuth apps,
   and TikTok's Content Posting API only posts publicly after an app audit, so
   they're worth doing once there are users asking.

The compliance check runs before anything is scheduled, so a post that breaks
the brand's rules or the platform's health-ad policy can't go out unattended.

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
