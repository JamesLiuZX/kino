// Posts: what goes out, where and when. A post is media from the library, its
// text and hashtags, the platforms it's for, and a time. Everything starts as a
// draft, and nothing goes anywhere until you press Schedule or Send now.
//
// When a scheduled post is due, Kino sends it to your webhook: one URL that
// reaches Zapier, Make, n8n, Buffer or your own code, and through them every
// platform, with no platform SDKs in Kino. The post's text, hashtags and
// platforms arrive as form fields with the files attached, plus the whole post
// as JSON in `payload`, signed with your secret if you set one
// (docs/posting.md). With no webhook, Kino reminds you when it's time and has
// the text and files ready to post by hand.
//
// A post that was due while the studio was closed is sent when it opens, if
// that's within the hour; later than that, it's marked missed rather than
// going out at a time you didn't choose.

import { createHmac } from "node:crypto"
import { openAsBlob } from "node:fs"
import { newId } from "./store.mjs"
import { checkBrief } from "./ads/compliance.mjs"

// Caption limits as the platforms document them.
export const PLATFORMS = {
  instagram: { label: "Instagram", limit: 2200 },
  facebook: { label: "Facebook", limit: 63206 },
  tiktok: { label: "TikTok", limit: 4000 },
  xiaohongshu: { label: "小红书", limit: 1000 },
  threads: { label: "Threads", limit: 500 },
  x: { label: "X", limit: 280 },
  linkedin: { label: "LinkedIn", limit: 3000 },
  youtube: { label: "YouTube Shorts", limit: 5000 },
}

const LATE_MS = 60 * 60_000 // past this, a missed time stays missed
const MAX_MEDIA = 10
const EDITABLE = new Set(["draft", "scheduled", "due", "failed", "missed"])

