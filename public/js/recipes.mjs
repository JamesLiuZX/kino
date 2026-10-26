// Recipes: chains of Kino's tools that turn a photo (or a line of words) into a
// finished set. The gallery; one recipe's page with its inputs, what it does,
// and its runs with their results; and importing, exporting and editing the
// small JSON files recipes are (docs/recipes.md).

import { h, icon, api, upload, toast, fail, sheet, confirmDialog, fmtSeconds, timeAgo, replace } from "./ui.mjs"
import { state, on, emit, appById, isPart, isDemo, isWeb, needsSetup, fullStudioUrl } from "./state.mjs"
import { assetCard } from "./media.mjs"

const FORMAT_URL = "https://github.com/JamesLiuZX/kino/blob/main/docs/recipes.md"
const RUN_STATUS = { running: ["busy", "Making"], done: ["ok", "Done"], partial: ["warn", "Partly done"], failed: ["bad", "Didn't work"], canceled: ["", "Canceled"] }
const stepRef = (v) => (typeof v === "string" ? (/^@([a-z0-9-]+)$/.exec(v)?.[1] ?? null) : null)
const ratio = (aspect) => {
  const m = /^(\d+):(\d+)$/.exec(aspect ?? "")
  return m ? `${m[1]} / ${m[2]}` : "1 / 1"
}
const labelOf = (s) => s.label ?? appById(s.app)?.label ?? s.id

/** How many jobs each step runs, how many results you keep, and roughly how long, from the recipe alone. */
function plan(recipe) {
  const jobs = {}
  for (const s of recipe.steps) {
    const fan = Object.values(s.values ?? {})
      .map(stepRef)
      .filter(Boolean)
      .reduce((n, id) => n * (jobs[id] ?? 1), 1)
    jobs[s.id] = Math.min(12, fan * (Object.values(s.each ?? {})[0]?.length ?? 1) * (s.count ?? 1))
  }
  const kept = recipe.steps.filter((s) => s.keep !== false).reduce((n, s) => n + jobs[s.id], 0)
  const seconds = recipe.steps.reduce((t, s) => t + jobs[s.id] * (appById(s.app)?.seconds ?? 30), 0)
  return { jobs, kept, seconds }
}

/** The first thing stopping a recipe where models run now, with where to fix it; null when it can run. */
function blocker(recipe) {
  if (needsSetup()) return { text: "Set up this computer first.", href: "#/welcome", action: "Set up" }
  for (const s of recipe.steps) {
    const app = appById(s.app)
    if (!app) return { text: `It needs the “${s.app}” app, which this studio doesn't have.`, href: "#/apps", action: "Apps" }
    const st = state.status?.apps?.[s.app]
    if (st && !st.ready) return { text: `${app.label} ${st.reason ?? "is missing model files"}.`, href: state.boot.provider.id === "local" ? "#/settings" : "#/apps", action: "Fix it" }
  }
  return null
}

/** What you get, as little frames in the shapes the recipe makes. */
function frames(recipe) {
  const { jobs } = plan(recipe)
  const out = []
  for (const s of recipe.steps) {
    if (s.keep === false) continue
    const video = appById(s.app)?.output === "video"
    const aspects = s.each?.aspect ?? [s.values?.aspect ?? (video ? "9:16" : "1:1")]
    for (let i = 0; i < jobs[s.id] && out.length < 7; i++) out.push(h("span.frame", { style: { aspectRatio: ratio(aspects[i % aspects.length]) } }, video ? icon("play") : null))
  }
  return out
}

function loadStatus(then) {
  if (["local", "comfy"].includes(state.boot.provider.id)) api("/api/status").then((s) => ((state.status = s), then()), () => {})
}

export function mountRecipes(root, arg) {
  if (isWeb()) {
    root.append(h("div.page", {}, h("div.empty-hero", {}, h("h1", {}, "Recipes run in the ", h("em", {}, "full studio")), h("p.muted", {}, "Chains of steps that turn one photo into a finished set need Kino on your computer."), h("a.btn.primary", { href: fullStudioUrl(), target: "_blank", rel: "noopener" }, icon("download"), "Get Kino"))))
    return
  }
  return arg ? mountRecipe(root, decodeURIComponent(arg)) : mountGallery(root)
}

// ---------------------------------------------------------------- gallery

