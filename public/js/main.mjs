// Boot, the top bar (navigation, Simple/Advanced, activity, status), routing
// and the live event stream.

import { h, icon, api, toast, replace } from "./ui.mjs"
import { state, on, emit, mode, setMode, viewState, isWeb, providerName } from "./state.mjs"
import { mountCreate } from "./create.mjs"
import { mountLibrary } from "./library.mjs"
import { mountAds } from "./ads.mjs"
import { mountAdsSimple } from "./ads-simple.mjs"
import { mountApps } from "./apps.mjs"
import { mountSettings } from "./settings.mjs"
import { mountHome } from "./home.mjs"
import { mountFlow, taskForCompose, openTask } from "./flow.mjs"
import { activityButton, watchCompletions } from "./activity.mjs"

const ROUTES = {
  home: { title: "Make", mount: (el) => mountHome(el) },
  make: { title: "Make", mount: (el, arg) => mountFlow(el, arg) },
  studio: { title: "Studio", mount: (el) => mountCreate(el) },
  ads: { title: "Ads", mount: (el) => (mode.value === "advanced" ? mountAds(el) : mountAdsSimple(el)) },
  library: { title: "Library", mount: (el) => mountLibrary(el) },
  apps: { title: "Apps", mount: (el) => mountApps(el) },
  settings: { title: "Settings", mount: (el) => mountSettings(el) },
}

const NAV = {
  simple: [
    { id: "home", label: "Make", icon: "sparkles", match: ["home", "make"] },
    { id: "ads", label: "Ads", icon: "megaphone" },
    { id: "library", label: "Library", icon: "grid" },
  ],
  advanced: [
    { id: "studio", label: "Studio", icon: "sliders" },
    { id: "ads", label: "Ads", icon: "megaphone" },
    { id: "library", label: "Library", icon: "grid" },
    { id: "apps", label: "Apps", icon: "puzzle" },
  ],
}

const app = document.getElementById("app")
let unmount = null
let current = null
let navEl, bottomEl, toggleEl, statusEl