export const hashtagList = (raw) =>
  [...new Set((Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,，]+/)).map((t) => String(t).trim().replace(/^#*/, "#").replace(/\s+/g, "")).filter((t) => t.length > 1))].slice(0, 30)

/** The words as they're posted: the text, then the hashtags not already in it. */
export function postText(post) {
  const text = String(post.text ?? "").trim()
  const extra = (post.hashtags ?? []).filter((t) => !text.includes(t))
  return [text, extra.join(" ")].filter(Boolean).join("\n\n")
}

export class Posts {
  /** brandFor(post): the brand whose rules the post's words must pass (a post made from an ad has its ad's), or null. */
  constructor({ store, library, settings, events, brandFor = () => null, now = () => Date.now(), tickMs = 15_000 }) {
    Object.assign(this, { store, library, settings, events, brandFor, now, tickMs })
  }

  start() {
    for (const p of this.store.list("posts")) {
      if (p.status === "sending") this.patch(p, { status: "failed", error: "The studio stopped while sending it; send it again." })
    }
    this.tick()
    this.timer = setInterval(() => this.tick(), this.tickMs)
    this.timer.unref?.()
  }

  stop() {
    clearInterval(this.timer)
  }

  list() {
    const order = { due: 0, sending: 1, scheduled: 2, failed: 3, missed: 3, draft: 4, sent: 5 }
    return this.store.list("posts").sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (a.status === "scheduled" ? a.at - b.at : (b.sentAt ?? b.updatedAt) - (a.sentAt ?? a.updatedAt)))
  }

  get(id) {
    return this.store.get("posts", id)
  }

  /** A new draft, from anything (a result, a recipe's set, an ad). */
  create(fields = {}) {
    const post = { id: newId("p"), status: "draft", at: null, createdAt: this.now(), title: "", text: "", hashtags: [], media: [], platforms: [], ...this.clean(fields) }
    post.updatedAt = post.createdAt
    this.store.put("posts", post)
    this.emit(post)
    return post
  }

  update(id, fields) {
    const post = this.must(id)
    if (!EDITABLE.has(post.status)) throw new Error(post.status === "sent" ? "That post has gone out; make a new one." : "That post is being sent.")
    return this.patch(post, this.clean(fields))
  }

  /** Press Schedule: it goes out at `at`, and not before. */
  schedule(id, at) {
    const post = this.must(id)
    if (!EDITABLE.has(post.status)) throw new Error("That post has gone out.")
    const when = typeof at === "number" ? at : Date.parse(at)
    if (!Number.isFinite(when)) throw new Error("Pick a date and time.")
    if (when < this.now() + 30_000) throw new Error("Pick a time at least a minute from now, or send it now.")
    if (when > this.now() + 365 * 86_400_000) throw new Error("Pick a time within a year.")
    this.ready(post)
    return this.patch(post, { status: "scheduled", at: when, error: null })
  }

  unschedule(id) {
    const post = this.must(id)
    if (post.status !== "scheduled" && post.status !== "due") return post
    return this.patch(post, { status: "draft", at: null })
  }

  /** You posted it yourself (a reminder you acted on). */
  markPosted(id) {
    const post = this.must(id)
    if (post.status === "sent") return post
    return this.patch(post, { status: "sent", sentAt: this.now(), by: "hand", error: null })
  }

  remove(id) {
    const ok = this.store.remove("posts", id)
    if (ok) this.events.emit("post-removed", { id })
    return ok
  }

  /** Press Send now. */
  async sendNow(id) {
    const post = this.must(id)
    if (post.status === "sending") return post
    if (post.status === "sent") throw new Error("That post has gone out; make a new one.")
    this.ready(post)
    if (!this.webhook()) throw new Error("Add a webhook in Settings → Posting to send posts from Kino, or download the post and share it yourself.")
    return this.send(post)
  }

  webhook() {
    return String(this.settings.get("postWebhook") ?? "").trim()
  }

  /** Every due post goes to the webhook, or becomes a reminder. One pass at a time, so nothing goes twice. */
  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      const now = this.now()
      for (const post of this.store.list("posts", (p) => p.status === "scheduled" && p.at <= now)) {
        if (post.status !== "scheduled") continue // unscheduled while an earlier one was sending
        if (now - post.at > LATE_MS) this.patch(post, { status: "missed", error: `The studio was closed at the time you picked (${new Date(post.at).toLocaleString()}). Send it now or pick a new time.` })
        else if (this.webhook()) await this.send(post)
        else {
          this.patch(post, { status: "due" })
          this.events.emit("post-due", post)
        }
      }
    } finally {
      this.ticking = false
    }
  }

  async send(post) {
    this.patch(post, { status: "sending", error: null })
    try {
      const { form, payload } = await this.formFor(post)
      const secret = String(this.settings.get("postSecret") ?? "")
      const headers = { "User-Agent": "Kino (+https://github.com/JamesLiuZX/kino)" }
      if (secret) headers["X-Kino-Signature"] = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`
      let res
      try {
        res = await fetch(this.webhook(), { method: "POST", body: form, headers, signal: AbortSignal.timeout(120_000) })
      } catch (e) {
        throw new Error(`Couldn't reach the webhook (${e.cause?.code ?? e.message}).`)
      }
      const body = (await res.text().catch(() => "")).slice(0, 400)
      if (!res.ok) throw Object.assign(new Error(`The webhook answered ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}.`), { response: { status: res.status, body } })
      return this.patch(post, { status: "sent", sentAt: this.now(), by: "webhook", response: { status: res.status, body }, error: null })
    } catch (e) {
      return this.patch(post, { status: "failed", error: e.message, response: e.response ?? null })
    }
  }

  /** What the webhook gets: plain fields for no-code tools, the files, and the whole post as JSON. */
  async formFor(post, { test = false } = {}) {
    const media = post.media.map((id) => this.library.get(id)).filter(Boolean)
    const payload = JSON.stringify({
      kino: "post/1",
      id: post.id,
      test,
      title: post.title,
      text: postText(post),
      caption: post.text,
      hashtags: post.hashtags,
      platforms: post.platforms,
      scheduledFor: post.at ? new Date(post.at).toISOString() : null,
      media: media.map((a, i) => ({ field: `media${i + 1}`, filename: a.file, mime: a.mime, kind: a.kind, width: a.width ?? null, height: a.height ?? null, duration: a.duration ?? null })),
    })
    const form = new FormData()
    form.append("payload", payload)
    form.append("id", post.id)
    form.append("title", post.title)
    form.append("text", postText(post))
    form.append("hashtags", post.hashtags.join(" "))
    form.append("platforms", post.platforms.join(","))
    form.append("scheduled_for", post.at ? new Date(post.at).toISOString() : "")
    for (const [i, a] of media.entries()) form.append(`media${i + 1}`, await openAsBlob(this.library.pathOf(a), { type: a.mime }), a.file)
    return { form, payload }
  }

  /** A sample post to the webhook, so you can wire up Zapier or Make before anything real goes out. */
  async test() {
    if (!this.webhook()) throw new Error("Add the webhook's URL first.")
    const { form, payload } = await this.formFor({ id: "p_test", title: "A test from Kino", text: "If this arrived, your webhook works. Nothing was posted.", hashtags: ["#kino"], platforms: ["instagram"], media: [], at: null }, { test: true })
    const secret = String(this.settings.get("postSecret") ?? "")
    const headers = secret ? { "X-Kino-Signature": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}` } : {}
    try {
      const res = await fetch(this.webhook(), { method: "POST", body: form, headers, signal: AbortSignal.timeout(30_000) })
      return { ok: res.ok, status: res.status }
    } catch (e) {
      return { ok: false, status: 0, error: `Couldn't reach it (${e.cause?.code ?? e.message}).` }
    }
  }

  // ---------------------------------------------------------------- helpers

  must(id) {
    const post = this.get(id)
    if (!post) throw new Error("That post is gone.")
    return post
  }

  ready(post) {
    if (!post.media.some((id) => this.library.get(id))) throw new Error("Add a picture or video first.")
    if (!post.platforms.length) throw new Error("Pick where it goes.")
    const words = postText(post)
    const over = post.platforms.find((p) => words.length > PLATFORMS[p].limit)
    if (over) throw new Error(`${PLATFORMS[over].label} takes ${PLATFORMS[over].limit.toLocaleString()} characters; this is ${words.length.toLocaleString()}.`)
    // The ad's compliance check covers the words it goes out with, too.
    const brand = this.brandFor(post)
    const block = brand && checkBrief({ hook: "", shots: [], endCard: {}, postCopy: { primaryText: words }, seconds: 0 }, brand).find((i) => i.severity === "block")
    if (block) throw new Error(`Not with these words: ${block.message}`)
  }

  /** The fields given, checked and tidied. */
  clean(fields) {
    const out = {}
    if (fields.title !== undefined) out.title = String(fields.title).trim().slice(0, 120)
    if (fields.text !== undefined) out.text = String(fields.text).slice(0, 63206)
    if (fields.hashtags !== undefined) out.hashtags = hashtagList(fields.hashtags)
    if (fields.platforms !== undefined) out.platforms = [...new Set((Array.isArray(fields.platforms) ? fields.platforms : []).filter((p) => PLATFORMS[p]))]
    if (fields.media !== undefined) {
      const ids = [...new Set(Array.isArray(fields.media) ? fields.media : [])].filter((id) => this.library.get(id))
      if (ids.length > MAX_MEDIA) throw new Error(`A post takes up to ${MAX_MEDIA} pictures or videos.`)
      out.media = ids
    }
    if (fields.from && typeof fields.from === "object") out.from = { runId: fields.from.runId ?? null, adId: fields.from.adId ?? null }
    return out
  }

  patch(post, changes) {
    this.store.patch("posts", post.id, { ...changes, updatedAt: this.now() })
    this.emit(post)
    return post
  }

  emit(post) {
    this.events.emit("post", post)
  }
}
