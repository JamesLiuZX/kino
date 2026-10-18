// Small DOM toolkit: hyperscript, icons, toasts, popovers, sheets, and the API
// client. No framework; views re-render the regions they own.

export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split(".")
  const el = document.createElement(name || "div")
  if (classes.length) el.className = classes.join(" ")
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue
    if (k === "class") el.className = [el.className, v].filter(Boolean).join(" ")
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v)
    else if (k === "dataset") Object.assign(el.dataset, v)
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === "html") el.innerHTML = v
    else if (v === true) {
      el.setAttribute(k, "")
      // The attribute alone doesn't mute a script-made video, and unmuted videos can't autoplay.
      if (k === "muted") el.muted = true
    }
    else el.setAttribute(k, v)
  }
  append(el, children)
  return el
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

export function icon(name, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", `icon ${cls}`.trim())
  svg.setAttribute("aria-hidden", "true")
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use")
  use.setAttribute("href", `#i-${name}`)
  svg.append(use)
  return svg
}

export function replace(el, ...children) {
  el.replaceChildren()
  append(el, children)
  return el
}

// ---------------------------------------------------------------- API

export class ApiError extends Error {}

export async function api(path, { method = "GET", body, headers = {} } = {}) {
  if (window.kinoDemo) {
    try {
      return await window.kinoDemo.api(path, { method, body })
    } catch (err) {
      throw Object.assign(new ApiError(err.message), { status: err.status ?? 400 })
    }
  }
  const init = { method, headers: { ...headers } }
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const res = await fetch(path, init)
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { error: text }
  }
  if (res.status === 401 && path !== "/api/login") window.dispatchEvent(new CustomEvent("kino:auth"))
  if (!res.ok) {
    const e = new ApiError(data.error ?? `Request failed (${res.status})`)
    e.status = res.status
    throw e
  }
  return data
}

/** Upload with progress (fetch can't report upload progress). */
export function upload(file, onProgress = () => {}) {
  if (window.kinoDemo) return window.kinoDemo.upload(file, onProgress).catch((err) => Promise.reject(new ApiError(err.message)))
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/assets")
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name || "upload"))
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      let data = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new ApiError(data.error ?? `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new ApiError("Upload failed: the studio didn't answer."))
    xhr.send(file)
  })
}

// ---------------------------------------------------------------- feedback

let toastRoot
export function toast(message, { kind = "info", action, timeout = 4200 } = {}) {
  toastRoot ??= document.body.appendChild(h("div.toasts", { role: "status", "aria-live": "polite" }))
  const el = h(
    `div.toast.${kind}`,
    {},
    icon(kind === "error" ? "alert" : kind === "ok" ? "check" : "info"),
    h("span", {}, message),
    action ? h("button.link", { onclick: () => (action.run(), close()) }, action.label) : null,
    h("button.icon-btn.ghost", { "aria-label": "Dismiss", onclick: () => close() }, icon("x")),
  )
  const close = () => {
    el.classList.add("leaving")
    setTimeout(() => el.remove(), 180)
  }
  toastRoot.append(el)
  if (timeout) setTimeout(close, timeout)
  return close
}

export const fail = (e) => toast(e?.message ?? String(e), { kind: "error", timeout: 7000 })

// ---------------------------------------------------------------- popovers

let openPopover = null

export function closePopover() {
  openPopover?.close()
}

/** Anchor a floating panel to an element; closes on outside click or Esc. */
export function popover(anchor, content, { align = "start", className = "" } = {}) {
  closePopover()
  const panel = h(`div.popover.${className}`.replace(/\.$/, ""), { role: "dialog" }, content)
  document.body.append(panel)
  const place = () => {
    const r = anchor.getBoundingClientRect()
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    let left = align === "end" ? r.right - pw : r.left
    left = Math.max(8, Math.min(left, innerWidth - pw - 8))
    const above = r.top - ph - 10
    const top = above > 8 ? above : Math.min(r.bottom + 10, innerHeight - ph - 8)
    panel.style.left = `${left}px`
    panel.style.top = `${Math.max(8, top)}px`
  }
  place()
  const onDown = (e) => !panel.contains(e.target) && !anchor.contains(e.target) && close()
  const onKey = (e) => e.key === "Escape" && close()
  const close = () => {
    panel.remove()
    document.removeEventListener("pointerdown", onDown, true)
    document.removeEventListener("keydown", onKey)
    removeEventListener("resize", place)
    anchor.setAttribute("aria-expanded", "false")
    if (openPopover?.panel === panel) openPopover = null
  }
  setTimeout(() => document.addEventListener("pointerdown", onDown, true))
  document.addEventListener("keydown", onKey)
  addEventListener("resize", place)
  anchor.setAttribute("aria-expanded", "true")
  openPopover = { panel, close, place }
  return openPopover
}

/** A centred modal sheet. Returns {close}. */
export function sheet(title, content, { wide = false, onClose } = {}) {
  closePopover()
  const prev = document.activeElement
  const close = () => {
    root.classList.add("leaving")
    document.removeEventListener("keydown", onKey)
    setTimeout(() => root.remove(), 160)
    onClose?.()
    prev?.focus?.()
  }
  const onKey = (e) => e.key === "Escape" && close()
  const root = h(
    "div.sheet-backdrop",
    { onclick: (e) => e.target === root && close() },
    h(
      `div.sheet${wide ? ".wide" : ""}`,
      { role: "dialog", "aria-modal": "true", "aria-label": title },
      h("header.sheet-head", {}, h("h2", {}, title), h("button.icon-btn.ghost", { "aria-label": "Close", onclick: close }, icon("x"))),
      h("div.sheet-body", {}, content),
    ),
  )
  document.body.append(root)
  document.addEventListener("keydown", onKey)
  setTimeout(() => root.querySelector("button, input, textarea, select, [tabindex]")?.focus(), 30)
  return { close, root }
}

export function confirmDialog(message, { confirm = "Delete", danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      s.close()
      resolve(v)
    }
    const s = sheet(
      "Are you sure?",
      h(
        "div.confirm",
        {},
        h("p", {}, message),
        h("div.row.end", {}, h("button.btn", { onclick: () => finish(false) }, "Cancel"), h(`button.btn${danger ? ".danger" : ".primary"}`, { onclick: () => finish(true) }, confirm)),
      ),
      { onClose: () => finish(false) },
    )
  })
}

// ---------------------------------------------------------------- formatting

export const fmtSeconds = (s) => (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`)
export const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

export function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000
  if (s < 45) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(ts).toLocaleDateString()
}

export function copyText(text, label = "Copied") {
  navigator.clipboard?.writeText(text).then(
    () => toast(label, { kind: "ok", timeout: 1800 }),
    () => toast("Couldn't copy. Select the text and copy it yourself.", { kind: "error" }),
  )
}

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`kino:${key}`)
      return v === null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`kino:${key}`, JSON.stringify(value))
    } catch {}
  },
}

/** A small aspect-ratio glyph: a rectangle of the right shape. */
export function aspectGlyph(aw, ah, max = 16) {
  const s = max / Math.max(aw, ah)
  return h("span.aspect-glyph", { style: { width: `${Math.round(aw * s)}px`, height: `${Math.round(ah * s)}px` } })
}
