// Shared client state, kept in sync by the server's event stream, plus a tiny
// pub/sub so views can react without a framework.

export const state = {
  boot: null,
  assets: new Map(),
  jobs: new Map(),
  ads: new Map(),
  status: null,
}

const listeners = new Map()

export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set())
  listeners.get(topic).add(fn)
  return () => listeners.get(topic)?.delete(fn)
}

export function emit(topic, payload) {
  for (const fn of listeners.get(topic) ?? []) {
    try {
      fn(payload)
    } catch (e) {
      console.error(e)
    }
  }
}

export const appById = (id) => state.boot?.apps.find((a) => a.id === id)
export const appsForTool = (tool) => state.boot?.apps.filter((a) => a.tool === tool) ?? []
export const toolById = (id) => state.boot?.tools.find((t) => t.id === id)
export const aspectById = (id) => state.boot?.presets.aspects.find((a) => a.id === id)
export const cameraById = (id) => state.boot?.presets.camera.find((c) => c.id === id)
export const styleById = (id) => state.boot?.presets.styles.find((s) => s.id === id)
export const audioById = (id) => state.boot?.presets.audio.find((a) => a.id === id)

export const isDemo = () => state.boot?.provider.id === "mock"
/** The web demo: the interface running on an in-browser engine (kino/web). */
export const isWeb = () => !!state.boot?.provider.web
export const fullStudioUrl = () => state.boot?.web?.repo ?? "https://github.com/JamesLiuZX/james-portfolio/tree/main/kino"

/** Ask the Create view to load an app with values (Remix, Animate, Edit…). */
export function compose(request) {
  emit("compose", request)
}

// ---------------------------------------------------------------- mode

// Simple (task-first, guided) or Advanced (every model and knob). Remembered
// on this machine; new visitors start in Simple.
let savedMode = "simple"
try {
  savedMode = JSON.parse(localStorage.getItem("kino:mode") ?? '"simple"') === "advanced" ? "advanced" : "simple"
} catch {}

export const mode = { value: savedMode }
export const isAdvanced = () => mode.value === "advanced"

export function setMode(next) {
  if (next === mode.value) return
  mode.value = next
  try {
    localStorage.setItem("kino:mode", JSON.stringify(next))
  } catch {}
  emit("mode", next)
}

/**
 * What the visible view is working on ({ tool, appId, values }), so switching
 * mode can carry it across. Views set `get` when they mount.
 */
export const viewState = { get: null }

/** Jobs and ads a view is already showing; the activity tray won't toast them. */
export const watched = new Set()