function mountGallery(root) {
  let recipes = null
  let category = "All"
  const tabs = h("div.tabs", { role: "tablist" })
  const grid = h("div.recipe-grid")
  const file = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: (e) => e.target.files[0] && importFile(e.target.files[0]) })
  root.append(
    h(
      "div.page.recipes",
      {},
      h(
        "header.page-head",
        {},
        h(
          "div",
          {},
          h("h1", {}, "Recipes: one photo, a ", h("em", {}, "finished set")),
          h("p.muted", {}, "Each recipe chains Kino's tools: new scenes, every platform size, camera moves, words in the picture. Add your photo, press Run, and the whole set lands in your library."),
        ),
        h("div.row", {}, h("button.btn", { type: "button", onclick: () => file.click() }, icon("upload"), "Import a recipe"), file),
      ),
      tabs,
      grid,
    ),
  )

  function render() {
    if (!recipes) return replace(grid, h("p.muted", {}, "Loading recipes…"))
    const cats = ["All", ...new Set(recipes.map((r) => r.category ?? "Other")), ...(recipes.some((r) => !r.builtin) ? ["Yours"] : [])]
    replace(tabs, ...cats.map((c) => h(`button.tab${c === category ? ".active" : ""}`, { type: "button", role: "tab", "aria-selected": c === category ? "true" : "false", onclick: () => ((category = c), render()) }, c)))
    const shown = recipes.filter((r) => category === "All" || (category === "Yours" ? !r.builtin : (r.category ?? "Other") === category))
    replace(grid, ...shown.map((r, i) => card(r, i)))
  }

  function card(r, i) {
    const p = plan(r)
    const stop = blocker(r)
    return h(
      "a.recipe-card.rise",
      { href: `#/recipes/${encodeURIComponent(r.id)}`, style: { "--d": `${Math.min(i, 8) * 0.04}s` } },
      h("div.recipe-frames", { "aria-hidden": "true" }, ...frames(r)),
      h(
        "div.recipe-body",
        {},
        h("p.eyebrow", {}, r.builtin ? (r.category ?? "Recipe") : "Yours"),
        h("h2", {}, r.title),
        r.blurb ? h("p.recipe-blurb", {}, r.blurb) : null,
        h(
          "div.recipe-meta",
          {},
          h("span.pill.small", {}, `${p.kept} result${p.kept === 1 ? "" : "s"}`),
          h("span.pill.small", {}, `${r.steps.length} step${r.steps.length === 1 ? "" : "s"}`),
          stop ? h("span.pill.small.warn", { title: stop.text }, "Needs setup") : null,
        ),
      ),
    )
  }

  async function importFile(f) {
    try {
      const saved = await api("/api/recipes", { method: "POST", body: JSON.parse(await f.text()) })
      toast(`Imported “${saved.title}”`)
      location.hash = `#/recipes/${encodeURIComponent(saved.id)}`
    } catch (e) {
      fail(e instanceof SyntaxError ? new Error(`That file isn't valid JSON: ${e.message}`) : e)
    } finally {
      file.value = ""
    }
  }

  api("/api/recipes").then((list) => ((recipes = list), render()), fail)
  loadStatus(render)
  render()
  return on("boot", render)
}

// ---------------------------------------------------------------- one recipe

