# Changelog

## 0.3.1

**Kino on the web, for real.** [jamesliuzx.com/kino](https://jamesliuzx.com/kino/)
runs every AI app with the visitor's own fal.ai key (pasted once in Settings,
kept in that browser, sent only to fal.ai), on the same open models as the
desktop app: Z-Image, Qwen Image and Qwen Image Edit, LTX-2 with sound, Wan 2.2,
InfiniteTalk, SeedVR2, BiRefNet and FILM. Up to four run at once. Recipes run
on the web too and download as a zip, and the library, recipes and runs are
kept in the browser between visits. A weekly check makes sure fal still has
every model and takes what Kino sends.

**Opening the Mac app the first time.** Until there's a Developer ID, the
installer window and the release notes say how to open an app Apple hasn't
checked; once the signing secrets are added, the Desktop workflow signs and
notarizes it ([how to sign it](https://github.com/JamesLiuZX/kino/blob/main/docs/signing.md)).

## 0.3.0

**Set up in one go.** The desktop app opens on a first-run guide: it looks at
your computer, ticks the model packs to start with (Fast images and Upscaling,
about 7 GB), installs the engine and downloads them with progress, then hands
you a first picture. A GPU server or demo mode are one click away, and models
can come from a Hugging Face mirror where Hugging Face is slow or blocked.

**Watch it work.** On this computer the picture sharpens on the stage step by
step, under a small progress badge.

**Recipes.** One photo to a finished set in one go: a marketplace listing (main
image on white, lifestyle shots, cut-out), a Xiaohongshu carousel, a story set,
a festive promotion with your offer written in, a sale poster, or three camera
moves with no GPU at all. Recipes are small JSON files you can import, export
and write yourself. **Reframe** makes every platform size in a second.

**Posts.** Pictures and videos, words, hashtags, platforms and a time, each
platform's caption limit checked. Drafts until you press Schedule; when one is
due Kino sends it to your webhook (Zapier, Make, n8n, Buffer), or reminds you to
post it by hand. Every post, recipe run and ad downloads as one zip with its
words.

## 0.2.0

The first desktop release, for Mac (Apple Silicon and Intel), Windows and
Linux. **This computer** runs the models itself with stable-diffusion.cpp
(Metal on Apple Silicon, Vulkan or CUDA on PCs), with model packs for fast
images, pro images and edits, video drafts and upscaling. No account, no key.
