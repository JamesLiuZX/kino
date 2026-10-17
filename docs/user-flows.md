# Kino: who it's for, what they're trying to do, and how the studio gets them there

This is the product spec behind Kino's interface. Read it before changing a screen: every flow below has a reason, and the acceptance criteria are what "done" means.

## Who uses Kino

| | Who | What they want | What gets in their way |
|---|---|---|---|
| **The brand owner** (primary) | Runs a small brand: James at HerbalBath, a TCM hall, a home bakery. Not an AI person. Busy. | A post or an ad this week, without learning a tool. "Make me a TikTok ad for my oil." | Model names, prompts, settings, and ad review rejecting health claims. |
| **The creator** (secondary) | Designs or edits for a living, or likes control. | The best model for the job, every knob, repeatable results, their own ComfyUI workflows. | Tools that hide settings or lock them behind credits. |
| **The operator** (once) | Whoever sets the studio up, often the brand owner too. | Connect a GPU, add a Claude key, set the brand's offer and claims. | Not knowing what's connected or what's missing. |

## Principles

1. **Tasks, not tools.** Simple mode asks what you want to make (an ad, a product photo, a moving photo) and picks the model. Model names appear only in Advanced.
2. **One decision at a time, all on one screen.** A flow is a short vertical list of steps with the next one highlighted. Nothing is hidden behind "Next", and every step has a default, so most people only fill the first one.
3. **Show it before you make it.** Camera moves play on your own photo, formats show the frame you'll get, and an ad previews as a storyboard on a phone before any GPU time is spent.
4. **Never a dead end.** Every result offers the obvious next step: make it move, put it in a scene, upscale it, make the ad for another platform. Every error says what to do.
5. **Always know what's happening.** Progress shows in place and in the activity tray, with honest time estimates. You can leave a page and come back.
6. **Safe by default.** Ads are checked against the brand's banned words and Meta and TikTok health-ad rules before anything is made. A clean script says so; a risky one says which line and why, in plain words.
7. **Same engine, two depths.** Simple and Advanced call the same apps with the same values. Switching mode keeps what you were doing.
8. **Honest demo.** Demo mode is labelled everywhere and is one click from connecting a real GPU.

## Simple and Advanced

| | Simple (default) | Advanced |
|---|---|---|
| Start screen | Home: "What will you make today?" and eight task cards | Studio: tool tabs, model choice, the composer, your feed |
| Choosing a model | Never. Kino picks from the task ("words in the picture?" switches to the text model) | Every app, with model, GPU size and time |
| Settings shown | Photo, description, look, shape, length, how many | All of those, plus seed, detail and resolution, quality, prompt expansion, second reference, end frame |
| Ads | A four-step wizard, one idea at a time, Instant or Cinematic | The full Ad Studio: several angles, three engines, a shot-by-shot editor, compliance per field, notes for the writer |
| Your own workflows | Hidden | Apps: import a ComfyUI workflow and use it as a one-box app |
| Navigation | Make · Ads · Library | Studio · Ads · Library · Apps |

The toggle sits in the top bar and is remembered on this machine. From a Simple flow, switching to Advanced opens the Studio with the same app and values loaded. Results made in either mode appear in both.

## Journeys

### 1. First run

> As a first-time visitor, I want to see what Kino can make and try it straight away, so I can decide in a minute whether it's for me.

- Home opens in Simple mode, with demo mode labelled in the top bar ("Demo: try anything") and a one-line explanation.
- The task cards show what each task makes: a moving product shot, a phone playing an ad, a product in a scene.
- The HerbalBath product photos are already in the library, so every flow works with no upload.

**Done when:** a new visitor can make a finished ad or a moving photo from Home with no setup and no typing.

### 2. Make a video ad (the main job)

> As a brand owner, I want a finished TikTok or Reels ad from my product photo that won't be rejected, so I can post it today.

1. **Product.** The brand's product card is pre-selected.
2. **Where it runs.** TikTok, Reels, Feed 4:5 or Square, each drawn as its frame, with a one-line tip.
3. **The idea.** Six ideas (daily ritual, gift for parents, tradition, how to use, the offer, Singapore homes), each with a one-line hint. Pick one.
4. **Language and quality.** 中文 or English. Quick (free, about a minute, camera moves on your product photo) or Cinematic (a GPU animates every shot with sound; a few minutes).
5. **Write my ad.** Kino writes the script: Claude with a key, approved templates without. A phone-shaped storyboard plays the shots with their captions and the end card. The compliance result sits next to it: "Ready for Meta and TikTok review", or the exact lines at risk and why.
6. **Make this ad.** Shots fill in, then the edit. You can leave; the activity tray tracks it and a toast says when it's ready.
7. **Result.** The ad plays in its phone frame, with a toggle that shades where the app's buttons sit. Then: Download MP4, Copy post text, make it for another platform, or start a new ad.