function mountRecipe(root, id) {
  let recipe = null
  let runs = []
  const values = {}
  const uploads = new Map() // input id -> progress
  const head = h("header.recipe-head")
  const form = h("section.card.recipe-form")
  const steps = h("section.card.recipe-steps")
  const runsEl = h("section.runs")
  const runEls = new Map()
  root.append(h("div.page.recipe-page", {}, h("a.back.link", { href: "#/recipes" }, icon("arrow-left"), "All recipes"), head, h("div.recipe-layout", {}, form, steps), runsEl))

  async function load() {
    try {
      ;[recipe, runs] = await Promise.all([api(`/api/recipes/${encodeURIComponent(id)}`), api(`/api/runs?recipe=${encodeURIComponent(id)}`)])
    } catch (e) {
      replace(head, h("h1", {}, "That recipe is gone"), h("p.muted", {}, e.message))
      return
    }
    for (const input of recipe.inputs ?? []) if (input.default !== undefined) values[input.id] ??= input.default
    for (const input of recipe.inputs ?? []) if (input.type === "choice") values[input.id] ??= input.options[0]
    document.title = `${recipe.title} · Kino`
    renderHead()
    renderForm()
    renderSteps()
    renderRuns()
  }

  function renderHead() {
    replace(
      head,
      h("p.eyebrow", {}, [recipe.builtin ? recipe.category : "Your recipe", ...(recipe.tags ?? [])].filter(Boolean).join(" · ")),
      h("h1", {}, recipe.title),
      recipe.blurb ? h("p.muted.lede", {}, recipe.blurb) : null,
    )
  }

  // ------------------------------------------------------------ inputs

  function renderForm() {
    const p = plan(recipe)
    const stop = blocker(recipe)
    replace(
      form,
      ...(recipe.inputs ?? []).map((input) =>
        h(
          "div.recipe-input",
          {},
          h("label.recipe-label", { for: `in-${input.id}` }, input.label, input.optional ? h("small.muted", {}, " (optional)") : null),
          input.help ? h("small.muted", {}, input.help) : null,
          ["image", "video", "audio"].includes(input.type) ? filePicker(input) : input.type === "choice" ? choice(input) : textBox(input),
        ),
      ),
      stop ? h("p.recipe-blocker", {}, icon("alert"), h("span", {}, stop.text), h("a.btn.small", { href: stop.href }, stop.action)) : null,
      h(
        "button.btn.accent.large.block",
        { type: "button", disabled: !!stop, onclick: run },
        icon("sparkles"),
        "Run recipe",
        h("small", {}, ` · ${p.kept} result${p.kept === 1 ? "" : "s"}, ~${fmtSeconds(p.seconds)}`),
      ),
      isDemo() ? h("p.small.muted.center", {}, "Demo mode: placeholder results, made on this computer.") : null,
    )
  }

  function filePicker(input) {
    const kind = input.type
    const selected = values[input.id]
    const list = [...state.assets.values()]
      .filter((a) => a.kind === kind && !isPart(a))
      .sort((a, b) => (b.source === "brand") - (a.source === "brand") || b.createdAt - a.createdAt)
      .slice(0, 7)
    if (selected && !list.some((a) => a.id === selected) && state.assets.get(selected)) list.unshift(state.assets.get(selected))
    const fileEl = h("input", { id: `in-${input.id}`, type: "file", accept: `${kind}/*`, hidden: true, onchange: (e) => e.target.files[0] && addFile(input, e.target.files[0]) })
    const progress = uploads.get(input.id)
    return h(
      "div.picks",
      {},
      h("button.pick.upload", { type: "button", onclick: () => fileEl.click() }, progress !== undefined ? h("span", {}, `${Math.round(progress * 100)}%`) : icon("upload"), h("span", {}, progress !== undefined ? "Uploading" : "Upload"), fileEl),
      ...list.map((a) =>
        h(
          `button.pick${a.id === selected ? ".selected" : ""}`,
          { type: "button", title: a.name || a.prompt || "", "aria-pressed": a.id === selected ? "true" : "false", onclick: () => ((values[input.id] = a.id), renderForm()) },
          kind === "audio" ? h("div.ref-audio", {}, icon("mic")) : kind === "video" ? h("video", { src: a.url, muted: true, preload: "metadata" }) : h("img", { src: a.thumbUrl ?? a.url, alt: "" }),
          a.source === "brand" ? h("span.pick-label", {}, "Brand") : null,
        ),
      ),
    )
  }

  async function addFile(input, file) {
    uploads.set(input.id, 0)
    renderForm()
    try {
      const asset = await upload(file, (x) => {
        uploads.set(input.id, x)
        const label = form.querySelector(".pick.upload span")
        if (label) label.textContent = `${Math.round(x * 100)}%`
      })
      state.assets.set(asset.id, asset)
      values[input.id] = asset.id
    } catch (e) {
      fail(e)
    } finally {
      uploads.delete(input.id)
      renderForm()
    }
  }

  function textBox(input) {
    const ta = h("textarea.input", { id: `in-${input.id}`, rows: 2, oninput: (e) => (values[input.id] = e.target.value) }, values[input.id] ?? "")
    const ideas = (input.ideas ?? []).filter((x) => typeof x === "string").slice(0, 6)
    return h(
      "div.recipe-text",
      {},
      ta,
      ideas.length ? h("div.row.wrap", {}, ...ideas.map((idea) => h("button.chip.small", { type: "button", onclick: () => ((values[input.id] = idea), (ta.value = idea)) }, idea))) : null,
    )
  }

  function choice(input) {
    return h(
      "div.row.wrap",
      { role: "radiogroup", "aria-label": input.label },
      ...input.options.map((o) =>
        h(`button.chip${values[input.id] === o ? ".active" : ""}`, { type: "button", role: "radio", "aria-checked": values[input.id] === o ? "true" : "false", onclick: () => ((values[input.id] = o), renderForm()) }, o),
      ),
    )
  }

  async function run(e) {
    const btn = e.currentTarget
    btn.classList.add("busy")
    try {
      const started = await api(`/api/recipes/${encodeURIComponent(recipe.id)}/run`, { method: "POST", body: { inputs: values } })
      upsert(started)
      runEls.get(started.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
    } catch (err) {
      fail(err)
    } finally {
      btn.classList.remove("busy")
    }
  }

  // ------------------------------------------------------------ what it does

  function renderSteps() {
    const { jobs } = plan(recipe)
    replace(
      steps,
      h("h2", {}, "What it does"),
      h(
        "ol.recipe-plan",
        {},
        ...recipe.steps.map((s) => {
          const app = appById(s.app)
          const from = Object.values(s.values ?? {}).map(stepRef).filter(Boolean)
          return h(
            "li",
            {},
            h("div", {}, h("strong", {}, labelOf(s)), jobs[s.id] > 1 ? h("span.mono.muted", {}, ` ×${jobs[s.id]}`) : null),
            h(
              "small.muted",
              {},
              [app?.label, from.length ? `from ${from.map((f) => labelOf(recipe.steps.find((x) => x.id === f)).toLowerCase()).join(" and ")}` : null, s.keep === false ? "in between, not kept" : null].filter(Boolean).join(" · "),
            ),
          )
        }),
      ),
      h(
        "div.row.wrap.recipe-tools",
        {},
        h("button.btn.small.ghost", { type: "button", onclick: exportJson }, icon("download"), "Export"),
        h("button.btn.small.ghost", { type: "button", onclick: () => editJson(recipe, { copy: !!recipe.builtin }) }, icon("copy"), recipe.builtin ? "Duplicate and edit" : "Edit"),
        recipe.builtin ? null : h("button.btn.small.ghost", { type: "button", onclick: removeRecipe }, icon("trash"), "Delete"),
      ),
    )
  }

  function exportJson() {
    const { builtin, updatedAt, ...clean } = recipe
    const url = URL.createObjectURL(new Blob([JSON.stringify(clean, null, 2) + "\n"], { type: "application/json" }))
    h("a", { href: url, download: `${recipe.id}.kino-recipe.json` }).click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  async function removeRecipe() {
    if (!(await confirmDialog(`Delete “${recipe.title}”? What its runs made stays in your library.`))) return
    try {
      await api(`/api/recipes/${encodeURIComponent(recipe.id)}`, { method: "DELETE" })
      location.hash = "#/recipes"
    } catch (e) {
      fail(e)
    }
  }

  // ------------------------------------------------------------ runs

  function renderRuns() {
    runEls.clear()
    replace(runsEl, h("h2.section-title", {}, "Runs"), ...(runs.length ? runs.map(runCard) : [h("p.muted.small", {}, "Nothing yet. Add your inputs and press Run; every run and its results stay here.")]))
  }

  function upsert(run) {
    const i = runs.findIndex((r) => r.id === run.id)
    if (i >= 0) runs[i] = run
    else runs.unshift(run)
    const el = runEls.get(run.id)
    if (el) fillRun(el, run)
    else renderRuns()
  }

  function runCard(run) {
    const el = h("article.run-card", { dataset: { run: run.id } })
    runEls.set(run.id, el)
    fillRun(el, run)
    return el
  }

  function fillRun(el, run) {
    const [kind, text] = RUN_STATUS[run.status] ?? ["", run.status]
    const kept = run.recipe.steps.filter((s) => s.keep !== false).flatMap((s) => run.steps[s.id].outputs.map((id) => ({ id, step: s })))
    const ids = kept.map((r) => r.id).join()
    const problems = run.recipe.steps.filter((s) => run.steps[s.id].error && run.steps[s.id].status !== "canceled")
    let results = el.querySelector(".run-results")
    // Results only redraw when there are new ones, so videos keep playing and tiles don't flash.
    if (!results || results.dataset.ids !== ids) {
      results = kept.length
        ? h(
            "div.run-results",
            { dataset: { ids } },
            ...kept.map((r) => {
              const a = state.assets.get(r.id)
              return a ? h("figure.run-result", { style: { aspectRatio: String(a.width && a.height ? a.width / a.height : 1) } }, assetCard(a, { list: () => kept.map((x) => x.id) }), h("figcaption", {}, labelOf(r.step))) : null
            }),
          )
        : h("div.run-results", { dataset: { ids } })
    }
    replace(
      el,
      h(
        "header.run-head",
        {},
        h(`span.pill.small${kind ? `.${kind}` : ""}`, {}, text),
        h("span.small.muted", {}, `${timeAgo(run.createdAt)}${Object.values(run.inputs).some((v) => typeof v === "string" && !state.assets.has(v)) ? ` · ${Object.values(run.inputs).filter((v) => typeof v === "string" && !state.assets.has(v)).join(" · ")}` : ""}`),
        h("span.spacer"),
        kept.length && run.status !== "running" ? h("a.btn.small.ghost", { href: `/api/runs/${run.id}/zip`, download: "", title: "Every result and a note of how it was made, in one zip" }, icon("download"), "Download all") : null,
        kept.length && run.status !== "running" ? h("button.btn.small", { type: "button", onclick: () => emit("new-post", { media: kept.slice(0, 10).map((r) => r.id), title: run.title, from: { runId: run.id } }) }, icon("send"), "Post this set") : null,
        run.status === "running"
          ? h("button.btn.small.ghost", { type: "button", onclick: () => api(`/api/runs/${run.id}/cancel`, { method: "POST" }).then(upsert, fail) }, "Cancel")
          : h("button.icon-btn.ghost.small", { type: "button", "aria-label": "Remove from this list", title: "Remove from this list (the files stay in your library)", onclick: () => removeRun(run) }, icon("x")),
      ),
      h("ol.run-steps", {}, ...run.recipe.steps.map((s, i) => stepChip(run, s, i))),
      results,
      ...problems.map((s) => h("p.engine-error", {}, `${labelOf(s)}: ${run.steps[s.id].error}`)),
    )
  }

  function stepChip(run, s, i) {
    const st = run.steps[s.id]
    const jobs = st.jobs.map((id) => state.jobs.get(id)).filter(Boolean)
    const pct = st.status === "running" && jobs.length ? Math.round((jobs.reduce((a, j) => a + (j.status === "done" ? 1 : (j.progress ?? 0)), 0) / jobs.length) * 100) : null
    return h(
      `li.${st.status}`,
      { title: st.error ?? "" },
      h("span.mark", {}, st.status === "done" ? icon("check") : st.status === "failed" ? icon("alert") : String(i + 1)),
      h("span", {}, labelOf(s)),
      pct !== null ? h("span.mono", {}, `${pct}%`) : st.status === "done" && st.outputs.length > 1 ? h("span.mono", {}, `×${st.outputs.length}`) : null,
    )
  }

  async function removeRun(run) {
    try {
      await api(`/api/runs/${run.id}`, { method: "DELETE" })
      runs = runs.filter((r) => r.id !== run.id)
      renderRuns()
    } catch (e) {
      fail(e)
    }
  }

  const offs = [
    on("run", (r) => r.recipeId === id && recipe && upsert(r)),
    on("job", (j) => {
      const el = j.runId && runEls.get(j.runId)
      const r = el && runs.find((x) => x.id === j.runId)
      if (r) el.querySelector(".run-steps")?.replaceWith(h("ol.run-steps", {}, ...r.recipe.steps.map((s, i) => stepChip(r, s, i))))
    }),
    on("boot", () => recipe && renderForm()),
  ]
  load()
  loadStatus(() => recipe && renderForm())
  return () => offs.forEach((off) => off())
}

// ---------------------------------------------------------------- editing

function editJson(recipe, { copy }) {
  const { builtin, updatedAt, ...draft } = recipe
  if (copy) Object.assign(draft, { id: `${recipe.id}-copy`.slice(0, 48), title: `${recipe.title} (copy)`.slice(0, 80) })
  const ta = h("textarea.input.code", { rows: 22, spellcheck: "false", "aria-label": "Recipe JSON" }, JSON.stringify(draft, null, 2))
  const error = h("p.engine-error")
  const save = async (e) => {
    const btn = e.currentTarget
    let parsed
    try {
      parsed = JSON.parse(ta.value)
    } catch (err) {
      error.textContent = `That isn't valid JSON: ${err.message}`
      return
    }
    btn.classList.add("busy")
    try {
      const saved = await api("/api/recipes", { method: "POST", body: parsed })
      s.close()
      toast(`Saved “${saved.title}”`)
      location.hash = `#/recipes/${encodeURIComponent(saved.id)}`
    } catch (err) {
      error.textContent = err.message
    } finally {
      btn.classList.remove("busy")
    }
  }
  const s = sheet(
    copy ? "Duplicate and edit" : "Edit recipe",
    h(
      "div.recipe-editor",
      {},
      h("p.small.muted", {}, "A recipe is a small JSON file: what it asks for, then its steps. Kino checks it when you save. ", h("a.link", { href: FORMAT_URL, target: "_blank", rel: "noopener" }, "How recipes work")),
      ta,
      error,
      h("div.row.end", {}, h("button.btn.accent", { type: "button", onclick: save }, "Save")),
    ),
    { wide: true },
  )
}
