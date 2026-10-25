# Recipes

A recipe chains Kino's apps so one photo (or a line of words) becomes a
finished set: a listing's main image on white plus lifestyle shots, a
Xiaohongshu carousel, a festive promo in every size. Each step is an ordinary
job, so it shows in the queue and lands in the library like anything else.

Kino ships six in [`recipes/`](../recipes). Yours live in the studio's data
folder; **Recipes → Import a recipe** adds a file, and every recipe page has
**Export** and **Duplicate and edit**. Kino checks a recipe when you save it
and names each problem, so the quickest way to write one is to duplicate a
built-in one and change it.

## The format

```json
{
  "kino": "recipe/1",
  "id": "story-set",
  "title": "Story set: a still and two camera moves",
  "blurb": "Your product in a new scene, as a 9:16 still and two camera moves.",
  "category": "Social",
  "tags": ["Instagram", "TikTok"],
  "inputs": [
    { "id": "photo", "type": "image", "label": "Product photo" },
    { "id": "scene", "type": "text", "label": "The scene", "default": "on a marble counter in soft light" }
  ],
  "steps": [
    { "id": "set", "label": "New scene", "app": "edit", "keep": false,
      "values": { "image": "{{photo}}", "prompt": "Place this product {{scene}}. Keep the product exactly as it is." } },
    { "id": "still", "label": "9:16 still", "app": "reframe",
      "values": { "image": "@set", "aspect": "9:16", "fit": "fit" } },
    { "id": "moves", "label": "Camera moves", "app": "video-instant",
      "values": { "image": "@set", "aspect": "9:16", "duration": 5 },
      "each": { "camera": ["push-in", "orbit"] } }
  ]
}
```

| Field | What it is |
|---|---|
| `kino` | Always `"recipe/1"`. |
| `id` | Lowercase letters, digits and dashes, up to 48. Built-in ids are taken. |
| `title`, `blurb`, `category`, `tags` | What the gallery shows. |
| `inputs` | Up to 8 things the recipe asks for. `type` is `image`, `video`, `audio`, `text` or `choice` (with `options`). Text and choices can have a `default`; text can have `ideas` (suggestions shown as chips). `help` is a line under the label; `optional: true` lets it be left out. |
| `steps` | 1 to 12, run in order of what they need. |

Each step:

| Field | What it is |
|---|---|
| `id` | Unique among steps and inputs. |
| `app` | Any app in **Apps**: `image-fast`, `image-pro`, `edit`, `reframe`, `cutout`, `upscale-image`, `video-instant`, `video-draft`, `video-pro`, `video-scene`, `talk`, `upscale-video`, `smooth`, or an imported workflow's id. |
| `values` | The app's settings, by the ids **Apps** shows. A value that is exactly `"{{input}}"` is that input (a file, or text); `{{input}}` inside words is the input's text; `"@step"` is what an earlier step made. |
| `each` | One setting and up to 6 values for it: the step runs once per value. |
| `count` | 1 to 4 variations of each job. |
| `label` | Its name in the run. |
| `keep` | `false` for a means to an end: its results stay out of the library's main view (they're under the run, and in the library's data). |

A step that uses `"@step"` waits for that step and runs once for each of its
results, so two scenes reframed to two sizes make four pictures. A step runs
at most 12 jobs. If a step doesn't work, the steps that need it are skipped and
the others carry on; the run says which.

Kino checks: the app exists; every setting is one the app has; preset values
(aspects, cameras, looks, choices such as `fit`) are ones the app accepts; files
go where files go and come from an input or an earlier step that makes that
kind of file; every `{{name}}` is an input; and the app's required settings are
all there.

## Reframe

The `reframe` app (Edit → Reframe · instant) is what makes every platform size:
it reshapes a picture to 1:1, 4:5, 3:4, 9:16 or 16:9 with ffmpeg, in a second
and with no model. `fit` is `fill` (crop to fill), `fit` (the whole picture
over a blurred copy of itself) or `white` (the whole picture on white, the
marketplace main image). Transparent cut-outs land on white.
