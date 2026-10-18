# Kino web demo

The studio's real interface with the server swapped for an engine that runs in
the page, so Kino can be tried on a static host with no GPU, no ffmpeg and no
uploads. It's what [jamesliuzx.com/kino](https://jamesliuzx.com/kino/) serves.

| File | What it does |
|---|---|
| `engine.mjs` | Answers the same `/api` routes as `src/server.mjs`, from memory: library, jobs, ads, brands. The interface reaches it through `window.kinoDemo` (see `api()` and `upload()` in `public/js/ui.mjs` and `connect()` in `public/js/main.mjs`). |
| `render.mjs` | Camera moves (the instant mode's maths from `src/media/motion.mjs`), the ad edit (the server's caption and end-card layout from `src/ads/captions.mjs`, plus a soft music bed), talking photos and labelled stand-ins for AI stills, all recorded with MediaRecorder. |
| `build.mjs` | Assembles a static folder: `public/`, the engine, the server modules it shares (presets, prompts, ad templates, compliance, captions), the brand files and the seed. |
| `export-seed.mjs` | Exports the starting library (brand photos, two finished ads, two camera moves) from a running Kino. |
| `seed/` | That library. Videos are re-encoded to 720p for the web. |

```bash
node web/build.mjs ../public/kino   # the portfolio's deploy does this on every push
npx serve ../public                 # then open /kino/
```

What's real and what isn't, as the demo's Settings page says: camera moves, ad
scripts (from the approved templates), the compliance check and the finished ad
edit are real. Images, AI video, photo edits and talking photos need the models
on a GPU, so they come back as stand-ins marked "Demo". Nothing is uploaded or
saved; reloading starts fresh.

`test/web.test.mjs` keeps it honest: the build must succeed, every shared
module must stay free of Node built-ins, and the seed must point at real files.
