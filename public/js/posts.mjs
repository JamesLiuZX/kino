// Posts: what goes out, where and when. The list (what needs you now, what's
// scheduled by day, drafts, what went out) and the editor: the pictures and
// videos, the words with each platform's limit, where it goes, and when.
// Nothing is sent until you press Schedule or Send now; see src/posts.mjs.

import { h, icon, api, toast, fail, sheet, popover, closePopover, confirmDialog, copyText, timeAgo, replace } from "./ui.mjs"
import { state, on, isPart } from "./state.mjs"

const DOCS = "https://github.com/JamesLiuZX/kino/blob/main/docs/posting.md"
const STATUS = {
  draft: ["", "Draft"],
  scheduled: ["busy", "Scheduled"],
  sending: ["busy", "Sending"],
  sent: ["ok", "Sent"],
  due: ["warn", "Time to post"],
  failed: ["bad", "Didn't go"],
  missed: ["bad", "Missed"],
}

const platforms = () => state.boot.posting?.platforms ?? {}
const hasWebhook = () => !!state.boot.posting?.webhook
/** The words as they're posted: the text, then the hashtags not already in it (as the server does). */
export const postText = (p) => [String(p.text ?? "").trim(), (p.hashtags ?? []).filter((t) => !String(p.text ?? "").includes(t)).join(" ")].filter(Boolean).join("\n\n")
const whenText = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
const dayText = (ms) => {
  const d = new Date(ms)
  const today = new Date()
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000)
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
}
/** For <input type="datetime-local">: local time, to the minute. */
const localInput = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const tomorrowAt9 = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

function thumb(id) {
  const a = state.assets.get(id)
  if (!a) return h("span.post-thumb.gone", { title: "Deleted from the library" }, icon("alert"))
  return h("span.post-thumb", {}, a.kind === "video" ? h("video", { src: a.url, muted: true, preload: "metadata" }) : h("img", { src: a.thumbUrl ?? a.url, alt: "" }), a.kind === "video" ? icon("play") : null)
}

/** Start a post from anything (a result, a recipe's set, an ad) and open it. */
export async function newPost(fields) {
  try {
    openPostEditor(await api("/api/posts", { method: "POST", body: fields }))
  } catch (e) {
    fail(e)
  }
}

// ---------------------------------------------------------------- the list

export function mountPosts(root) {
  let posts = null
  const statusEl = h("p.posts-status")
  const listEl = h("div.post-sections")
  root.append(
    h(
      "div.page.posts",
      {},
      h(
        "header.page-head",
        {},
        h(
          "div",
          {},
          h("h1", {}, "Posts: what goes out, ", h("em", {}, "and when")),
          h("p.muted", {}, "Drafts stay drafts until you press Schedule. When a post is due, Kino sends it to your webhook (Zapier, Make, n8n, Buffer), or reminds you to post it by hand with the words and files ready."),
        ),
        h("button.btn.primary", { type: "button", onclick: () => newPost({}) }, icon("plus"), "New post"),
      ),
      statusEl,
      listEl,
    ),
  )

  function render() {
    replace(
      statusEl,
      hasWebhook()
        ? [h("span.status-inline.ok", {}, icon("check"), "Due posts go to your webhook."), " ", h("a.link", { href: "#/settings" }, "Settings")]
        : [h("span.status-inline.warn", {}, icon("info"), "No webhook yet: Kino reminds you when it's time."), " ", h("a.link", { href: "#/settings" }, "Add one in Settings → Posting")],
    )
    if (!posts) return replace(listEl, h("p.muted", {}, "Loading…"))
    if (!posts.length)
      return replace(
        listEl,
        h("div.empty-hero.small", {}, h("p.display-sm", {}, "Nothing here ", h("em", {}, "yet")), h("p.muted", {}, "Open anything in your library and press Post, or post a recipe's whole set from its page.")),
      )
    const now = posts.filter((p) => ["due", "failed", "missed", "sending"].includes(p.status))
    const scheduled = posts.filter((p) => p.status === "scheduled").sort((a, b) => a.at - b.at)
    const drafts = posts.filter((p) => p.status === "draft")
    const sent = posts.filter((p) => p.status === "sent").slice(0, 20)
    const days = new Map()
    for (const p of scheduled) {
      const key = dayText(p.at)
      if (!days.has(key)) days.set(key, [])
      days.get(key).push(p)
    }
    replace(
      listEl,
      now.length ? section("Needs you", now) : null,
      ...[...days].map(([day, list], i) => section(i ? day : `Scheduled · ${day}`, list)),
      drafts.length ? section("Drafts", drafts) : null,
      sent.length ? section("Sent", sent) : null,
    )
  }

  function section(title, list) {
    return h("section.post-section", {}, h("h2.section-title", {}, title), h("div.post-list", {}, ...list.map(card)))
  }

  function card(p) {
    const [kind, label] = STATUS[p.status] ?? ["", p.status]
    const words = postText(p)
    const when =
      p.status === "sent"
        ? `${p.by === "hand" ? "Posted by hand" : "Sent"} ${timeAgo(p.sentAt)}`
        : p.at
          ? whenText(p.at)
          : `Edited ${timeAgo(p.updatedAt)}`
    return h(
      "article.post-card",
      { onclick: (e) => !e.target.closest("button, a") && openPostEditor(p), tabindex: "0", onkeydown: (e) => e.key === "Enter" && e.target === e.currentTarget && openPostEditor(p) },
      h("div.post-thumbs", {}, ...p.media.slice(0, 3).map(thumb), p.media.length > 3 ? h("span.post-more", {}, `+${p.media.length - 3}`) : null, p.media.length ? null : h("span.post-thumb.empty", {}, icon("image"))),
      h(
        "div.post-main",
        {},
        h("div.post-top", {}, h(`span.pill.small${kind ? `.${kind}` : ""}`, {}, label), h("span.small.muted", {}, when)),
        h("strong.post-title", {}, p.title || words.split("\n")[0] || "Untitled post"),
        words && p.title ? h("p.post-words", {}, words) : null,
        h("div.row.wrap.post-platforms", {}, ...p.platforms.map((id) => h("span.pill.small", {}, platforms()[id]?.label ?? id))),
        p.error && p.status !== "sent" ? h("p.engine-error", {}, p.error) : null,
      ),
      h(
        "div.post-actions",
        {},
        p.status === "due" ? h("button.btn.small.accent", { type: "button", onclick: () => act(p, "posted") }, icon("check"), "Mark as posted") : null,
        p.status === "due" || p.status === "missed" || p.status === "failed" ? h("button.btn.small", { type: "button", onclick: () => copyText(words, "Words copied") }, icon("copy"), "Copy words") : null,
        p.media.length ? h("a.btn.small.ghost", { href: `/api/posts/${p.id}/zip`, download: "" }, icon("download"), "Download") : null,
      ),
    )
  }

  async function act(p, what) {
    try {
      await api(`/api/posts/${p.id}/${what}`, { method: "POST" })
    } catch (e) {
      fail(e)
    }
  }

  const upsert = (p) => {
    if (!posts) return
    const i = posts.findIndex((x) => x.id === p.id)
    if (i >= 0) posts[i] = p
    else posts.unshift(p)
    render()
  }
  const offs = [on("post", upsert), on("post-removed", ({ id }) => posts && ((posts = posts.filter((p) => p.id !== id)), render())), on("boot", render)]
  api("/api/posts").then((list) => ((posts = list), render()), fail)
  render()
  return () => offs.forEach((off) => off())
}

