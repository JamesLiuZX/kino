// Apps: what every built-in app runs on, whether its models are on your GPU,
// and importing your own ComfyUI workflows as one-box apps.

import { h, icon, api, toast, fail, confirmDialog, fmtSeconds, copyText, replace } from "./ui.mjs"
import { state, on, toolById } from "./state.mjs"

export function mountApps(root) {
  let models = null
  const statusEl = h("div.status-line")
  const listEl = h("div.app-cards")
  const importEl = h("section.card.import")
  const modelsEl = h("section.models")
  root.append(
    h(
      "div.page",
      {},
      h("header.page-head", {}, h("div", {}, h("h1", {}, "Apps"), h("p.muted", {}, "Each app is an official ComfyUI workflow with the knobs that matter. Bring your own, too."))),
      statusEl,
      importEl,
      h("h2.section-title", {}, "Built in"),
      listEl,
      h("h2.section-title", {}, "Model files"),
      modelsEl,
    ),
  )

  function readiness(appId) {
    const s = state.status?.apps?.[appId]
    if (!state.status || state.boot.provider.id !== "comfy") return null
    return s ? (s.ready ? { ok: true, text: "Models installed" } : { ok: false, text: `Missing ${s.missing.length} model file${s.missing.length > 1 ? "s" : ""}`, missing: s.missing }) : null
  }

  function renderStatus() {
    const p = state.boot.provider
    const s = state.status
    replace(
      statusEl,
      h(`span.dot.${p.id === "mock" ? "warn" : s?.ok === false ? "bad" : "ok"}`),
      h("span", {}, s?.label ?? p.label),
      h("a.link", { href: "#/settings" }, p.id === "mock" ? "Connect a GPU" : "Change"),
    )
  }

  function renderList() {
    const groups = new Map()
    for (const a of state.boot.apps) {
      if (!groups.has(a.tool)) groups.set(a.tool, [])
      groups.get(a.tool).push(a)
    }
    replace(
      listEl,
      ...[...groups].map(([tool, list]) =>
        h(
          "div.app-group",
          {},
          h("h3", {}, icon(toolById(tool)?.icon ?? "puzzle"), toolById(tool)?.label ?? tool),
          ...list.map((a) => {
            const r = readiness(a.id)
            return h(
              "article.app-card",
              {},
              h("div.app-card-head", {}, h("strong", {}, a.label), a.custom ? h("span.pill", {}, "Imported") : null, a.local ? h("span.pill.ok", {}, "Runs here, free") : null),
              h("p.muted.small", {}, a.model),
              h("p", {}, a.blurb),
              h(
                "div.row.wrap.small",
                {},
                a.local ? h("span.meta", {}, icon("zap"), "No GPU") : h("span.meta", {}, icon("cpu"), `${a.gpu} GB GPU`),
                h("span.meta", {}, icon("clock"), `~${fmtSeconds(a.seconds)}`),
                r ? h(`span.meta.${r.ok ? "ok" : "bad"}`, { title: r.missing?.map((m) => `${m.directory}/${m.name}`).join("\n") }, icon(r.ok ? "check" : "alert"), r.text) : null,
              ),
              h(
                "div.row.wrap",
                {},
                h("a.btn.small", { href: "#/create", onclick: () => (window.__kinoCompose = { tool: a.tool, appId: a.id, values: {} }) }, "Open"),
                !a.local ? h("a.btn.small.ghost", { href: `/api/apps/${a.id}/workflow`, download: `${a.id}-api.json` }, icon("download"), "Workflow") : null,
                a.custom ? h("button.icon-btn.danger.small", { type: "button", "aria-label": "Remove app", onclick: () => removeApp(a) }, icon("trash")) : null,
              ),
            )
          }),
        ),
      ),
    )
  }

  async function removeApp(a) {
    if (!(await confirmDialog(`Remove “${a.label}”? Things you made with it stay in your library.`, { confirm: "Remove" }))) return
    try {
      await api(`/api/apps/${a.id}`, { method: "DELETE" })
      toast("Removed.", { kind: "ok" })
    } catch (e) {
      fail(e)
    }
  }

  function renderImport() {
    const name = h("input.input", { placeholder: "Name, e.g. Flux portrait", "aria-label": "App name" })
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true })
    const zone = h("button.dropzone", { type: "button", onclick: () => file.click() }, icon("upload"), h("strong", {}, "Drop a ComfyUI workflow"), h("small.muted", {}, "The .json you save from ComfyUI, or its Export (API) file. Workflows from Civitai and OpenArt work the same way."))
    const result = h("div.import-result")
    const run = async (f) => {
      let workflow
      try {
        workflow = JSON.parse(await f.text())
      } catch {
        return fail(new Error("That file isn't JSON."))
      }
      zone.classList.add("busy")
      try {
        const res = await api("/api/apps/import", { method: "POST", body: { name: name.value || f.name.replace(/\.json$/i, ""), workflow } })
        replace(
          result,
          h(
            "div.import-ok",
            {},
            h("p", {}, icon("check"), h("strong", {}, `“${res.app.label}” is ready`), ` · ${res.app.output} · knobs: ${res.app.params.map((p) => p.label ?? p.id).join(", ") || "none"}`),
            ...res.warnings.map((w) => h("p.warn.small", {}, icon("alert"), w)),
            h("a.btn.small.primary", { href: "#/create", onclick: () => (window.__kinoCompose = { tool: res.app.tool, appId: res.app.id, values: {} }) }, "Try it"),
          ),
        )
      } catch (e) {
        replace(result, h("p.error", {}, e.message))
      } finally {
        zone.classList.remove("busy")
      }
    }
    file.addEventListener("change", () => file.files[0] && run(file.files[0]))
    zone.addEventListener("dragover", (e) => (e.preventDefault(), zone.classList.add("over")))
    zone.addEventListener("dragleave", () => zone.classList.remove("over"))
    zone.addEventListener("drop", (e) => {
      e.preventDefault()
      zone.classList.remove("over")
      const f = e.dataTransfer.files[0]
      if (f) run(f)
    })
    replace(importEl, h("h2", {}, "Import a workflow"), h("div.import-row", {}, name, zone, file), result)
  }

  function renderModels() {
    if (!models) return replace(modelsEl, h("p.muted", {}, "Loading…"))
    const total = models.models.length
    replace(
      modelsEl,
      h(
        "p.muted",
        {},
        `${total} files from the official ComfyUI templates (v${models.templatesVersion}). On your GPU pod or a pod attached to your RunPod network volume, fetch only what your apps need:`,
      ),
      h("div.code", {}, h("code", {}, "bash runpod/download-models.sh image-fast video-pro edit"), h("button.icon-btn.small", { type: "button", "aria-label": "Copy", onclick: () => copyText("bash runpod/download-models.sh image-fast video-pro edit") }, icon("copy"))),
      h(
        "table.models-table",
        {},
        h("thead", {}, h("tr", {}, h("th", {}, "File"), h("th", {}, "Folder"), h("th", {}, "Used by"))),
        h("tbody", {}, ...models.models.map((m) => h("tr", {}, h("td", {}, h("a.link", { href: m.url, target: "_blank", rel: "noreferrer" }, m.name)), h("td", {}, m.directory), h("td", {}, m.apps.join(", "))))),
      ),
    )
  }

  const refreshStatus = () =>
    api("/api/status")
      .then((s) => {
        state.status = s
        renderStatus()
        renderList()
      })
      .catch(() => {})

  const offs = [on("boot", () => (renderStatus(), renderList()))]
  renderStatus()
  renderImport()
  renderList()
  renderModels()
  refreshStatus()
  api("/api/models").then((m) => ((models = m), renderModels()), fail)
  return () => offs.forEach((off) => off())
}
