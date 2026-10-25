// Create: pick a tool, type one line, press Generate. The composer shows only
// what the chosen app needs (a photo slot, a camera move, a length) and keeps
// everything else out of the way. Results stream into the feed above it.

import { h, icon, api, upload, toast, fail, popover, closePopover, store, aspectGlyph, fmtSeconds, replace } from "./ui.mjs"
import { state, on, appById, appsForTool, toolById, cameraById, styleById, audioById, aspectById, isDemo, isWeb, needsSetup, webLocal, fullStudioUrl, viewState } from "./state.mjs"
import { assetCard, jobCard, masonry } from "./media.mjs"
import { openRecorder } from "./recorder.mjs"
import { openCameraSheet, cameraThumb, aspectPicker, stylePicker, audioPicker, durationPicker, selectPicker, STYLE_SWATCH, AUDIO_ICON } from "./pickers.mjs"

const PLACEHOLDER = {
  image: "Describe an image… a bottle of herbal oil on a teak table, soft morning light",
  video: "Describe what happens… steam curls up as warm light moves across the table",
  edit: "Describe the change… put the bottle on a bathroom shelf with green plants",
  talk: "Optional: how they should look while speaking",
  custom: "Describe what you want",
}

const IDEAS = {
  image: [
    "A cosy HDB living room at golden hour, a grandmother reading by the window",
    "Macro shot of golden frankincense resin on dark wood, dramatic side light",
    "A poster that says “Weekend Sale” in bold red letters, hawker centre background",
    "Product shot of an amber glass bottle on wet black stone, studio lighting",
  ],
  video: [
    "A grandfather does tai chi in a misty park at sunrise",
    "Rain runs down a window while a cup of tea steams on the sill",
    "A drone glides over the Singapore skyline at dusk, lights flicking on",
    "Hands open a gift box and lift out a small glass bottle",
  ],
  edit: ["Change the background to a bright bathroom with plants", "Make it golden hour", "Put the product on a marble counter", "Turn the photo into a watercolor painting"],
}

const FILE_ICON = { image: "image", audio: "mic", video: "film" }
const CHIP_TYPES = new Set(["aspect", "camera", "style", "audioMood", "duration", "select", "toggle"])

