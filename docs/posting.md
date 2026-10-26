# Posting

**Posts** is where finished work goes out: pictures and videos from the
library, the words and hashtags, the platforms it's for, and a time. Start one
from anything: **Post** in a result's view, **Post this set** on a recipe's
run, **Post** on a finished ad (which brings its post text and hashtags).

Every post starts as a draft. Nothing goes anywhere until you press
**Schedule** or **Send now**.

## Where it goes

Kino doesn't hold your Instagram, TikTok or Facebook passwords or carry their
SDKs. When a post is due it sends it to **one webhook** you choose in
**Settings → Posting**, and that takes it the rest of the way:

- **Zapier**: a Zap starting with *Webhooks by Zapier → Catch Hook*, then
  Instagram for Business, Facebook Pages, TikTok, LinkedIn, X or Buffer.
- **Make**: a scenario starting with *Webhooks → Custom webhook*.
- **n8n**: a workflow starting with a *Webhook* node (POST); it can run on the
  same computer as Kino.
- **Buffer**: through Zapier or Make, so one post reaches every channel Buffer
  has.
- Your own code: anything that takes a POST.

**Send a test** in Settings sends a sample marked `"test": true`, with no
files, so you can wire the rest up before anything real goes out.

Without a webhook, a scheduled post becomes a reminder: at its time Kino tells
you (and shows a system notification if you allowed them), with **Copy words**
and **Download** ready, and **Mark as posted** when you've done it.

## What the webhook gets

A `POST` with `multipart/form-data`:

| Field | What it is |
|---|---|
| `text` | The words as posted: the text, then any hashtags not already in it. |
| `hashtags` | The hashtags, space separated. |
| `platforms` | Comma separated: `instagram`, `facebook`, `tiktok`, `xiaohongshu`, `threads`, `x`, `linkedin`, `youtube`. |
| `scheduled_for` | ISO time it was scheduled for (empty for Send now). |
| `title`, `id` | Kino's name and id for the post. |
| `media1` … `media10` | The files, in order. |
| `payload` | All of the above as JSON (`"kino": "post/1"`), with each file's name, type, size and length. |

Form fields carry line breaks as `\r\n`, as forms do; `payload` keeps them as
`\n`.

If you set a **signing secret**, the request has
`X-Kino-Signature: sha256=<hex>`, the HMAC-SHA256 of the `payload` field with
your secret, so your workflow can check it came from your Kino.

A `2xx` answer marks the post **Sent**; anything else marks it **Didn't go**
with the answer, and you can send it again.

## Times

Kino checks for due posts every 15 seconds while it's open. A post that was due
while Kino was closed goes out when it opens if that's within the hour; later
than that it's marked **Missed** rather than going out at a time you didn't
choose, and you can send it now or pick a new time.

A post made from an ad has to pass that ad's compliance check (the brand's
banned words, the platforms' health-ad rules) before it can be scheduled or
sent. Caption lengths are checked against each platform's limit too:
Instagram 2,200 characters, Facebook 63,206, TikTok 4,000, 小红书 1,000,
Threads 500, X 280, LinkedIn 3,000, YouTube Shorts 5,000.

## Downloads

Every post, recipe run and finished ad downloads as one zip: the files, plus
`post.txt` with the words (an ad also has `script.txt`; a run has `kino.json`
with how each file was made).
