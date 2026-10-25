// The first run on "This computer": what this machine can run, the model packs
// to start with, and one button that installs the engine and downloads them,
// with progress the whole way. Then a first picture. Settings → This computer
// does the same piece by piece; this page is the short road.

import { h, icon, api, fail, replace, store } from "./ui.mjs"
import { state, on, isWeb } from "./state.mjs"
import { openTask } from "./flow.mjs"

const FIRST_PROMPT = "An amber glass bottle on wet black stone, studio lighting"

const gb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`)

function machine(st) {
  if (st.platform === "darwin") return st.arch === "arm64" ? "Mac with Apple Silicon · Metal" : "Intel Mac · processor only"
  if (st.platform === "win32") return "Windows PC · Vulkan or CUDA"
  return "Linux · Vulkan"
}

const where = (st) => (st.platform === "darwin" ? "your Mac" : st.platform === "win32" ? "your PC" : "this computer")

/** How much of a pack is on disk, counting the download in progress. */
function doneBytes(p) {
  const present = p.files.reduce((a, f) => a + (f.present ? f.bytes ?? 0 : f.partial), 0)
  const t = p.download
  if (!t || t.error || !t.total) return present
  return Math.max(present, (p.bytes ?? 0) - t.total + t.received)
}

export function mountWelcome(root) {
  if (isWeb()) {
    location.hash = "#/home"
    return
  }
  store.set("welcome-seen", true)
  const intro = h("div.welcome-intro")
  const card = h("section.welcome-card.rise", { style: { "--d": "0.2s" } })
  root.append(
    h(
      "div.welcome.grain",
      {},
      h(
        "div.hero-bg",
        {},
        h("div.grid-lines"),
        h("div.orb.violet", { style: { width: "40rem", height: "40rem", left: "-16rem", top: "-14rem" } }),
        h("div.orb.cyan", { style: { width: "32rem", height: "32rem", right: "-12rem", top: "8rem" } }),
      ),
      h("div.welcome-inner", {}, intro, card),
    ),
  )

  let picked = null // pack ids chosen, starting from the starter packs
  let starting = false

  function render() {
    const st = state.engine
    if (!st) return replace(card, h("p.muted", {}, "Looking at this computer…"))
    if (!picked) {
      picked = new Set(st.starter)
      renderIntro(st) // once: it animates in
    }
    const fast = st.packs.find((p) => p.id === "images-fast")
    const working = !!st.setup || (st.install && !st.install.error) || st.packs.some((p) => p.download && !p.download.error)
    if (working) return renderProgress(st)
    if (st.installed && fast?.ready) return renderDone(st)
    renderChoice(st)
  }

  function renderIntro(st) {
    const fast = st.packs.find((p) => p.id === "images-fast")
    const tight = fast && st.memoryGb < fast.memoryGb
    replace(
      intro,
      h("p.eyebrow.rise", { style: { "--d": "0s" } }, h("span.dot.ok.live"), "Kino · first run"),
      h("h1.display.rise", { style: { "--d": "0.05s" } }, "Make pictures on ", h("em", {}, "this computer")),
      h(
        "p.lede.rise",
        { style: { "--d": "0.12s" } },
        "No account, no key, and nothing leaves your machine. Kino fetches a small engine and the model files once; after that it works offline.",
      ),
      h(
        "div.machine.rise",
        { style: { "--d": "0.18s" } },
        h("span.pill", {}, icon("laptop"), machine(st)),
        h("span.pill", {}, icon("cpu"), `${st.memoryGb} GB memory`),
        st.freeGb !== null ? h("span.pill", {}, icon("download"), `${st.freeGb} GB free disk`) : null,
      ),
      tight
        ? h(
            "p.welcome-note.warn",
            {},
            icon("alert"),
            `Fast images wants about ${fast.memoryGb} GB of memory. With ${st.memoryGb} GB it may be slow or fail; a GPU server is the safer road.`,
          )
        : h("p.welcome-note", {}, icon("shield"), "Open models, downloaded straight from their publishers. Remove them any time in Settings."),
    )
  }

  function renderChoice(st) {
    const chosen = st.packs.filter((p) => picked.has(p.id) && !p.ready)
    const bytes = chosen.reduce((a, p) => a + (p.bytes ?? 0) - doneBytes(p), 0)
    const failed = st.install?.error ?? st.packs.find((p) => picked.has(p.id) && p.download?.error)?.download.error
    const resume = st.installed || st.packs.some((p) => picked.has(p.id) && doneBytes(p) > 0)
    const noRoom = st.freeGb !== null && bytes > st.freeGb * 1024 ** 3
    replace(
      card,
      h("h2", {}, "What to download"),
      h(
        "div.pack-picks",
        {},
        ...st.packs.map((p) => {
          const on = p.ready || picked.has(p.id)
          return h(
            `label.pack-pick${on ? ".on" : ""}${p.ready ? ".off" : ""}`,
            {},
            h("input", {
              type: "checkbox",
              checked: on,
              disabled: p.ready,
              dataset: { pack: p.id },
              onchange: (e) => {
                e.target.checked ? picked.add(p.id) : picked.delete(p.id)
                render()
                card.querySelector(`[data-pack="${p.id}"]`)?.focus()
              },
            }),
            h("strong", {}, p.label),
            h("span.size", {}, p.ready ? "on this computer" : p.bytes ? gb(p.bytes - doneBytes(p)) : ""),
            h("small", {}, p.blurb, p.fits ? null : h("span.warn", {}, ` Wants ${p.memoryGb} GB of memory; this computer has ${st.memoryGb} GB.`)),
          )
        }),
      ),
      h("div.welcome-total", {}, h("span", {}, st.installed ? "Engine installed" : "Engine: tens of MB"), h("span.mono", {}, chosen.length ? `${gb(bytes)} to download, once` : "Nothing to download")),
      failed ? h("p.engine-error", {}, failed) : null,
      noRoom ? h("p.engine-error", {}, `That needs ${gb(bytes)} and this disk has ${st.freeGb} GB free. Untick a pack or free some space.`) : null,
      h(
        "div.welcome-actions",
        {},
        h(
          `button.btn.accent.large.block${starting ? ".busy" : ""}`,
          { type: "button", disabled: starting || (!chosen.length && st.installed) || noRoom, onclick: () => start([...picked]) },
          icon("download"),
          failed ? "Try again" : resume ? "Carry on setting up" : "Set up this computer",
        ),
        h(
          "div.row.wrap",
          {},
          h("a.btn.ghost.small", { href: "#/settings" }, icon("cpu"), "Use a GPU server instead"),
          state.boot.settings?.provider?.locked ? null : h("button.btn.ghost.small", { type: "button", onclick: demo }, icon("eye"), "Look around first (demo mode)"),
        ),
      ),
    )
  }

  function renderProgress(st) {
    const ids = st.setup?.packs ?? st.packs.filter((p) => p.download).map((p) => p.id)
    const packs = ids.map((id) => st.packs.find((p) => p.id === id)).filter(Boolean)
    const total = packs.reduce((a, p) => a + (p.bytes ?? 0), 0)
    const done = packs.reduce((a, p) => a + doneBytes(p), 0)
    const bar = (task) => {
      const pct = task?.total ? Math.min(100, (task.received / task.total) * 100) : 3
      return h("div.engine-progress", {}, h("div.bar", {}, h("i", { style: { width: `${pct}%` } })), h("small.mono", {}, task.phase, task.total ? ` · ${gb(task.received)} of ${gb(task.total)}` : ""))
    }
    const step = (n, { label, detail, ready, task, error }) =>
      h(
        `li${ready ? ".done" : task && !error ? ".now" : ""}`,
        {},
        h("span.mark", {}, ready ? icon("check") : String(n)),
        h("div", {}, h("strong", {}, label), task && !error ? bar(task) : h("small.muted", {}, error ? "" : detail), error ? h("small.engine-error", {}, error) : null),
      )
    replace(
      card,
      h("div.row.between", {}, h("h2", {}, "Setting up"), total ? h("span.mono.muted", {}, `${gb(done)} of ${gb(total)}`) : null),
      h("div.engine-progress.overall", {}, h("div.bar", {}, h("i", { style: { width: `${total ? Math.max(2, (done / total) * 100) : 2}%` } }))),
      h(
        "ol.steps",
        {},
        step(1, { label: "The engine", detail: st.installed ? "Installed" : "stable-diffusion.cpp, tens of MB", ready: st.installed, task: st.install, error: st.install?.error }),
        ...packs.map((p, i) => step(i + 2, { label: p.label, detail: p.bytes ? gb(p.bytes) : "", ready: p.ready, task: p.download, error: p.download?.error })),
      ),
      h("p.muted.small", {}, "You can leave this page; it keeps going in the background, and Settings → This computer shows it too. Paused downloads carry on where they stopped."),
      h("div.row.end", {}, h("button.btn.small", { type: "button", onclick: pause }, "Pause")),
    )
  }

  function renderDone(st) {
    const more = st.packs.filter((p) => !p.ready && p.fits)
    replace(
      card,
      h(
        "div.welcome-done",
        {},
        h("span.big-check", {}, icon("check")),
        h("h2.serif", {}, "This computer is ready"),
        h("p.muted", {}, `Pictures are made right here, on ${where(st)}. The first one takes a little longer while the model loads.`),
        h(
          "button.btn.accent.large",
          { type: "button", onclick: () => openTask("image", { prompt: FIRST_PROMPT }) },
          icon("sparkles"),
          "Make your first picture",
        ),
        more.length ? h("a.link.small", { href: "#/settings" }, `More packs in Settings: ${more.map((p) => p.label.toLowerCase()).join(", ")}`) : h("a.link.small", { href: "#/home" }, "Go to the studio"),
      ),
    )
  }

  async function start(packs) {
    starting = true
    render()
    try {
      // Setting this computer up is choosing it, even after a look around in demo mode.
      if (state.boot.provider.id !== "local") state.boot.settings = await api("/api/settings", { method: "PUT", body: { provider: "local" } })
      state.engine = await api("/api/engine/setup", { method: "POST", body: { packs } })
    } catch (e) {
      fail(e)
    } finally {
      starting = false
      render()
    }
  }

  async function pause() {
    try {
      state.engine = await api("/api/engine/setup/cancel", { method: "POST" })
      render()
    } catch (e) {
      fail(e)
    }
  }

  async function demo() {
    try {
      state.boot.settings = await api("/api/settings", { method: "PUT", body: { provider: "mock" } })
      location.hash = "#/home"
    } catch (e) {
      fail(e)
    }
  }

  if (!state.engine) api("/api/engine").then((st) => ((state.engine = st), render()), fail)
  const off = on("engine", render)
  render()
  return off
}
