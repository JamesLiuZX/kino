// Media tiles (generated results, uploads, jobs in flight), the masonry grid
// they sit in, and the lightbox. Shared by Create, Library and the Ad Studio.

import { h, icon, api, toast, fail, confirmDialog, fmtSeconds, fmtBytes, timeAgo, copyText, replace } from "./ui.mjs"
import { state, emit, appById, compose, cameraById, styleById, aspectById, audioById } from "./state.mjs"

const ROW = 6

/** Masonry with left-to-right order: each card spans rows by its aspect ratio. */
export function masonry(grid) {
  const layout = () => {
    const style = getComputedStyle(grid)
    const gap = parseFloat(style.rowGap) || 12
    const cols = style.gridTemplateColumns.split(" ").filter(Boolean).length || 1
    const colW = (grid.clientWidth - gap * (cols - 1)) / cols
    for (const card of grid.children) {
      const ratio = parseFloat(card.dataset.ratio) || 1
      const extra = parseFloat(card.dataset.extra) || 0
      const height = colW / ratio + extra
      card.style.gridRowEnd = `span ${Math.max(1, Math.ceil((height + gap) / (ROW + gap)))}`
    }
  }
  const ro = new ResizeObserver(layout)
  ro.observe(grid)
  return { layout, disconnect: () => ro.disconnect() }
}

export const ratioOf = (a) => (a?.width && a?.height ? a.width / a.height : 1)

function mediaEl(asset, { autoplay = false, controls = false, thumb = true } = {}) {
  if (asset.kind === "video") {
    const v = h("video", {
      src: asset.url,
      poster: thumb ? asset.thumbUrl ?? undefined : undefined,
      muted: !controls,
      loop: true,
      playsinline: true,
      preload: controls ? "auto" : "metadata",
      controls,
      autoplay: autoplay || controls,
    })
    v.muted = !controls
    return v
  }
  if (asset.kind === "audio") return h("div.audio-tile", {}, icon("volume"), h("span", {}, asset.name || "Audio"), controls ? h("audio", { src: asset.url, controls: true }) : null)
  return h("img", { src: thumb ? asset.thumbUrl ?? asset.url : asset.url, alt: asset.prompt || asset.name || "", loading: "lazy", decoding: "async" })
}

/** Actions available on an asset, shared by tiles and the lightbox. */
export function actionsFor(asset) {
  const out = []
  const gen = (appId, values, label) => async () => {
    try {
      await api("/api/generate", { method: "POST", body: { app: appId, values } })
      toast(`${label}…`, { kind: "ok", timeout: 2200 })
    } catch (e) {
      fail(e)
    }
  }
  if (asset.kind === "image") {
    out.push({ id: "animate", label: "Animate", icon: "film", run: () => compose({ tool: "video", appId: "video-pro", values: { image: asset.id }, focus: true }) })
    out.push({ id: "edit", label: "Edit", icon: "wand", run: () => compose({ tool: "edit", appId: "edit", values: { image: asset.id }, focus: true }) })
    out.push({ id: "upscale", label: "Upscale", icon: "maximize", run: gen("upscale-image", { image: asset.id, scale: "2x" }, "Upscaling") })
    out.push({ id: "cutout", label: "Remove background", icon: "scissors", run: gen("cutout", { image: asset.id }, "Removing the background") })
    out.push({ id: "talk", label: "Make it talk", icon: "mic", run: () => compose({ tool: "talk", appId: "talk", values: { image: asset.id } }) })
  }
  if (asset.kind === "video") {
    out.push({ id: "upscale", label: "Upscale video", icon: "maximize", run: gen("upscale-video", { video: asset.id, scale: "2x" }, "Upscaling") })
    out.push({ id: "smooth", label: "Smooth motion", icon: "zap", run: gen("smooth", { video: asset.id, factor: "2x" }, "Smoothing") })
  }
  if (asset.kind === "audio") out.push({ id: "talk", label: "Use as voice", icon: "mic", run: () => compose({ tool: "talk", appId: "talk", values: { audio: asset.id } }) })
  if (asset.appId && appById(asset.appId)) out.push({ id: "remix", label: "Remix", icon: "shuffle", run: () => compose({ tool: appById(asset.appId).tool, appId: asset.appId, values: asset.values ?? {}, focus: true }) })
  return out
}

async function toggleFavorite(asset) {
  try {
    const row = await api(`/api/assets/${asset.id}`, { method: "PATCH", body: { favorite: !asset.favorite } })
    state.assets.set(row.id, row)
    emit("asset", row)
  } catch (e) {
    fail(e)
  }
}

async function removeAsset(asset) {
  if (!(await confirmDialog("Delete this from your library? This can't be undone."))) return false
  await api(`/api/assets/${asset.id}`, { method: "DELETE" }).catch(fail)
  return true
}

function download(asset) {
  const a = h("a", { href: asset.url, download: downloadName(asset) })
  document.body.append(a)
  a.click()
  a.remove()
}