async function boot() {
  try {
    state.boot = await api("/api/bootstrap")
  } catch (e) {
    if (e.status === 401) return login()
    replace(app, h("div.fatal", {}, h("span.brand-mark.big", {}, "K"), h("h1", {}, "Kino can't start"), h("p.muted", {}, e.message)))
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
  watchCompletions()
  addEventListener("hashchange", () => route())
  route()
}

// ---------------------------------------------------------------- shell

function shell() {
  navEl = h("nav.nav", { "aria-label": "Main" })
  bottomEl = h("nav.bottom-nav", { "aria-label": "Main" })
  toggleEl = h("div.mode-toggle", { role: "group", "aria-label": "Mode" })
  statusEl = h("a.status-pill", { href: "#/settings", title: "Where models run" })
  const top = h(
    "header.topbar",
    {},
    h("div.top-left", {}, h("a.brand", { href: "#/", "aria-label": "Kino home" }, h("span.brand-mark", {}, "K"), h("span.brand-word", {}, "Kino", h("small", {}, "Studio")))),
    navEl,
    h("div.top-right", {}, activityButton(), toggleEl, statusEl, h("a.icon-btn.ghost", { href: "#/settings", "aria-label": "Settings", title: "Settings" }, icon("settings"))),
  )
  replace(app, top, h("main.view", { id: "view" }), bottomEl)
  renderChrome()
  addEventListener("scroll", () => top.classList.toggle("scrolled", scrollY > 4), { passive: true })
}

function renderChrome() {
  const items = NAV[mode.value]
  const active = (item) => (item.match ?? [item.id]).includes(current)
  replace(navEl, ...items.map((it) => h(`a.nav-link${active(it) ? ".active" : ""}`, { href: `#/${it.id}` }, it.label)))
  replace(
    bottomEl,
    ...items.map((it) => h(`a${active(it) ? ".active" : ""}`, { href: `#/${it.id}` }, icon(it.icon), h("span", {}, it.label))),
    h(`a${current === "settings" ? ".active" : ""}`, { href: "#/settings" }, icon("settings"), h("span", {}, "Settings")),
  )
  toggleEl.className = `mode-toggle is-${mode.value}`
  replace(
    toggleEl,
    h("span.thumb"),
    h(`button${mode.value === "simple" ? ".on" : ""}`, { type: "button", "aria-pressed": mode.value === "simple" ? "true" : "false", title: "Guided tasks with smart defaults", onclick: () => switchMode("simple") }, "Simple"),
    h(`button${mode.value === "advanced" ? ".on" : ""}`, { type: "button", "aria-pressed": mode.value === "advanced" ? "true" : "false", title: "Every model and every setting", onclick: () => switchMode("advanced") }, "Advanced"),
  )
  renderStatus()
}

function renderStatus() {
  if (!statusEl) return
  const p = state.boot.provider
  const kind = p.error ? "bad" : p.id === "mock" ? "warn" : "ok"
  const text = isWeb() ? "Web demo" : providerName(p)
  replace(statusEl, h(`span.dot.${kind}${kind === "ok" ? ".live" : ""}`), h("span.status-text", {}, text))
  statusEl.title = isWeb() ? "Web demo: everything runs in your browser. Cut-outs and upscaling run real models here; the others need the full studio." : p.id === "mock" ? "Demo mode: placeholder results made on this computer. Connect a GPU in Settings." : p.label
}

/** Switch mode and carry what you were doing across. */
function switchMode(next) {
  if (next === mode.value) return
  const carry = viewState.get?.()
  setMode(next)
  if (next === "advanced") {
    if (current === "home" || current === "make") {
      if (carry?.appId) window.__kinoCompose = carry
      return go("#/studio")
    }
  } else {
    if (current === "studio") {
      const target = carry && taskForCompose(carry)
      return target ? openTask(target.task, target.values) : go("#/home")
    }
    if (current === "apps") return go("#/home")
  }
  // Same route, different depth (Ads switches between the wizard and the full studio).
  route({ force: true })
}

function go(hash) {
  if (location.hash === hash) route({ force: true })
  else location.hash = hash
}

// ---------------------------------------------------------------- routing

function parse() {
  const [id = "", arg] = location.hash.replace(/^#\/?/, "").split("/")
  const key = id.toLowerCase()
  if (key === "create") return { view: "studio" } // old links
  if (ROUTES[key]) return { view: key, arg }
  return { view: mode.value === "advanced" ? "studio" : "home" }
}

function route({ force = false } = {}) {
  const { view, arg } = parse()
  const key = `${view}/${arg ?? ""}`
  if (!force && key === current + "/" + (state.routeArg ?? "") && unmount) return
  // The address decides the depth: the Studio and Apps are Advanced, the
  // guided tasks are Simple.
  const implied = { studio: "advanced", apps: "advanced", home: "simple", make: "simple" }[view]
  if (implied && implied !== mode.value) setMode(implied)
  const swap = () => {
    unmount?.()
    viewState.get = null
    current = view
    state.view = view
    state.routeArg = arg
    const container = document.getElementById("view")
    container.replaceChildren()
    container.dataset.view = view
    unmount = ROUTES[view].mount(container, arg) ?? null
    renderChrome()
    document.title = `${view === "make" ? "Make" : ROUTES[view].title} · Kino`
    scrollTo({ top: 0 })
  }
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches && current) document.startViewTransition(swap)
  else swap()
}

// Remix / Animate / Edit from anywhere: Advanced loads it in the Studio, Simple
// opens the matching guided task with the photo already in place.
on("compose", (req) => {
  if (mode.value === "advanced") {
    if (current === "studio") return
    window.__kinoCompose = req
    location.hash = "#/studio"
    return
  }
  const target = taskForCompose(req)
  if (target) openTask(target.task, target.values)
  else {
    setMode("advanced")
    window.__kinoCompose = req
    go("#/studio")
  }
})

on("mode", () => renderChrome())
on("open-task", ({ task, values }) => openTask(task, values))

// ---------------------------------------------------------------- live updates

function connect() {
  if (window.kinoDemo) {
    const apply = { job: (j) => state.jobs.set(j.id, j), "job-removed": ({ id }) => state.jobs.delete(id), asset: (a) => state.assets.set(a.id, a), "asset-removed": ({ id }) => state.assets.delete(id), ad: (a) => state.ads.set(a.id, a), "ad-removed": ({ id }) => state.ads.delete(id) }
    window.kinoDemo.subscribe((type, data) => {
      apply[type]?.(data)
      emit(type, data)
    })
    return
  }
  const es = new EventSource("/api/events")
  const relay = (type, apply) =>
    es.addEventListener(type, (e) => {
      const data = JSON.parse(e.data)
      apply(data)
      emit(type, data)
    })
  relay("job", (j) => state.jobs.set(j.id, j))
  relay("job-removed", ({ id }) => state.jobs.delete(id))
  relay("asset", (a) => state.assets.set(a.id, a))
  relay("asset-removed", ({ id }) => state.assets.delete(id))
  relay("ad", (a) => state.ads.set(a.id, a))
  relay("ad-removed", ({ id }) => state.ads.delete(id))
  relay("engine", (st) => (state.engine = st))
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
  replace(
    app,
    h(
      "form.login.rise",
      { onsubmit: submit },
      h("span.brand-mark.big", {}, "K"),
      h("h1", {}, "Kino ", h("em", {}, "studio")),
      h("p.muted", {}, "This studio is private. Enter its access code."),
      input,
      h("button.btn.primary.block", { type: "submit" }, "Enter"),
      error,
    ),
  )
  input.focus()
}

addEventListener("kino:auth", () => login())
boot()