export function mountCreate(root) {
  let tool = store.get("tool", "image")
  if (!toolById(tool)) tool = "image"
  let app = null
  let values = {}
  let count = store.get("count", 1)
  let seedLocked = false
  const uploads = new Map() // paramId -> progress 0..1 while uploading

  const toolTabs = h("nav.tool-tabs", { "aria-label": "Tools" })
  const appRow = h("div.app-row")
  const banner = h("div.banner-slot")
  const feed = h("section.feed", { "aria-label": "Your generations" })
  const grid = h("div.grid")
  const empty = h("div.empty-hero")
  feed.append(grid, empty)
  const composer = h("form.composer", { onsubmit: (e) => (e.preventDefault(), generate()) })
  const dropOverlay = h("div.drop-overlay", {}, h("div", {}, icon("upload"), h("p", {}, "Drop to add")))
  root.append(h("div.create", {}, h("header.create-head", {}, toolTabs, appRow), banner, feed, composer, dropOverlay))
  const grid$ = masonry(grid)

  // ------------------------------------------------------------ app/tool selection
  function pickTool(t, { appId, keep } = {}) {
    tool = t
    store.set("tool", t)
    const list = appsForTool(t)
    const saved = appId ?? store.get(`app:${t}`)
    pickApp((list.find((a) => a.id === saved) ?? list[0])?.id, { keep })
  }

  function pickApp(id, { keep } = {}) {
    app = appById(id)
    if (!app) return
    store.set(`app:${tool}`, app.id)
    const saved = store.get(`values:${app.id}`, {})
    const next = {}
    for (const p of app.params) {
      if (p.type === "seed") continue
      const v = keep?.[p.id] ?? saved[p.id]
      if (["image", "audio", "video"].includes(p.type)) {
        if (v && state.assets.get(v)) next[p.id] = v
      } else if (v !== undefined) next[p.id] = v
      else if (p.default !== undefined) next[p.id] = p.default
      else if (p.type === "prompt" || p.type === "text") next[p.id] = ""
    }
    // Carry the prompt across apps of the same kind.
    if (keep?.prompt === undefined && values.prompt && app.params.some((p) => p.type === "prompt") && !next.prompt) next.prompt = values.prompt
    values = next
    if (keep?.seed !== undefined) {
      values.seed = keep.seed
      seedLocked = true
    } else seedLocked = false
    renderAll()
  }

  function persist() {
    const { seed, ...rest } = values
    store.set(`values:${app.id}`, rest)
  }

  function set(id, v) {
    values[id] = v
    persist()
    renderComposer()
  }

  // ------------------------------------------------------------ rendering
  function renderAll() {
    renderTabs()
    renderApps()
    renderBanner()
    renderComposer()
    renderFeed()
  }

  function renderTabs() {
    replace(
      toolTabs,
      ...state.boot.tools.map((t) =>
        h(`button.tool-tab${t.id === tool ? ".active" : ""}`, { type: "button", onclick: () => pickTool(t.id), "aria-pressed": t.id === tool ? "true" : "false", title: t.blurb }, icon(t.icon), h("span", {}, t.label)),
      ),
    )
  }

  function renderApps() {
    const list = appsForTool(tool)
    replace(
      appRow,
      list.length > 1
        ? h(
            "div.app-choices",
            { role: "radiogroup", "aria-label": "Model" },
            ...list.map((a) =>
              h(
                `button.app-choice${a.id === app.id ? ".active" : ""}`,
                { type: "button", role: "radio", "aria-checked": a.id === app.id ? "true" : "false", onclick: () => pickApp(a.id, { keep: values }), title: a.blurb },
                h("span.app-name", {}, a.label),
                h("span.app-model", {}, a.model),
                h("span.app-meta", {}, a.gpu === 0 ? h("span.free", {}, icon("zap"), "Free") : `~${fmtSeconds(a.seconds)}`),
              ),
            ),
          )
        : null,
      h("p.app-blurb", {}, app.blurb),
    )
  }

  function renderBanner() {
    const dismissed = store.get("demo-banner-dismissed", false)
    replace(
      banner,
      isDemo() && !dismissed
        ? h(
            "div.banner",
            {},
            icon("info"),
            isWeb()
              ? h("span", {}, h("strong", {}, "Web demo. "), "Everything runs in your browser. Camera moves, cut-outs, photo upscaling and ad edits are real; the other AI results are stand-ins, because those models need the full studio and a GPU.")
              : h("span", {}, h("strong", {}, "Demo mode. "), "Results are placeholders made on this computer, so you can try every tool. Connect a GPU (RunPod or your own ComfyUI) to use the real models."),
            isWeb() ? h("a.btn.small", { href: fullStudioUrl(), target: "_blank", rel: "noopener" }, "Get Kino") : h("a.btn.small", { href: "#/settings" }, "Connect a GPU"),
            h("button.icon-btn.ghost.small", { type: "button", "aria-label": "Dismiss", onclick: () => (store.set("demo-banner-dismissed", true), renderBanner()) }, icon("x")),
          )
        : needsSetup()
          ? h(
              "div.banner",
              {},
              icon("info"),
              h("span", {}, h("strong", {}, "Set up this computer. "), "Kino installs the engine and a model pack for you (Fast images is about 7 GB, once), then makes pictures right here, with no account and no key."),
              h("a.btn.small", { href: "#/welcome" }, "Set up"),
            )
          : null,
    )
  }

  function fileParams() {
    return app.params.filter((p) => ["image", "audio", "video"].includes(p.type))
  }

  function subjectUrl() {
    const img = fileParams().find((p) => p.type === "image" && values[p.id])
    const a = img && state.assets.get(values[img.id])
    return a ? a.thumbUrl ?? a.url : null
  }

  function renderComposer() {
    const prompt = app.params.find((p) => p.type === "prompt")
    const refs = fileParams().map(refTile)
    const chips = app.params.filter((p) => CHIP_TYPES.has(p.type) && !p.advanced).map(chipFor).filter(Boolean)
    const advanced = app.params.filter((p) => p.advanced || p.type === "seed" || p.type === "text" || p.type === "number")
    const textarea = prompt
      ? h("textarea.prompt", {
          rows: 1,
          placeholder: PLACEHOLDER[tool] ?? PLACEHOLDER.custom,
          "aria-label": prompt.label ?? "Prompt",
          oninput: (e) => {
            values[prompt.id] = e.target.value
            persist()
            autosize(e.target)
          },
          onkeydown: (e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              generate()
            }
          },
        })
      : null
    if (textarea) textarea.value = values[prompt.id] ?? ""
    const ready = missing().length === 0
    replace(
      composer,
      h(
        "div.composer-main",
        {},
        refs.length ? h("div.refs", {}, ...refs) : null,
        textarea
          ? h(
              "div.prompt-wrap",
              {},
              textarea,
              h("button.icon-btn.ghost.enhance", { type: "button", title: "Improve my prompt", "aria-label": "Improve my prompt", onclick: (e) => enhance(e.currentTarget, textarea) }, icon("sparkles")),
            )
          : h("div.prompt-wrap.static", {}, h("p", {}, app.blurb)),
        h(
          "div.go",
          {},
          h(
            `button.generate${ready ? "" : ".dim"}`,
            { type: "submit", title: "Generate (Ctrl/⌘ + Enter)" },
            h("span.gen-label", {}, icon("sparkles"), "Generate"),
            h("span.gen-meta", {}, app.gpu === 0 ? "Free · instant" : webLocal(app.id) ? "Free · in your browser" : `${count > 1 ? `${count} × ` : ""}~${fmtSeconds(app.seconds)}`),
          ),
        ),
      ),
      h(
        "div.composer-chips",
        {},
        ...chips,
        app.params.some((p) => p.type === "seed") || app.output === "image"
          ? h("button.chip", { type: "button", title: "How many variations", onclick: () => ((count = (count % 4) + 1), store.set("count", count), renderComposer()) }, icon("layers"), `${count}×`)
          : null,
        advanced.length ? h("button.chip", { type: "button", onclick: (e) => openAdvanced(e.currentTarget, advanced) }, icon("sliders"), "More") : null,
      ),
    )
    if (textarea) requestAnimationFrame(() => autosize(textarea))
  }

  function refTile(p) {
    const asset = values[p.id] ? state.assets.get(values[p.id]) : null
    const progress = uploads.get(p.id)
    const label = p.label ?? p.type
    if (progress !== undefined) {
      return h("div.ref.uploading", { title: label }, h("div.ref-progress", { style: { width: `${Math.round(progress * 100)}%` } }), h("span.ref-label", {}, "Uploading…"))
    }
    if (asset) {
      return h(
        "div.ref.filled",
        { title: label },
        asset.kind === "audio" ? h("div.ref-audio", {}, icon("mic")) : h("img", { src: asset.thumbUrl ?? asset.url, alt: label }),
        h("span.ref-label", {}, shortLabel(label)),
        h("button.ref-x", { type: "button", "aria-label": `Remove ${label}`, onclick: () => set(p.id, undefined) }, icon("x")),
      )
    }
    const input = h("input", { type: "file", accept: `${p.type}/*`, hidden: true, onchange: (e) => e.target.files[0] && addFile(e.target.files[0], p) })
    return h(
      `button.ref.empty${p.required ? ".required" : ""}`,
      { type: "button", title: label, onclick: (e) => openRefMenu(e.currentTarget, p, input) },
      icon(FILE_ICON[p.type] ?? "plus"),
      h("span.ref-label", {}, shortLabel(label)),
      input,
    )
  }

  function openRefMenu(anchor, p, input) {
    const recent = [...state.assets.values()].filter((a) => a.kind === p.type && a.source !== "ad-part").sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)
    popover(
      anchor,
      h(
        "div.ref-menu",
        {},
        p.type === "audio" ? h("button.btn.block.primary", { type: "button", onclick: () => (closePopover(), openRecorder({ onDone: (file) => addFile(file, p) })) }, icon("mic"), "Record with your microphone") : null,
        h("button.btn.block", { type: "button", onclick: () => (closePopover(), input.click()) }, icon("upload"), `Upload ${p.type === "audio" ? "audio" : p.type}`),
        recent.length
          ? h(
              "div",
              {},
              h("p.muted.small", {}, "From your library"),
              h(
                "div.ref-grid",
                {},
                ...recent.map((a) =>
                  h(
                    "button.ref-pick",
                    { type: "button", onclick: () => (closePopover(), set(p.id, a.id)), title: a.prompt || a.name || "" },
                    a.kind === "audio" ? h("div.ref-audio", {}, icon("mic"), h("small", {}, a.name || "Audio")) : h("img", { src: a.thumbUrl ?? a.url, alt: "" }),
                  ),
                ),
              ),
            )
          : null,
      ),
      { className: "pop-ref" },
    )
  }

  function chipFor(p) {
    const v = values[p.id]
    switch (p.type) {
      case "aspect": {
        const a = aspectById(v)
        return h("button.chip", { type: "button", title: "Aspect ratio", onclick: (e) => aspectPicker(e.currentTarget, { options: p.options, current: v, onPick: (x) => set(p.id, x) }) }, a ? aspectGlyph(a.w, a.h) : null, v)
      }
      case "camera": {
        const c = cameraById(v)
        return h(
          "button.chip.cam-chip",
          { type: "button", title: "Camera move", onclick: () => openCameraSheet({ current: v, subject: subjectUrl(), onPick: (x) => set(p.id, x) }) },
          cameraThumb(c, subjectUrl(), "mini"),
          c?.label ?? "Camera",
        )
      }
      case "style": {
        const st = styleById(v)
        return h("button.chip", { type: "button", title: "Look", onclick: (e) => stylePicker(e.currentTarget, { current: v, onPick: (x) => set(p.id, x) }) }, h("span.swatch", { style: { background: STYLE_SWATCH[v] ?? STYLE_SWATCH.none } }), v === "none" ? "Style" : st?.label ?? v)
      }
      case "audioMood": {
        const a = audioById(v)
        return h("button.chip", { type: "button", title: "Sound", onclick: (e) => audioPicker(e.currentTarget, { current: v, onPick: (x) => set(p.id, x) }) }, icon(AUDIO_ICON[v] ?? "volume"), a?.label ?? "Sound")
      }
      case "duration":
        return h("button.chip", { type: "button", title: "Length", onclick: (e) => durationPicker(e.currentTarget, { min: p.min, max: p.max, step: p.step, current: v, onPick: (x) => set(p.id, x) }) }, icon("clock"), `${v}s`)
      case "select":
        return h("button.chip", { type: "button", title: p.label, onclick: (e) => selectPicker(e.currentTarget, { options: p.options, current: v, onPick: (x) => set(p.id, x) }) }, h("span.muted", {}, `${p.label}:`), String(p.options?.[v] ?? v))
      case "toggle":
        return h(`button.chip.toggle${v ? ".on" : ""}`, { type: "button", "aria-pressed": v ? "true" : "false", onclick: () => set(p.id, !v) }, icon(v ? "check" : "plus"), p.label)
      default:
        return null
    }
  }

  function openAdvanced(anchor, params) {
    const rows = params.map((p) => {
      if (p.type === "seed") {
        const input = h("input.input", { type: "number", min: 0, placeholder: "Random each time", value: seedLocked ? values.seed ?? "" : "" })
        input.addEventListener("input", () => {
          seedLocked = input.value !== ""
          values.seed = seedLocked ? Number(input.value) : undefined
        })
        return h("label.field", {}, h("span", {}, "Seed"), h("div.row", {}, input, h("button.icon-btn", { type: "button", title: "Random seed", onclick: () => ((input.value = Math.floor(Math.random() * 2 ** 32)), input.dispatchEvent(new Event("input"))) }, icon("dice"))), h("small.muted", {}, "Same seed + same settings = the same result."))
      }
      if (p.type === "text") {
        const ta = h("textarea.input", { rows: 2, placeholder: p.label })
        ta.value = values[p.id] ?? ""
        ta.addEventListener("input", () => ((values[p.id] = ta.value), persist()))
        return h("label.field", {}, h("span", {}, p.label), ta)
      }
      if (p.type === "number") {
        const input = h("input.input", { type: "number", value: values[p.id] ?? p.default ?? "" })
        input.addEventListener("input", () => ((values[p.id] = input.value === "" ? undefined : Number(input.value)), persist()))
        return h("label.field", {}, h("span", {}, p.label), input)
      }
      if (p.type === "toggle") {
        const box = h("input", { type: "checkbox", checked: !!values[p.id] })
        box.addEventListener("change", () => ((values[p.id] = box.checked), persist()))
        return h("label.field.inline", {}, box, h("span", {}, p.label))
      }
      return chipFor(p)
    })
    popover(anchor, h("div.advanced", {}, ...rows), { className: "pop-advanced", align: "end" })
  }

  function missing() {
    const out = []
    for (const p of app.params) {
      if (!p.required) continue
      if (["image", "audio", "video"].includes(p.type) && !values[p.id]) out.push(p)
      if (p.type === "prompt" && !String(values[p.id] ?? "").trim()) out.push(p)
    }
    return out
  }

  async function generate() {
    const need = missing()
    if (need.length) {
      const p = need[0]
      toast(p.type === "prompt" ? (tool === "edit" ? "Describe the change you want." : "Write a prompt first.") : `Add ${(p.label ?? p.type).toLowerCase()}.`, { kind: "error" })
      composer.classList.remove("shake")
      void composer.offsetWidth
      composer.classList.add("shake")
      return
    }
    const send = { ...values }
    if (!seedLocked) delete send.seed
    const btn = composer.querySelector(".generate")
    btn?.classList.add("busy")
    try {
      const { jobs } = await api("/api/generate", { method: "POST", body: { app: app.id, values: send, count: app.params.some((p) => p.type === "seed") || app.output === "image" ? count : 1 } })
      for (const j of jobs) state.jobs.set(j.id, j)
      renderFeed()
      feed.scrollTo?.({ top: 0, behavior: "smooth" })
    } catch (e) {
      fail(e)
    } finally {
      btn?.classList.remove("busy")
    }
  }

  async function enhance(btn, textarea) {
    btn.classList.add("busy")
    const before = textarea.value
    try {
      const imageParam = fileParams().find((p) => p.type === "image" && values[p.id])
      const res = await api("/api/enhance", {
        method: "POST",
        body: { tool: ["video", "edit", "talk"].includes(tool) ? tool : "image", prompt: before, imageAssetId: imageParam ? values[imageParam.id] : undefined, camera: values.camera, style: values.style },
      })
      if (!res.prompt) return toast("Write a few words first, or add a photo.", { kind: "info" })
      textarea.value = res.prompt
      values.prompt = res.prompt
      persist()
      autosize(textarea)
      toast(res.source === "claude" ? "Prompt improved by Claude" : res.note ?? "Basic rewrite. Add a Claude key in Settings for smarter prompts.", {
        kind: res.source === "claude" ? "ok" : "info",
        action: { label: "Undo", run: () => ((textarea.value = before), (values.prompt = before), persist(), autosize(textarea)) },
      })
    } catch (e) {
      fail(e)
    } finally {
      btn.classList.remove("busy")
    }
  }

  async function addFile(file, param) {
    const kind = file.type.split("/")[0]
    const p = param ?? fileParams().find((x) => x.type === kind && !values[x.id]) ?? fileParams().find((x) => x.type === kind)
    if (!p) {
      // Wrong tool for this file: hop to one that takes it.
      if (kind === "image" && tool !== "image") pickTool("video")
      else return toast(`${app.label} doesn't take ${kind} files.`, { kind: "error" })
      return addFile(file)
    }
    uploads.set(p.id, 0)
    renderComposer()
    try {
      const asset = await upload(file, (x) => {
        uploads.set(p.id, x)
        const bar = composer.querySelector(".ref-progress")
        if (bar) bar.style.width = `${Math.round(x * 100)}%`
      })
      state.assets.set(asset.id, asset)
      values[p.id] = asset.id
      persist()
    } catch (e) {
      fail(e)
    } finally {
      uploads.delete(p.id)
      renderComposer()
    }
  }

  // ------------------------------------------------------------ feed
  const feedJobs = () =>
    [...state.jobs.values()]
      .filter((j) => !j.source || j.source === "generated")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 240)

  function cardFor(job) {
    if (job.status === "done") {
      const asset = state.assets.get(job.outputs?.[0])
      if (!asset) return null
      return assetCard(asset, { list: () => feedJobs().filter((j) => j.status === "done").map((j) => j.outputs?.[0]).filter((id) => state.assets.has(id)) })
    }
    return jobCard(job, { onRemove: () => (state.jobs.delete(job.id), renderFeed()) })
  }

  function renderFeed() {
    const jobs = feedJobs()
    const cards = jobs.map(cardFor).filter(Boolean)
    grid.replaceChildren(...cards)
    grid$.layout()
    empty.hidden = cards.length > 0
    if (!cards.length) renderEmpty()
  }

  function updateJob(job) {
    const existing = grid.querySelector(`[data-id="${job.id}"]`) ?? (job.outputs?.[0] && grid.querySelector(`[data-id="${job.outputs[0]}"]`))
    if (!existing) return renderFeed()
    const next = cardFor(job)
    if (!next) return renderFeed()
    // Keep video hover state and avoid flicker for progress-only updates.
    if (existing.classList.contains("job") && next.classList.contains("job") && existing.className === next.className) {
      existing.replaceChildren(...next.childNodes)
      return
    }
    existing.replaceWith(next)
    grid$.layout()
  }

  function renderEmpty() {
    const ideas = IDEAS[tool] ?? IDEAS.image
    replace(
      empty,
      h("h1", {}, tool === "video" ? "Bring a photo to life" : tool === "edit" ? "Change anything with words" : "What will you make today?"),
      h("p.muted", {}, toolById(tool)?.blurb),
      app.params.some((p) => p.type === "prompt")
        ? h(
            "div.ideas",
            {},
            ...ideas.map((idea) =>
              h(
                "button.idea",
                {
                  type: "button",
                  onclick: () => {
                    values.prompt = idea
                    persist()
                    renderComposer()
                    composer.querySelector("textarea")?.focus()
                  },
                },
                icon("sparkles"),
                idea,
              ),
            ),
          )
        : null,
    )
  }

  // ------------------------------------------------------------ drag, drop, paste
  let dragDepth = 0
  const onDragEnter = (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return
    dragDepth++
    root.classList.add("dragging")
  }
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1)
    if (!dragDepth) root.classList.remove("dragging")
  }
  const onDrop = (e) => {
    e.preventDefault()
    dragDepth = 0
    root.classList.remove("dragging")
    const file = e.dataTransfer?.files?.[0]
    if (file) addFile(file)
  }
  const onPaste = (e) => {
    if (e.target.closest?.("input, textarea") && !e.clipboardData?.files?.length) return
    const file = e.clipboardData?.files?.[0]
    if (file) {
      e.preventDefault()
      addFile(file)
    }
  }
  const onKey = (e) => {
    if (e.key === "/" && !e.target.closest?.("input, textarea")) {
      e.preventDefault()
      composer.querySelector("textarea")?.focus()
    }
  }
  root.addEventListener("dragenter", onDragEnter)
  root.addEventListener("dragleave", onDragLeave)
  root.addEventListener("dragover", (e) => e.preventDefault())
  root.addEventListener("drop", onDrop)
  document.addEventListener("paste", onPaste)
  document.addEventListener("keydown", onKey)

  // ------------------------------------------------------------ live updates
  const offs = [
    on("job", (job) => {
      if (job.source && job.source !== "generated") return
      updateJob(job)
    }),
    on("job-removed", () => renderFeed()),
    on("asset", (a) => {
      const card = grid.querySelector(`[data-id="${a.id}"]`)
      if (card) {
        const job = [...state.jobs.values()].find((j) => j.outputs?.[0] === a.id)
        if (job) updateJob(job)
      }
    }),
    on("asset-removed", () => renderFeed()),
    on("boot", () => {
      if (!appById(app?.id)) pickTool(tool)
      else renderAll()
    }),
    on("compose", ({ tool: t, appId, values: v, focus }) => {
      pickTool(t, { appId, keep: v })
      if (focus) setTimeout(() => composer.querySelector("textarea")?.focus(), 50)
    }),
  ]

  pickTool(tool)
  // Switching to Simple carries what's on the composer into the matching task.
  viewState.get = () => (app ? { tool, appId: app.id, values } : null)
  const pendingCompose = window.__kinoCompose
  if (pendingCompose) {
    window.__kinoCompose = null
    pickTool(pendingCompose.tool, { appId: pendingCompose.appId, keep: pendingCompose.values })
  }

  return () => {
    offs.forEach((off) => off())
    grid$.disconnect()
    document.removeEventListener("paste", onPaste)
    document.removeEventListener("keydown", onKey)
  }
}

function autosize(ta) {
  ta.style.height = "auto"
  ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
}

const shortLabel = (label) => label.replace(/\s*\(optional\)/i, "")