// ---------------------------------------------------------------- the editor

export function openPostEditor(post) {
  const draft = { title: post.title ?? "", text: post.text ?? "", hashtags: (post.hashtags ?? []).join(" "), platforms: new Set(post.platforms ?? []), media: [...(post.media ?? [])] }
  const mediaEl = h("div.post-media")
  const counts = h("div.post-counts")
  const errorEl = h("p.engine-error")
  const when = h("input.input", { type: "datetime-local", value: localInput(post.at ?? tomorrowAt9()), "aria-label": "When" })
  const title = h("input.input", { value: draft.title, placeholder: "A name for this list (not posted)", oninput: (e) => (draft.title = e.target.value) })
  const text = h("textarea.input", { rows: 7, placeholder: "What the post says", oninput: (e) => ((draft.text = e.target.value), renderCounts()) }, draft.text)
  const tags = h("input.input", { value: draft.hashtags, placeholder: "#skincare #weekendsale", oninput: (e) => ((draft.hashtags = e.target.value), renderCounts()) })
  const chips = h("div.row.wrap")
  const locked = post.status === "sent" || post.status === "sending"

  function renderMedia() {
    replace(
      mediaEl,
      ...draft.media.map((id, i) =>
        h(
          "div.post-media-item",
          {},
          thumb(id),
          locked ? null : h("button.icon-btn.small", { type: "button", "aria-label": "Take it out", onclick: () => (draft.media.splice(i, 1), renderMedia()) }, icon("x")),
        ),
      ),
      locked || draft.media.length >= 10 ? null : h("button.post-add", { type: "button", onclick: (e) => pick(e.currentTarget) }, icon("plus"), h("span", {}, "Add")),
    )
  }

  function pick(anchor) {
    const recent = [...state.assets.values()]
      .filter((a) => (a.kind === "image" || a.kind === "video") && !isPart(a) && !draft.media.includes(a.id))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 24)
    popover(
      anchor,
      h(
        "div.post-pick",
        {},
        recent.length
          ? recent.map((a) => h("button.pick", { type: "button", title: a.prompt || a.name || "", onclick: () => (draft.media.push(a.id), closePopover(), renderMedia()) }, a.kind === "video" ? h("video", { src: a.url, muted: true, preload: "metadata" }) : h("img", { src: a.thumbUrl ?? a.url, alt: "" })))
          : h("p.small.muted", {}, "Your library is empty."),
      ),
    )
  }

  function renderChips() {
    replace(
      chips,
      ...Object.entries(platforms()).map(([id, p]) =>
        h(
          `button.chip.small${draft.platforms.has(id) ? ".active" : ""}`,
          { type: "button", "aria-pressed": draft.platforms.has(id) ? "true" : "false", disabled: locked, onclick: () => (draft.platforms.has(id) ? draft.platforms.delete(id) : draft.platforms.add(id), renderChips(), renderCounts()) },
          p.label,
        ),
      ),
    )
  }

  function renderCounts() {
    const tagsList = draft.hashtags.split(/[\s,，]+/).map((t) => t.trim()).filter(Boolean).map((t) => `#${t.replace(/^#+/, "")}`)
    const n = postText({ text: draft.text, hashtags: tagsList }).length
    replace(counts, ...[...draft.platforms].map((id) => platforms()[id]).filter(Boolean).map((p) => h(`span.mono${n > p.limit ? ".over" : ""}`, {}, `${p.label} ${n.toLocaleString()}/${p.limit.toLocaleString()}`)))
  }

  const body = () => ({ title: draft.title, text: draft.text, hashtags: draft.hashtags, platforms: [...draft.platforms], media: draft.media })

  async function save({ quiet = false } = {}) {
    const saved = await api(`/api/posts/${post.id}`, { method: "PUT", body: body() })
    if (!quiet) toast("Saved as a draft")
    return saved
  }

  async function run(e, fn) {
    const btn = e.currentTarget
    errorEl.textContent = ""
    btn.classList.add("busy")
    try {
      if (await fn()) s.close()
    } catch (err) {
      errorEl.textContent = err.message
    } finally {
      btn.classList.remove("busy")
    }
  }

  const schedule = (e) =>
    run(e, async () => {
      const at = new Date(when.value).getTime()
      await save({ quiet: true })
      await api(`/api/posts/${post.id}/schedule`, { method: "POST", body: { at } })
      toast(`Scheduled for ${whenText(at)}${hasWebhook() ? "" : ". Kino will remind you then."}`, { kind: "ok" })
      if (!hasWebhook() && "Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {})
      return true
    })

  const sendNow = (e) =>
    run(e, async () => {
      await save({ quiet: true })
      const sent = await api(`/api/posts/${post.id}/send`, { method: "POST" })
      if (sent.status !== "sent") throw new Error(sent.error ?? "It didn't go.")
      toast("Sent to your webhook", { kind: "ok" })
      return true
    })

  const remove = (e) =>
    run(e, async () => {
      if (!(await confirmDialog("Delete this post? The pictures and videos stay in your library."))) return false
      await api(`/api/posts/${post.id}`, { method: "DELETE" })
      return true
    })

  const s = sheet(
    locked ? "Post" : post.status === "scheduled" ? "Scheduled post" : "Post",
    h(
      "div.post-editor",
      {},
      h("div.post-editor-media", {}, h("label.recipe-label", {}, "Pictures and videos"), mediaEl, h("small.muted", {}, "Up to 10. They go in this order.")),
      h(
        "div.post-editor-words",
        {},
        h("label.field", {}, h("span", {}, "Name"), title),
        h("label.field", {}, h("span", {}, "Words"), text),
        h("label.field", {}, h("span", {}, "Hashtags"), tags),
        h("div.field", {}, h("span", {}, "Where it goes"), chips, counts),
        locked ? null : h("label.field", {}, h("span", {}, "When"), when),
        post.status === "scheduled" ? h("p.small.muted", {}, `Goes out ${whenText(post.at)}${hasWebhook() ? " to your webhook" : "; Kino will remind you"}.`) : null,
        post.status === "sent" ? h("p.small.muted", {}, `${post.by === "hand" ? "Posted by hand" : "Sent"} ${whenText(post.sentAt)}.`) : null,
        errorEl,
        locked
          ? h("div.row.end", {}, h("button.btn", { type: "button", onclick: () => copyText(postText(post), "Words copied") }, icon("copy"), "Copy words"), h("a.btn", { href: `/api/posts/${post.id}/zip`, download: "" }, icon("download"), "Download"))
          : h(
              "div.post-buttons",
              {},
              h("button.icon-btn.ghost.danger", { type: "button", "aria-label": "Delete post", onclick: remove }, icon("trash")),
              h("span.spacer"),
              post.status === "scheduled" ? h("button.btn", { type: "button", onclick: (e) => run(e, async () => (await api(`/api/posts/${post.id}/unschedule`, { method: "POST" }), await save({ quiet: true }), toast("Back to drafts"), true)) }, "Unschedule") : null,
              h("button.btn", { type: "button", onclick: (e) => run(e, async () => (await save(), true)) }, "Save draft"),
              hasWebhook() ? h("button.btn", { type: "button", onclick: sendNow }, "Send now") : null,
              h("button.btn.accent", { type: "button", onclick: schedule }, icon("clock"), post.status === "scheduled" ? "Reschedule" : "Schedule"),
            ),
        h("p.small.muted", {}, "Nothing goes out until you press Schedule or Send now. ", h("a.link", { href: DOCS, target: "_blank", rel: "noopener" }, "How posting works")),
      ),
    ),
    { wide: true },
  )
  renderMedia()
  renderChips()
  renderCounts()
}