const downloadName = (asset) => {
  const ext = asset.file.split(".").pop()
  const base = (asset.prompt || asset.name || asset.model || "kino").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 48).replace(/^-|-$/g, "")
  return `${base || "kino"}-${asset.id.slice(-6)}.${ext}`
}

/** A finished tile. `list` (asset ids) lets the lightbox page through siblings. */
export function assetCard(asset, { list = () => [asset.id], badge } = {}) {
  const card = h("article.tile", { dataset: { ratio: ratioOf(asset), id: asset.id }, tabindex: "0", "aria-label": asset.prompt || asset.name || asset.kind })
  const media = mediaEl(asset)
  card.append(h("div.tile-media", {}, media))
  if (asset.kind === "video") {
    card.addEventListener("pointerenter", () => media.play?.().catch(() => {}))
    card.addEventListener("pointerleave", () => {
      media.pause?.()
      if (media.currentTime) media.currentTime = 0
    })
    card.append(h("span.tile-chip.left", {}, icon("play"), asset.duration ? fmtSeconds(asset.duration) : "Video"))
  }
  if (asset.demo) card.append(h("span.tile-chip.right.demo", { title: "Made in demo mode: a placeholder, not a model result" }, "Demo"))
  else if (badge) card.append(h("span.tile-chip.right", {}, badge))
  if (asset.favorite) card.append(h("span.tile-fav", {}, icon("heart-fill")))

  const quick = actionsFor(asset).slice(0, 3)
  card.append(
    h(
      "div.tile-overlay",
      {},
      asset.prompt ? h("p.tile-prompt", {}, asset.prompt) : asset.name ? h("p.tile-prompt", {}, asset.name) : null,
      h(
        "div.tile-actions",
        {},
        ...quick.map((a) => h("button.chip.small", { onclick: (e) => (e.stopPropagation(), a.run()), title: a.label }, icon(a.icon), h("span", {}, a.label))),
        h("span.spacer"),
        h("button.icon-btn.small", { "aria-label": asset.favorite ? "Unfavourite" : "Favourite", onclick: (e) => (e.stopPropagation(), toggleFavorite(asset)) }, icon(asset.favorite ? "heart-fill" : "heart")),
        h("button.icon-btn.small", { "aria-label": "Download", onclick: (e) => (e.stopPropagation(), download(asset)) }, icon("download")),
      ),
    ),
  )
  const open = () => openLightbox(asset.id, list())
  card.addEventListener("click", open)
  card.addEventListener("keydown", (e) => e.key === "Enter" && open())
  return card
}

/** A job that hasn't produced a file yet (or failed). */
export function jobCard(job, { onRemove } = {}) {
  const app = appById(job.appId)
  const ratio = expectedRatio(job)
  const card = h(`article.tile.job.${job.status}`, { dataset: { ratio, id: job.id } })
  const prompt = job.values?.prompt || app?.label || job.appLabel
  const elapsed = job.startedAt ? (Date.now() - job.startedAt) / 1000 : 0
  if (job.status === "failed" || job.status === "canceled") {
    card.append(
      h(
        "div.job-body",
        {},
        h("div.job-icon", {}, icon(job.status === "failed" ? "alert" : "x")),
        h("p.job-title", {}, job.status === "failed" ? "Didn't work" : "Canceled"),
        job.error ? h("p.job-error", {}, job.error) : null,
        h("p.job-prompt", {}, prompt),
        h(
          "div.row.center",
          {},
          h("button.chip.small", { onclick: () => api(`/api/jobs/${job.id}/retry`, { method: "POST" }).catch(fail) }, icon("refresh"), "Try again"),
          h("button.chip.small.ghost", { onclick: () => (api(`/api/jobs/${job.id}`, { method: "DELETE" }).catch(fail), onRemove?.()) }, "Remove"),
        ),
      ),
    )
    return card
  }
  const pct = Math.round((job.progress ?? 0) * 100)
  const eta = job.status === "running" && job.estimate ? Math.max(0, job.estimate - elapsed) : null
  card.append(
    h("div.job-shimmer"),
    h(
      "div.job-body",
      {},
      ring(job.progress ?? 0, job.status === "queued"),
      h("p.job-title", {}, job.status === "queued" ? "Queued" : job.message || "Working"),
      h("p.job-meta", {}, [app?.label ?? job.appLabel, job.status === "running" && pct ? `${pct}%` : null, eta && pct < 95 ? `~${fmtSeconds(eta)} left` : null].filter(Boolean).join(" · ")),
      h("p.job-prompt", {}, prompt),
      h("button.chip.small.ghost", { onclick: () => api(`/api/jobs/${job.id}/cancel`, { method: "POST" }).catch(fail) }, "Cancel"),
    ),
  )
  return card
}

function ring(p, indeterminate) {
  const r = 18
  const c = 2 * Math.PI * r
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 44 44")
  svg.setAttribute("class", `ring${indeterminate ? " spin" : ""}`)
  svg.innerHTML = `<circle cx="22" cy="22" r="${r}" class="ring-track"/><circle cx="22" cy="22" r="${r}" class="ring-bar" stroke-dasharray="${c}" stroke-dashoffset="${indeterminate ? c * 0.72 : c * (1 - Math.max(0.03, p))}"/>`
  return svg
}

