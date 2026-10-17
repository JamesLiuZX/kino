// The activity tray: a ring in the top bar while anything is being made, a
// panel with each job's progress, and a toast when something finishes that
// you weren't looking at.

import { h, icon, api, toast, fail, popover, fmtSeconds, replace } from "./ui.mjs"
import { state, on, watched, appById } from "./state.mjs"
import { ring, openLightbox } from "./media.mjs"

const isLive = (j) => j.status === "running" || j.status === "queued"

/** Running work, with an ad's many shot jobs folded into one line. */
function liveItems() {
  const items = []
  const ads = new Map()
  for (const j of state.jobs.values()) {
    if (!isLive(j)) continue
    if (j.adId) {
      const ad = state.ads.get(j.adId)
      const it = ads.get(j.adId) ?? { kind: "ad", id: j.adId, title: ad?.brief?.title ?? "Your ad", jobs: [] }
      it.jobs.push(j)
      ads.set(j.adId, it)
    } else items.push({ kind: "job", id: j.id, job: j })
  }
  return [...items, ...ads.values()]
}

const progressOf = (it) => (it.kind === "job" ? it.job.progress ?? 0 : it.jobs.reduce((a, j) => a + (j.progress ?? 0), 0) / it.jobs.length)

export function activityButton() {
  const btn = h("button.activity-btn", { type: "button", hidden: true, "aria-label": "What's being made", title: "What's being made" })
  let pop = null
  const render = () => {
    const items = liveItems()
    btn.hidden = items.length === 0
    if (items.length) {
      const p = items.reduce((a, it) => a + progressOf(it), 0) / items.length
      replace(btn, ring(p, p === 0), h("span", {}, String(items.length)), h("span.act-text", {}, "making"))
    }
    if (pop?.panel.isConnected) replace(pop.panel, panel())
  }
  btn.addEventListener("click", () => {
    pop = popover(btn, panel(), { align: "end", className: "pop-activity" })
  })
  on("job", render)
  on("job-removed", render)
  on("ad", render)
  render()
  return btn
}

function panel() {
  const items = liveItems()
  const done = [...state.jobs.values()]
    .filter((j) => j.status === "done" && !j.adId && j.outputs?.[0] && state.assets.get(j.outputs[0]))
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
    .slice(0, 5)
  return h(
    "div.activity",
    {},
    h("h3", {}, "Making now"),
    items.length ? h("div", {}, ...items.map(liveRow)) : h("p.act-empty", {}, "Nothing running. Everything you start shows up here."),
    done.length ? h("h3", {}, "Just finished") : null,
    ...done.map(doneRow),
  )
}

function thumbFor(job) {
  const input = Object.values(job.values ?? {}).map((v) => (typeof v === "string" ? state.assets.get(v) : null)).find((a) => a && a.kind === "image")
  return input ? h("img", { src: input.thumbUrl ?? input.url, alt: "" }) : icon(job.output === "video" ? "film" : "image")
}

function liveRow(it) {
  const p = progressOf(it)
  if (it.kind === "ad") {
    return h(
      "a.act-item",
      { href: "#/ads" },
      h("span.act-thumb", {}, icon("megaphone")),
      h("div", {}, h("p.act-title", {}, it.title), h("p.act-meta", {}, `Ad · ${it.jobs.length} part${it.jobs.length > 1 ? "s" : ""} in progress`), h("div.act-bar", {}, h("i", { style: { width: `${Math.round(p * 100)}%` } }))),
      h("span"),
    )
  }
  const j = it.job
  const app = appById(j.appId)
  const elapsed = j.startedAt ? (Date.now() - j.startedAt) / 1000 : 0
  const eta = j.status === "running" && j.estimate ? Math.max(0, j.estimate - elapsed) : null
  return h(
    "div.act-item",
    {},
    h("span.act-thumb", {}, thumbFor(j)),
    h(
      "div",
      { style: { minWidth: 0 } },
      h("p.act-title", {}, j.values?.prompt || app?.label || j.appLabel || "Working"),
      h("p.act-meta", {}, [j.status === "queued" ? "Queued" : j.message || "Working", p ? `${Math.round(p * 100)}%` : null, eta ? `~${fmtSeconds(eta)} left` : null].filter(Boolean).join(" · ")),
      h("div.act-bar", {}, h("i", { style: { width: `${Math.round(Math.max(0.03, p) * 100)}%` } })),
    ),
    h("button.icon-btn.ghost.small", { type: "button", "aria-label": "Cancel", title: "Cancel", onclick: () => api(`/api/jobs/${j.id}/cancel`, { method: "POST" }).catch(fail) }, icon("x")),
  )
}

function doneRow(j) {
  const a = state.assets.get(j.outputs[0])
  return h(
    "button.act-item",
    { type: "button", style: { border: 0, background: "none", textAlign: "left", width: "100%" }, onclick: () => openLightbox(a.id, [a.id]) },
    h("span.act-thumb", {}, a.kind === "video" ? h("video", { src: a.url, muted: true, preload: "metadata" }) : h("img", { src: a.thumbUrl ?? a.url, alt: "" })),
    h("div", { style: { minWidth: 0 } }, h("p.act-title", {}, a.prompt || a.name || appById(a.appId)?.label || "Result"), h("p.act-meta", {}, appById(a.appId)?.label ?? a.kind)),
    icon("arrow-right"),
  )
}

/** Toast finished work the current screen isn't already showing. */
export function watchCompletions() {
  const seen = new Map([...state.jobs.values()].map((j) => [j.id, j.status]))
  const seenAds = new Map([...state.ads.values()].map((a) => [a.id, a.status]))
  on("job", (j) => {
    const before = seen.get(j.id)
    seen.set(j.id, j.status)
    if (before === j.status || j.adId || watched.has(j.id) || state.view === "studio") return
    if (j.status === "done") {
      const id = j.outputs?.[0]
      toast(`Ready: ${appById(j.appId)?.label ?? "your result"}`, { kind: "ok", action: id ? { label: "View", run: () => openLightbox(id, [id]) } : undefined, timeout: 7000 })
    } else if (j.status === "failed") toast(`${appById(j.appId)?.label ?? "A job"} didn't work: ${j.error ?? "see the Library"}`, { kind: "error", timeout: 8000 })
  })
  on("ad", (a) => {
    const before = seenAds.get(a.id)
    seenAds.set(a.id, a.status)
    if (before === a.status || watched.has(`ad:${a.id}`)) return
    if (a.status === "done") toast(`Your ad “${a.brief?.title ?? ""}” is ready`, { kind: "ok", action: { label: "View", run: () => (location.hash = "#/ads") }, timeout: 8000 })
    if (a.status === "failed") toast(`Your ad needs attention: ${a.error ?? "open Ads"}`, { kind: "error", timeout: 8000 })
  })
}
