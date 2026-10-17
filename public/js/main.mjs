// Boot, navigation and the live event stream.

import { h, icon, api, toast, replace } from "./ui.mjs"
import { state, on, emit } from "./state.mjs"
import { mountCreate } from "./create.mjs"
import { mountLibrary } from "./library.mjs"
import { mountAds } from "./ads.mjs"
import { mountApps } from "./apps.mjs"
import { mountSettings } from "./settings.mjs"

const VIEWS = {
  create: { label: "Create", icon: "sparkles", mount: mountCreate },
  library: { label: "Library", icon: "grid", mount: mountLibrary },
  ads: { label: "Ad Studio", icon: "megaphone", mount: mountAds },
  apps: { label: "Apps", icon: "puzzle", mount: mountApps },
  settings: { label: "Settings", icon: "settings", mount: mountSettings },
}

const app = document.getElementById("app")
let unmount = null
let current = null

async function boot() {
  try {
    state.boot = await api("/api/bootstrap")
  } catch (e) {
    if (e.status === 401) return login()
    replace(app, h("div.fatal", {}, h("h1", {}, "Kino can't start"), h("p", {}, e.message)))
    return
  }
  const [assets, jobs, ads] = await Promise.all([api("/api/assets?limit=500"), api("/api/jobs"), api("/api/ads")])
  for (const a of assets) state.assets.set(a.id, a)
  // Ad parts aren't in the main list but ads and jobs refer to them.
  for (const a of await api("/api/assets?source=ad-part&limit=500")) state.assets.set(a.id, a)
  for (const j of jobs) state.jobs.set(j.id, j)
  for (const a of ads) state.ads.set(a.id, a)
  shell()
  connect()
  addEventListener("hashchange", route)
  route()
}

function shell() {
  const nav = h(
    "nav.rail",
    { "aria-label": "Main" },
    h("a.brand", { href: "#/create", "aria-label": "Kino" }, h("span.brand-mark", {}, "K"), h("span.brand-name", {}, "Kino")),
    h("div.rail-links", {}, ...Object.entries(VIEWS).map(([id, v]) => h("a.rail-link", { href: `#/${id}`, dataset: { view: id } }, icon(v.icon), h("span", {}, v.label)))),
    h("a.rail-status", { href: "#/settings", title: "Where models run" }, h("span.dot"), h("span.rail-status-label")),
  )
  replace(app, nav, h("main.view", { id: "view" }))
  renderStatus()
}

function renderStatus() {
  const p = state.boot.provider
  const dot = app.querySelector(".rail-status .dot")
  const label = app.querySelector(".rail-status-label")
  if (!dot) return
  dot.className = `dot ${p.error ? "bad" : p.id === "mock" ? "warn" : "ok"}`
  label.textContent = p.id === "mock" ? "Demo mode" : p.id === "runpod" ? "RunPod" : "ComfyUI"
  app.querySelector(".rail-status").title = p.label
}

function route() {
  const id = (location.hash.replace(/^#\/?/, "").split("/")[0] || "create").toLowerCase()
  const view = VIEWS[id] ? id : "create"
  if (view === current && unmount) return
  unmount?.()
  current = view
  const container = document.getElementById("view")
  container.replaceChildren()
  container.dataset.view = view
  unmount = VIEWS[view].mount(container) ?? null
  for (const a of app.querySelectorAll(".rail-link")) a.classList.toggle("active", a.dataset.view === view)
  document.title = `${VIEWS[view].label} · Kino`
}

// Remix / Animate / Edit from anywhere lands in Create with the values loaded.
on("compose", (req) => {
  if (current === "create") return
  window.__kinoCompose = req
  location.hash = "#/create"
})

function connect() {
  const es = new EventSource("/api/events")
  es.addEventListener("job", (e) => {
    const j = JSON.parse(e.data)
    state.jobs.set(j.id, j)
    emit("job", j)
  })
  es.addEventListener("job-removed", (e) => {
    const { id } = JSON.parse(e.data)
    state.jobs.delete(id)
    emit("job-removed", { id })
  })
  es.addEventListener("asset", (e) => {
    const a = JSON.parse(e.data)
    state.assets.set(a.id, a)
    emit("asset", a)
  })
  es.addEventListener("asset-removed", (e) => {
    const { id } = JSON.parse(e.data)
    state.assets.delete(id)
    emit("asset-removed", { id })
  })
  es.addEventListener("ad", (e) => {
    const a = JSON.parse(e.data)
    state.ads.set(a.id, a)
    emit("ad", a)
  })
  es.addEventListener("ad-removed", (e) => {
    const { id } = JSON.parse(e.data)
    state.ads.delete(id)
    emit("ad-removed", { id })
  })
  es.addEventListener("apps", async () => {
    state.boot = await api("/api/bootstrap")
    emit("boot", state.boot)
  })
  es.addEventListener("settings", async () => {
    state.boot = await api("/api/bootstrap")
    renderStatus()
    emit("boot", state.boot)
  })
  let warned = false
  es.onerror = () => {
    if (!warned && es.readyState !== EventSource.OPEN) {
      warned = true
      toast("Lost the connection to the studio. Reconnecting…", { kind: "error", timeout: 3000 })
    }
  }
  es.onopen = () => (warned = false)
}

on("boot", renderStatus)

function login() {
  const input = h("input.input", { type: "password", placeholder: "Access code", "aria-label": "Access code", autocomplete: "current-password" })
  const error = h("p.error")
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api("/api/login", { method: "POST", body: { token: input.value } })
      location.reload()
    } catch (err) {
      error.textContent = err.message
    }
  }
  replace(app, h("form.login", { onsubmit: submit }, h("span.brand-mark.big", {}, "K"), h("h1", {}, "Kino"), h("p.muted", {}, "This studio is protected. Enter its access code."), input, h("button.btn.primary.block", { type: "submit" }, "Enter"), error))
  input.focus()
}

addEventListener("kino:auth", () => login())
boot()