function expectedRatio(job) {
  const v = job.values ?? {}
  const firstFile = Object.values(v).map((x) => (typeof x === "string" ? state.assets.get(x) : null)).find((a) => a?.width)
  if (v.aspect) {
    const a = aspectById(v.aspect)
    if (a) return a.w / a.h
  }
  if (firstFile) return ratioOf(firstFile)
  return job.output === "video" ? 9 / 16 : 1
}

// ---------------------------------------------------------------- lightbox

export function openLightbox(id, list = [id]) {
  let index = Math.max(0, list.indexOf(id))
  const root = h("div.lightbox", { role: "dialog", "aria-modal": "true" })
  const stage = h("div.lb-stage")
  const side = h("aside.lb-side")
  const close = () => {
    root.remove()
    document.removeEventListener("keydown", onKey)
  }
  const go = (d) => {
    if (list.length < 2) return
    index = (index + d + list.length) % list.length
    render()
  }
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea")) return
    if (e.key === "Escape") close()
    if (e.key === "ArrowRight") go(1)
    if (e.key === "ArrowLeft") go(-1)
  }
  root.append(
    h("button.icon-btn.lb-close", { "aria-label": "Close", onclick: close }, icon("x")),
    list.length > 1 ? h("button.icon-btn.lb-nav.prev", { "aria-label": "Previous", onclick: () => go(-1) }, icon("chevron-left")) : null,
    list.length > 1 ? h("button.icon-btn.lb-nav.next", { "aria-label": "Next", onclick: () => go(1) }, icon("chevron-right")) : null,
    stage,
    side,
  )
  root.addEventListener("click", (e) => e.target === root && close())

  function render() {
    const asset = state.assets.get(list[index])
    if (!asset) return close()
    replace(stage, mediaEl(asset, { controls: true, thumb: false }))
    const app = appById(asset.appId)
    const v = asset.values ?? {}
    const facts = [
      app ? ["Model", app.model] : asset.model ? ["Model", asset.model] : null,
      asset.width ? ["Size", `${asset.width} × ${asset.height}`] : null,
      asset.duration ? ["Length", fmtSeconds(asset.duration)] : null,
      v.aspect ? ["Aspect", v.aspect] : null,
      v.camera ? ["Camera", cameraById(v.camera)?.label ?? v.camera] : null,
      v.style && v.style !== "none" ? ["Style", styleById(v.style)?.label ?? v.style] : null,
      v.audio && audioById(v.audio) ? ["Sound", audioById(v.audio).label] : null,
      asset.seed !== undefined ? ["Seed", String(asset.seed)] : null,
      ["File", `${asset.file.split(".").pop().toUpperCase()} · ${fmtBytes(asset.bytes ?? 0)}`],
      ["Made", timeAgo(asset.createdAt)],
    ].filter(Boolean)
    const parents = (asset.parents ?? []).map((pid) => state.assets.get(pid)).filter(Boolean)
    replace(
      side,
      h("div.lb-head", {}, h("span.pill", {}, app?.label ?? (asset.source === "upload" ? "Upload" : asset.source === "ad" ? "Ad" : asset.kind)), asset.demo ? h("span.pill.warn", {}, "Demo result") : null),
      asset.prompt
        ? h("div.lb-prompt", {}, h("p", {}, asset.prompt), h("button.chip.small.ghost", { onclick: () => copyText(asset.prompt, "Prompt copied") }, icon("copy"), "Copy prompt"))
        : asset.name
          ? h("p.lb-name", {}, asset.name)
          : null,
      h("dl.facts", {}, ...facts.flatMap(([k, val]) => [h("dt", {}, k), h("dd", {}, val)])),
      parents.length
        ? h("div.lb-lineage", {}, h("h4", {}, "Made from"), h("div.row.wrap", {}, ...parents.map((p) => h("button.lineage-thumb", { onclick: () => openLightbox(p.id, [p.id]), "aria-label": "Open source" }, mediaEl(p)))))
        : null,
      h(
        "div.lb-actions",
        {},
        ...actionsFor(asset).map((a) => h("button.btn.block", { onclick: () => (a.run(), close()) }, icon(a.icon), a.label)),
        h(
          "div.row",
          {},
          h("button.btn.grow", { onclick: () => download(asset) }, icon("download"), "Download"),
          h("button.icon-btn", { "aria-label": asset.favorite ? "Unfavourite" : "Favourite", onclick: () => toggleFavorite(asset).then(render) }, icon(asset.favorite ? "heart-fill" : "heart")),
          h("button.icon-btn.danger", { "aria-label": "Delete", onclick: async () => (await removeAsset(asset)) && (list.splice(index, 1), list.length ? render() : close()) }, icon("trash")),
        ),
      ),
    )
  }
  document.body.append(root)
  document.addEventListener("keydown", onKey)
  render()
  return close
}

export { mediaEl, download }