**Done when:** product to downloaded MP4 takes four choices and two buttons, risky lines are explained before anything is made, and the finished ad can be re-cut for another platform in one click.

### 3. A product photo in a new scene

> As a brand owner, I want my real product photographed somewhere new, without a photographer, so my posts stay fresh.

1. **Your product.** Brand photos first, then upload or pick from the library.
2. **The scene.** Describe it, or tap an idea: marble bathroom counter, teak table in morning light, festive gift box, bedside lamp, plants and sunlight, clean studio.
3. **Make it.** The result shows as a before-and-after slider. Next steps: bring it to life, remove the background, enlarge it.

**Done when:** a product photo goes into a new scene in two choices, and the real label is never redrawn by a model.

### 4. Bring a photo to life

> As a brand owner, I want a short moving clip from one photo, for a Reel or a WhatsApp status.

1. **Your photo.**
2. **Camera move.** Eight common moves play live on your photo. "More moves" opens all twenty.
3. **Shape and length.** 9:16, 1:1, 4:5 or 16:9, with 4 seconds as the default.
4. **How it moves.** Camera move (free, seconds, runs on this computer) or AI motion with sound (GPU, about two minutes). AI motion adds an optional "What happens" line and a sound choice.

The stage previews the exact move inside the chosen frame before you press Make.

**Done when:** the preview matches the result for camera moves, and choosing AI motion is one tap.

### 5. Change a photo, remove a background, make a photo talk, sharpen and enlarge

> As a brand owner, I want the quick fixes (a new background, a clean cut-out, a sharper photo) without learning an editor.

- **Change a photo:** the photo, then "What should change?" with ideas. The result shows as a before-and-after slider.
- **Remove the background:** one step. The cut-out shows on a checkerboard. Next step: put it in a scene.
- **Make a photo talk:** a face photo and a voice recording, with an optional line about how they look. Shape and length use sensible defaults.
- **Sharpen and enlarge:** a photo or a video. Images upscale 2×. Videos can upscale or smooth their motion.

**Done when:** each fix is one or two choices, and its result offers the natural next step.

### 6. Find and reuse

> As anyone, I want to find what I made last week and keep going from it.

- The library shows everything made or uploaded, newest first, with filters (photos, videos, ads, uploads, favourites) and search across prompts.
- The lightbox shows the media, what made it ("made from" thumbnails link back) and its next steps.
- Home's "Pick up where you left off" shows the latest results with one-tap next steps.

**Done when:** any result can be found in two clicks and continued in one.

### 7. Stay informed

> As anyone, I want to know what's running and when it's done, without watching a spinner.

- The top bar's activity button shows how many jobs are running, with a progress ring. Its panel lists each job's progress, time left and a cancel button, plus the latest finished results.
- When a job finishes and you're not looking at it, a toast says so, with a "View" action.

**Done when:** you can start a job, go anywhere in the studio, and still see its progress and be told when it's done.

### 8. Advanced: full control

> As a creator, I want to pick the model and every setting, repeat a result exactly, and use my own workflows.

- **Studio:** tool tabs, then model choice with GPU size and time, then a composer with every setting (aspect, look, camera, sound, length, quality, seed, variations, second reference, end frame).
- **Ad Studio:**
  - several angles at once, notes for the writer;
  - Instant, Pro or Draft engines;
  - a shot-by-shot editor (source, camera, caption, seconds, voice line), the end card and post copy;
  - compliance flags on each field.
- **Apps:** import any ComfyUI workflow and use it as an app; see which model files each built-in app needs.

**Done when:** everything the engine can do is reachable in Advanced.

### 9. Set up

> As the operator, I want to connect a GPU and know exactly what works.

- Settings offers three cards: Demo, a ComfyUI server, or RunPod Serverless. Each has the two fields it needs and a link to the guide.
- "Save and test" lists which apps are ready and what each missing app needs.
- The Claude key is optional, and the page says what changes with it: smarter prompts and custom ad scripts.

**Done when:** after "Save and test", the operator knows which apps work and what to install for the rest.

## Look and feel

- **Light and calm.** Warm paper, ink-black text, hairline borders, one violet accent with a cyan partner (shared with jamesliuzx.com), green for "ready", amber for "check this", red for "this will be rejected".
- **Type.**
  - Instrument Serif for headings, with one italic accent word.
  - Inter for the interface.
  - JetBrains Mono for small uppercase labels, timings and counts.

  All three are bundled, so the studio works offline.
- **Motion.**
  - Headings reveal word by word.
  - Cards rise in sequence.
  - The home hero has a soft spotlight that follows the pointer, film grain, and two slow glows.
  - Screens cross-fade.
  - Camera previews loop.

  Everything respects "reduce motion".
- **Media first.** Previews and results get the space; controls stay compact.
