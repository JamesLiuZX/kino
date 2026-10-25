// Simple mode's guided tasks. Each task is a short list of steps (photo,
// description, look, shape, move...) with sensible defaults, a stage that
// previews what you'll get before any GPU time is spent, honest progress, and
// the obvious next steps once it's done. Tasks map onto the same apps and values
// as the Studio, so switching to Advanced keeps your work.

import { h, icon, api, upload, toast, fail, store, aspectGlyph, fmtSeconds, replace } from "./ui.mjs"
import { state, on, appById, cameraById, styleById, isDemo, isWeb, needsSetup, webLocal, fullStudioUrl, watched, viewState } from "./state.mjs"
import { cameraThumb, openCameraSheet, STYLE_SWATCH } from "./pickers.mjs"
import { openLightbox, ring, download } from "./media.mjs"
import { openRecorder } from "./recorder.mjs"

// ---------------------------------------------------------------- content

const SCENES = [
  { label: "Marble bathroom counter", text: "on a white marble bathroom counter in soft morning light, with a folded towel and a small plant", swatch: "linear-gradient(135deg,#f6f3ee,#d6d0c6)" },
  { label: "Teak table, morning sun", text: "on a teak side table by a window, warm morning sunlight and soft shadows", swatch: "linear-gradient(135deg,#f3d3a6,#a36a43)" },
  { label: "Festive gift box", text: "in an open red gift box with gold ribbon, on a festive Chinese New Year table", swatch: "linear-gradient(135deg,#d9402f,#f4c56a)" },
  { label: "Bedside lamp", text: "on a bedside table beside a warm lamp, a cosy evening mood", swatch: "linear-gradient(135deg,#3a2e48,#efb16a)" },
  { label: "Plants and sunlight", text: "among green plants in dappled sunlight, fresh and natural", swatch: "linear-gradient(135deg,#d3eabd,#4d8758)" },
  { label: "Clean studio", text: "on a seamless off-white studio backdrop, soft box lighting and a gentle shadow", swatch: "linear-gradient(135deg,#ffffff,#e2ddd4)" },
]

const IMAGE_IDEAS = [
  "A cosy HDB living room at golden hour, a grandmother reading by the window",
  "Macro shot of golden frankincense resin on dark wood, dramatic side light",
  "A poster that says “Weekend Sale” in bold red letters, hawker centre background",
  "An amber glass bottle on wet black stone, studio lighting",
]

const CHANGE_IDEAS = ["Change the background to a bright bathroom with plants", "Make it golden hour", "Put it on a marble counter", "Turn it into a watercolor painting", "Remove the clutter behind it"]

const MOTION_IDEAS = ["Steam curls up as warm light moves across the table", "Hands lift the bottle and turn it toward the camera", "A slow sunrise light sweeps over the scene"]

const FEATURED_MOVES = ["push-in", "pull-out", "orbit", "pan-right", "tilt-up", "product-spin", "hero-reveal", "crane-up"]
const LOOKS = ["none", "product", "warm-home", "cinematic", "ugc", "ink", "watercolor", "3d"]
const FORMAT_LABEL = { "9:16": ["Story", "TikTok · Reels"], "1:1": ["Square", "Feed"], "4:5": ["Portrait", "Meta feed"], "16:9": ["Wide", "YouTube"] }
const SOUNDS = [
  { id: "ambient", label: "Natural sound", sub: "Room tone and real sound effects" },
  { id: "upbeat", label: "Upbeat music", sub: "Bright and modern" },
  { id: "warm-zh", label: "Warm Mandarin voice", sub: "A soft voice over light music" },
  { id: "silent", label: "Silent", sub: "Add your own audio later" },
]

const keepLabel = "Keep the product, its shape and its label exactly as they are; only change the setting and the light."

// ---------------------------------------------------------------- tasks

export const TASKS = {
  image: {
    title: ["An image from", "words"],
    blurb: "Describe anything. Kino picks the model and the settings; turn on “words in the picture” for posters and labels.",
    output: "image",
    stage: "prompt",
    steps: [
      { id: "prompt", kind: "prompt", title: "Describe it", hint: "Who or what, where, and the light. One or two sentences is plenty.", placeholder: "A bottle of herbal oil on a teak table, soft morning light", ideas: IMAGE_IDEAS, required: true, enhance: "image" },
      { id: "style", kind: "look", title: "Pick a look", optional: true },
      { id: "aspect", kind: "format", title: "Shape", options: ["1:1", "4:5", "9:16", "16:9"], default: "1:1" },
      { id: "hasText", kind: "toggle", title: "Words in the picture?", hint: "For posters, signs and labels. Uses the model that spells best.", default: false },
      { id: "count", kind: "count", title: "How many to make", options: [1, 2, 4], default: 2 },
    ],
    app: (v) => (v.hasText ? "image-pro" : "image-fast"),
    values: (v) => ({ prompt: v.prompt, style: v.style ?? "none", aspect: v.aspect ?? "1:1" }),
    count: (v) => v.count ?? 2,
  },
  photo: {
    title: ["Your product,", "somewhere new"],
    blurb: "Your real product photo, placed in a new scene. The label stays exactly as it is.",
    output: "image",
    stage: "photo",
    steps: [
      { id: "image", kind: "photo", title: "Your product", hint: "Your brand photos come first. Any clear product photo works.", accept: "image", brandFirst: true, required: true },
      { id: "prompt", kind: "prompt", title: "The scene", hint: "Where should it be? Tap an idea or write your own.", placeholder: "on a marble bathroom counter, soft morning light", scenes: SCENES, required: true },
    ],
    app: () => "edit",
    values: (v) => ({ image: v.image, prompt: `Place this product ${String(v.prompt ?? "").trim().replace(/[.。]+$/, "")}. ${keepLabel}` }),
  },
  animate: {
    title: ["Bring a photo", "to life"],
    blurb: "Pick a camera move and watch it play on your photo before you make it.",
    output: "video",
    stage: "camera",
    steps: [
      { id: "image", kind: "photo", title: "Your photo", hint: "A product, a person or a place.", accept: "image", brandFirst: true, required: true },
      { id: "camera", kind: "camera", title: "Camera move", hint: "Each one is playing on your photo.", default: "push-in", deps: ["image"] },
      { id: "aspect", kind: "format", title: "Shape and length", titleFor: (v) => (v.motion === "ai" ? "Length" : "Shape and length"), options: ["9:16", "1:1", "4:5", "16:9"], default: "9:16", length: { id: "duration", min: 2, max: 10, default: 4 }, deps: ["motion"], keepsPhotoShape: (v) => v.motion === "ai" },
      {
        id: "motion",
        kind: "choice",
        title: "How it moves",
        default: "camera",
        options: [
          { id: "camera", label: "Camera move", sub: "The exact move above, made on this computer in seconds. Free.", tag: "Free" },
          { id: "ai", label: "AI motion with sound", sub: "A video model animates the scene and adds sound. About two minutes on a GPU.", tag: "GPU" },
        ],
      },
      { id: "prompt", kind: "prompt", title: "What happens", hint: "Optional. Leave it empty and the model follows the camera move.", placeholder: "Steam curls up as warm light moves across the table", ideas: MOTION_IDEAS, when: (v) => v.motion === "ai", optional: true, enhance: "video" },
      { id: "audio", kind: "choice", title: "Sound", default: "ambient", options: SOUNDS, when: (v) => v.motion === "ai", compact: true },
    ],
    app: (v) => (v.motion === "ai" ? "video-pro" : "video-instant"),
    values: (v) =>
      v.motion === "ai"
        ? { image: v.image, prompt: v.prompt ?? "", camera: v.camera ?? "push-in", audio: v.audio ?? "ambient", duration: v.duration ?? 4, style: "none" }
        : { image: v.image, camera: v.camera ?? "push-in", aspect: v.aspect ?? "9:16", duration: v.duration ?? 4 },
  },
  change: {
    title: ["Change a photo", "with words"],
    blurb: "New background, new light, something added or taken away. Describe the change.",
    output: "image",
    stage: "compare",
    steps: [
      { id: "image", kind: "photo", title: "Your photo", accept: "image", required: true },
      { id: "prompt", kind: "prompt", title: "What should change?", hint: "Say what to change, not what the photo is.", placeholder: "Change the background to a bright bathroom with plants", ideas: CHANGE_IDEAS, required: true, enhance: "edit" },
    ],
    app: () => "edit",
    values: (v) => ({ image: v.image, prompt: v.prompt }),
  },
  cutout: {
    title: ["Remove the", "background"],
    blurb: "A clean cut-out with a transparent background, ready for listings, posts and the ad end card.",
    output: "image",
    stage: "cutout",
    steps: [{ id: "image", kind: "photo", title: "Your photo", hint: "Works best with one clear subject.", accept: "image", brandFirst: true, required: true }],
    app: () => "cutout",
    values: (v) => ({ image: v.image }),
  },
  talk: {
    title: ["Make a photo", "talk"],
    blurb: "A face photo and a voice recording become a lip-synced video.",
    output: "video",
    stage: "talk",
    steps: [
      { id: "image", kind: "photo", title: "A face", hint: "A clear, front-facing photo works best.", accept: "image", required: true },
      { id: "audio", kind: "photo", title: "The voice", hint: "Record it here, or add an mp3 or wav of what they say, up to 15 seconds.", accept: "audio", required: true },
      { id: "prompt", kind: "prompt", title: "How they look while speaking", placeholder: "Warm and friendly, small nods, natural blinking", optional: true },
    ],
    app: () => "talk",
    values: (v) => ({ image: v.image, audio: v.audio, prompt: v.prompt ?? "", aspect: "9:16", duration: 6 }),
  },
  enhance: {
    title: ["Sharpen and", "enlarge"],
    blurb: "Upscale a photo or a video, or smooth a video's motion.",
    output: "same",
    stage: "enhance",
    steps: [
      { id: "media", kind: "photo", title: "Photo or video", accept: "image,video", required: true },
      {
        id: "action",
        kind: "choice",
        title: "What to do",
        deps: ["media"],
        default: "up2",
        options: (v) =>
          kindOf(v.media) === "video"
            ? [
                { id: "up2", label: "Upscale 2×", sub: "Sharper and twice the size. A few minutes." },
                { id: "smooth", label: "Smooth the motion", sub: "Doubles the frames for silky movement." },
              ]
            : [
                { id: "up2", label: "Upscale 2×", sub: "Sharper and twice the size. About 40 seconds." },
                { id: "up4", label: "Upscale 4×", sub: "For print and big screens." },
              ],
      },
    ],
    app: (v) => (kindOf(v.media) === "video" ? (v.action === "smooth" ? "smooth" : "upscale-video") : "upscale-image"),
    values: (v) =>
      kindOf(v.media) === "video"
        ? v.action === "smooth"
          ? { video: v.media, factor: "2x" }
          : { video: v.media, scale: "2x" }
        : { image: v.media, scale: v.action === "up4" ? "4x" : "2x" },
  },
}

const kindOf = (id) => state.assets.get(id)?.kind

/** Which guided task opens a Studio request (Animate, Edit, Remix…), or null. */
export function taskForCompose({ tool, appId, values = {} }) {
  if (tool === "video" && appId !== "video-scene" && appId !== "video-draft")
    return { task: "animate", values: { image: values.image, camera: values.camera, duration: values.duration, aspect: values.aspect, prompt: values.prompt, audio: values.audio, motion: appId === "video-pro" ? "ai" : "camera" } }
  if (tool === "edit") return { task: "change", values: { image: values.image, prompt: values.prompt } }
  if (tool === "image") return { task: "image", values: { prompt: values.prompt, style: values.style, aspect: values.aspect, hasText: appId === "image-pro" } }
  if (tool === "cutout") return { task: "cutout", values: { image: values.image } }
  if (tool === "talk") return { task: "talk", values: { image: values.image, audio: values.audio, prompt: values.prompt } }
  if (tool === "enhance") return { task: "enhance", values: { media: values.image ?? values.video } }
  return null
}

/** Open a task with values already filled in. */
export function openTask(task, values = {}) {
  window.__kinoFlow = { task, values }
  const hash = `#/make/${task}`
  if (location.hash === hash) window.dispatchEvent(new CustomEvent("kino:flow-prefill"))
  else location.hash = hash
}

// ---------------------------------------------------------------- the flow view

export function mountFlow(root, taskId) {
  const task = TASKS[taskId]
  if (!task) {
    location.hash = "#/home"
    return
  }
  let v = clean({ ...defaults(task), ...store.get(`flow:${taskId}`, {}) })
  const uploads = new Map()
  let run = null // { jobIds, selected }
  let enhanceBusy = false

  const stepsEl = h("div.steps")
  const ctaEl = h("div.flow-cta")
  const stage = h("div.stage")
  const below = h("div.stage-below", { style: { display: "grid", gap: "14px" } })
  const historyEl = h("section.task-history")
  const stepEls = new Map()

  root.append(
    h(
      "div.flow",
      {},
      h(
        "header.flow-head",
        {},
        h("a.back", { href: "#/home" }, icon("arrow-left"), "All tasks"),
        h("h1", {}, wordsFor(task.title)),
        h("p.rise", { style: { "--d": "0.25s" } }, task.blurb),
      ),
      h("div.flow-grid", {}, h("div", { style: { display: "grid", gap: "12px", alignContent: "start" } }, stepsEl, ctaEl), h("div.stage-col", {}, stage, below)),
      historyEl,
    ),
  )

  // ------------------------------------------------------------ values
  function defaults(t) {
    const out = {}
    for (const s of t.steps) {
      if (s.default !== undefined) out[s.id] = s.default
      if (s.length) out[s.length.id] = s.length.default
    }
    return out
  }

  function clean(obj) {
    // Drop references to files that are gone.
    for (const s of task.steps) if (s.kind === "photo" && obj[s.id] && !state.assets.get(obj[s.id])) delete obj[s.id]
    return obj
  }

  function prefill() {
    const pending = window.__kinoFlow
    if (!pending || pending.task !== taskId) return
    window.__kinoFlow = null
    const next = { ...v }
    for (const [k, val] of Object.entries(pending.values ?? {})) if (val !== undefined && val !== null && val !== "") next[k] = val
    v = clean(next)
    run = null
    persist()
  }

  // Brand photos make the first run zero-effort.
  function autofill() {
    const first = task.steps.find((s) => s.kind === "photo" && s.brandFirst)
    if (first && !v[first.id]) {
      const photo = brandPhotos().find((a) => a.brandImage?.endsWith(":photo")) ?? brandPhotos()[0]
      if (photo) v[first.id] = photo.id
    }
  }

  const persist = () => {
    const { ...keep } = v
    store.set(`flow:${taskId}`, keep)
  }

  function set(id, value) {
    v[id] = value
    if (run && !run.done) {
      /* keep the run on stage until it finishes */
    } else run = null
    persist()
    renderSteps(id)
    renderStage()
    renderCta()
  }

  const visible = (s) => !s.when || s.when(v)
  const filled = (s) => (s.kind === "prompt" ? String(v[s.id] ?? "").trim().length > 0 : v[s.id] !== undefined && v[s.id] !== null && v[s.id] !== "")
  const missing = () => task.steps.filter((s) => visible(s) && s.required && !filled(s))

  // ------------------------------------------------------------ steps
  function renderSteps(changed) {
    const list = task.steps.filter(visible)
    const firstMissing = missing()[0]
    // Build or refresh each step's box; keep focus inside the prompt.
    const order = []
    list.forEach((s, i) => {
      let el = stepEls.get(s.id)
      const needs = !el || changed === undefined || (changed === s.id && s.kind !== "prompt") || s.deps?.includes(changed)
      if (needs) {
        const fresh = stepBox(s, i)
        if (el) el.replaceWith(fresh)
        el = fresh
        stepEls.set(s.id, el)
      }
      el.classList.toggle("active", s === firstMissing)
      el.classList.toggle("done", filled(s) && s !== firstMissing)
      el.querySelector(".step-num").replaceChildren(filled(s) && s !== firstMissing ? icon("check") : String(i + 1))
      order.push(el)
    })
    for (const [id, el] of stepEls) if (!list.some((s) => s.id === id)) (el.remove(), stepEls.delete(id))
    stepsEl.replaceChildren(...order)
  }

  function stepBox(s, i) {
    return h(
      "section.step",
      { style: { "--d": `${0.08 + i * 0.06}s` }, dataset: { step: s.id } },
      h("span.step-num", {}, String(i + 1)),
      h("div.step-top", {}, h("h2.step-title", {}, s.titleFor?.(v) ?? s.title), s.optional ? h("span.step-optional", {}, "Optional") : null),
      s.hint ? h("p.step-hint", {}, s.hint) : null,
      control(s),
    )
  }

  function control(s) {
    switch (s.kind) {
      case "photo":
        return photoPicker(s)
      case "prompt":
        return promptBox(s)
      case "look":
        return looks(s)
      case "format":
        return formats(s)
      case "camera":
        return moves(s)
      case "choice":
        return choices(s)
      case "toggle":
        return h(
          "div.toggle-row",
          {},
          h("span.small.muted", {}, v[s.id] ? "On: the text model" : "Off: the fast model"),
          h(`button.switch${v[s.id] ? ".on" : ""}`, { type: "button", role: "switch", "aria-checked": v[s.id] ? "true" : "false", "aria-label": s.title, onclick: () => set(s.id, !v[s.id]) }),
        )
      case "count":
        return h("div.segmented", {}, ...s.options.map((n) => h(`button${v[s.id] === n ? ".active" : ""}`, { type: "button", onclick: () => set(s.id, n) }, n === 1 ? "1" : `${n} options`)))
      default:
        return null
    }
  }

  function brandPhotos() {
    return [...state.assets.values()].filter((a) => a.source === "brand" && a.kind === "image")
  }

  function photoPicker(s) {
    const accepts = s.accept.split(",")
    const fit = (a) => accepts.includes(a.kind)
    const brand = s.brandFirst ? brandPhotos().filter(fit) : []
    const recent = [...state.assets.values()]
      .filter((a) => fit(a) && a.source !== "ad-part" && !brand.includes(a))
      .sort((a, b) => b.createdAt - a.createdAt)
    const selected = v[s.id]
    if (selected && !brand.some((a) => a.id === selected) && !recent.slice(0, 6).some((a) => a.id === selected)) {
      const a = state.assets.get(selected)
      if (a) recent.unshift(a)
    }
    const input = h("input", { type: "file", accept: accepts.map((k) => `${k}/*`).join(","), hidden: true, onchange: (e) => e.target.files[0] && addFile(e.target.files[0], s) })
    const progress = uploads.get(s.id)
    const audio = s.accept === "audio"
    const tiles = [
      audio && progress === undefined ? h("button.pick.upload", { type: "button", onclick: () => openRecorder({ onDone: (file) => addFile(file, s) }), title: "Record with your microphone" }, icon("mic"), h("span", {}, "Record")) : null,
      h(
        "button.pick.upload",
        { type: "button", onclick: () => input.click(), title: "Upload from this computer" },
        progress !== undefined ? h("span", {}, `${Math.round(progress * 100)}%`) : icon("upload"),
        progress !== undefined ? h("span", {}, "Uploading") : h("span", {}, audio ? "Add a file" : "Upload"),
        input,
      ),
      ...[...brand, ...recent].slice(0, audio ? 6 : 7).map((a) =>
        h(
          `button.pick${a.id === selected ? ".selected" : ""}${a.brandImage?.endsWith(":cutout") ? ".contain" : ""}`,
          { type: "button", title: a.name || a.prompt || "", onclick: () => set(s.id, a.id === selected && !s.required ? undefined : a.id) },
          a.kind === "audio" ? h("div.ref-audio", {}, icon("mic")) : a.kind === "video" ? h("video", { src: a.url, muted: true, preload: "metadata" }) : h("img", { src: a.thumbUrl ?? a.url, alt: "" }),
          a.source === "brand" ? h("span.pick-label", {}, a.brandImage?.endsWith(":cutout") ? "Cut-out" : "Product") : a.kind === "audio" ? h("span.pick-label", {}, a.name || "Audio") : null,
        ),
      ),
    ]
    return h("div", {}, h("div.picks", {}, ...tiles), h("p.small.muted", { style: { marginTop: "8px" } }, "Or drop or paste a file anywhere on this page."))
  }

  function promptBox(s) {
    const ta = h("textarea", {
      placeholder: s.placeholder,
      "aria-label": s.title,
      rows: 3,
      oninput: (e) => {
        v[s.id] = e.target.value
        persist()
        const box = stepEls.get(s.id)
        const firstMissing = missing()[0]
        stepEls.forEach((el, id) => el.classList.toggle("active", firstMissing?.id === id))
        box?.classList.toggle("done", filled(s) && firstMissing !== s)
        renderCta()
        renderQuote()
      },
      onkeydown: (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), make())
      },
    })
    ta.value = v[s.id] ?? ""
    const fillWith = (text) => {
      ta.value = text
      v[s.id] = text
      persist()
      renderSteps(s.id + ":idea")
      renderStage()
      renderCta()
      ta.focus()
    }
    return h(
      "div",
      { style: { display: "grid", gap: "10px" } },
      h(
        "div.prompt-box",
        {},
        ta,
        s.enhance
          ? h(
              `button.icon-btn.ghost.small.enhance${enhanceBusy ? ".busy" : ""}`,
              { type: "button", title: "Improve my words", "aria-label": "Improve my words", onclick: (e) => enhance(e.currentTarget, ta, s) },
              icon("sparkles"),
            )
          : null,
      ),
      s.scenes
        ? h("div.ideas", {}, ...s.scenes.map((sc) => h("button.idea", { type: "button", onclick: () => fillWith(sc.text) }, h("span.swatch", { style: { background: sc.swatch } }), sc.label)))
        : s.ideas
          ? h("div.ideas", {}, ...s.ideas.map((idea) => h("button.idea", { type: "button", onclick: () => fillWith(idea) }, icon("sparkles"), short(idea))))
          : null,
    )
  }

  function looks(s) {
    const styles = state.boot.presets.styles.filter((st) => LOOKS.includes(st.id))
    return h(
      "div.picks",
      {},
      ...styles.map((st) =>
        h(
          `button.pick${(v[s.id] ?? "none") === st.id ? ".selected" : ""}`,
          { type: "button", title: st.suffix || "No added style", onclick: () => set(s.id, st.id) },
          h("span", { style: { position: "absolute", inset: "0", background: STYLE_SWATCH[st.id] ?? STYLE_SWATCH.none } }),
          h("span.pick-label", {}, st.id === "none" ? "As written" : st.label),
        ),
      ),
    )
  }

  function formats(s) {
    const len = s.length
    const photoShape = s.keepsPhotoShape?.(v)
    return h(
      "div",
      { style: { display: "grid", gap: "12px" } },
      photoShape
        ? h("p.small.muted", {}, "AI motion keeps your photo's shape.")
        : h(
        "div.formats",
        {},
        ...s.options.map((id) => {
          const a = state.boot.presets.aspects.find((x) => x.id === id)
          const scale = 30 / Math.max(a.w, a.h)
          return h(
            `button.format${v[s.id] === id ? ".selected" : ""}`,
            { type: "button", onclick: () => set(s.id, id) },
            h("span.frame", { style: { width: `${Math.round(a.w * scale)}px`, height: `${Math.round(a.h * scale)}px` } }),
            h("strong", {}, FORMAT_LABEL[id]?.[0] ?? id),
            h("small", {}, FORMAT_LABEL[id]?.[1] ?? id),
          )
        }),
      ),
      len
        ? (() => {
            const val = h("span.val", {}, `${v[len.id] ?? len.default}s`)
            const range = h("input", { type: "range", min: len.min, max: len.max, step: 1, value: v[len.id] ?? len.default, "aria-label": "Length in seconds" })
            range.addEventListener("input", () => (val.textContent = `${range.value}s`))
            range.addEventListener("change", () => set(len.id, Number(range.value)))
            return h("div.slider-row", {}, h("span.small.muted", {}, "Length"), range, val)
          })()
        : null,
    )
  }

  function moves(s) {
    const subject = photoUrl()
    const presets = FEATURED_MOVES.map(cameraById).filter(Boolean)
    const current = v[s.id]
    if (current && !FEATURED_MOVES.includes(current) && cameraById(current)) presets[presets.length - 1] = cameraById(current)
    return h(
      "div",
      { style: { display: "grid", gap: "8px" } },
      h(
        "div.moves",
        {},
        ...presets.map((p) => h(`button.move${p.id === current ? ".selected" : ""}`, { type: "button", title: p.phrase, onclick: () => set(s.id, p.id) }, cameraThumb(p, subject), h("span", {}, p.label))),
      ),
      h("button.btn.ghost.small", { type: "button", style: { justifySelf: "start" }, onclick: () => openCameraSheet({ current, subject, onPick: (x) => set(s.id, x) }) }, icon("film"), "All 20 moves"),
    )
  }

  function choices(s) {
    const opts = typeof s.options === "function" ? s.options(v) : s.options
    if (!opts.some((o) => o.id === v[s.id])) v[s.id] = opts[0].id
    return h(
      `div.options${s.compact ? ".two" : ""}`,
      {},
      ...opts.map((o) =>
        h(
          `button.option${v[s.id] === o.id ? ".selected" : ""}`,
          { type: "button", onclick: () => set(s.id, o.id) },
          h("strong", {}, o.label),
          o.sub ? h("small", {}, o.sub) : null,
          o.tag ? h(`span.pill.small.tag${o.tag === "Free" ? ".ok" : ""}`, {}, o.tag) : null,
        ),
      ),
    )
  }

  // ------------------------------------------------------------ call to action
  function appNow() {
    return appById(task.app(v))
  }

  function renderCta() {
    const app = appNow()
    const need = missing()
    const count = task.count?.(v) ?? 1
    const busy = run && !run.done
    const local = webLocal(app?.id)
    const time = app ? (app.gpu === 0 || local ? "Free · runs here" : `${count > 1 ? `${count} × ` : ""}~${fmtSeconds(app.seconds)}`) : ""
    replace(
      ctaEl,
      h(
        `button.make-btn${need.length ? ".dim" : ""}${busy ? ".busy" : ""}`,
        { type: "button", onclick: make, disabled: busy },
        icon(busy ? "refresh" : "sparkles"),
        h("span", {}, busy ? "Making…" : need.length ? `Add ${need[0].title.toLowerCase()} first` : run?.done ? "Make again" : "Make it"),
        !busy && !need.length ? h("small", {}, time) : null,
      ),
      h(
        "p.cta-note",
        {},
        isWeb()
          ? app?.gpu && !local
            ? [icon("info"), "Web demo: a stand-in made in your browser. ", h("a.link", { href: fullStudioUrl(), target: "_blank", rel: "noopener" }, "Get the full studio")]
            : [icon("check"), `Runs in your browser, for real${local?.note ? `. ${local.note}` : ""}`]
          : isDemo()
          ? [icon("info"), "Demo mode: a placeholder is made on this computer. ", h("a.link", { href: "#/settings" }, "Connect a GPU")]
          : state.boot.provider.id === "local" && app?.gpu
            ? needsSetup()
              ? [icon("info"), "This computer isn't set up yet. ", h("a.link", { href: "#/welcome" }, "Set it up")]
              : [icon("laptop"), "Runs on this computer"]
          : app?.gpu
            ? [icon("bolt"), `Runs on your GPU · ${app.model}`]
            : [icon("check"), "Runs on this computer, no GPU needed"],
      ),
    )
  }

  async function make() {
    const need = missing()
    if (need.length) {
      const el = stepEls.get(need[0].id)
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
      el?.classList.remove("shake")
      void el?.offsetWidth
      el?.classList.add("shake")
      return
    }
    const app = appNow()
    try {
      const { jobs } = await api("/api/generate", { method: "POST", body: { app: app.id, values: task.values(v), count: task.count?.(v) ?? 1 } })
      for (const j of jobs) {
        state.jobs.set(j.id, j)
        watched.add(j.id)
      }
      run = { jobIds: jobs.map((j) => j.id), selected: 0, done: false }
      renderStage()
      renderCta()
      if (matchMedia("(max-width: 1080px)").matches) stage.scrollIntoView({ behavior: "smooth", block: "start" })
    } catch (e) {
      fail(e)
    }
  }

  async function enhance(btn, ta, s) {
    enhanceBusy = true
    btn.classList.add("busy")
    const before = ta.value
    try {
      const res = await api("/api/enhance", { method: "POST", body: { tool: s.enhance, prompt: before, imageAssetId: v.image, camera: v.camera, style: v.style } })
      if (!res.prompt) return toast("Write a few words first, or add a photo.", { kind: "info" })
      ta.value = res.prompt
      v[s.id] = res.prompt
      persist()
      renderQuote()
      renderCta()
      toast(res.source === "claude" ? "Improved by Claude" : res.note ?? "Tidied up. Add a Claude key in Settings for smarter rewrites.", {
        kind: res.source === "claude" ? "ok" : "info",
        action: { label: "Undo", run: () => ((ta.value = before), (v[s.id] = before), persist(), renderQuote()) },
      })
    } catch (e) {
      fail(e)
    } finally {
      enhanceBusy = false
      btn.classList.remove("busy")
    }
  }

  async function addFile(file, step) {
    const kind = file.type.split("/")[0]
    const s = step ?? task.steps.find((x) => x.kind === "photo" && x.accept.split(",").includes(kind) && !v[x.id]) ?? task.steps.find((x) => x.kind === "photo" && x.accept.split(",").includes(kind))
    if (!s) return toast(`This task doesn't take ${kind} files.`, { kind: "error" })
    uploads.set(s.id, 0)
    renderSteps(s.id)
    try {
      const asset = await upload(file, (x) => {
        uploads.set(s.id, x)
        const label = stepEls.get(s.id)?.querySelector(".pick.upload span")
        if (label) label.textContent = `${Math.round(x * 100)}%`
      })
      state.assets.set(asset.id, asset)
      uploads.delete(s.id)
      set(s.id, asset.id)
    } catch (e) {
      uploads.delete(s.id)
      renderSteps(s.id)
      fail(e)
    }
  }

  // ------------------------------------------------------------ stage
  const photoUrl = () => {
    const id = v.image ?? v.media
    const a = id && state.assets.get(id)
    return a && a.kind === "image" ? a.thumbUrl ?? a.url : null
  }

  function frameSize(ratio) {
    const r = stage.getBoundingClientRect()
    const maxW = (r.width || 600) * 0.84
    const maxH = (r.height || 520) * 0.84
    let w = maxW
    let hh = w / ratio
    if (hh > maxH) (hh = maxH), (w = hh * ratio)
    return { width: `${Math.round(w)}px`, height: `${Math.round(hh)}px` }
  }

  const ratioFor = () => {
    if ((task.stage === "camera" && v.motion !== "ai") || task.stage === "prompt") {
      const a = state.boot.presets.aspects.find((x) => x.id === (v.aspect ?? "1:1"))
      return a ? a.w / a.h : 1
    }
    const src = state.assets.get(v.image ?? v.media)
    return src?.width && src?.height ? src.width / src.height : 4 / 5
  }

  function renderStage() {
    const bg = h("div.hero-bg", {}, h("div.orb.violet", { style: { width: "60%", height: "60%", left: "-12%", top: "-10%" } }), h("div.orb.cyan", { style: { width: "50%", height: "50%", right: "-10%", bottom: "-12%" } }))
    const jobs = run ? run.jobIds.map((id) => state.jobs.get(id)).filter(Boolean) : []
    const done = jobs.filter((j) => j.status === "done" && j.outputs?.[0] && state.assets.get(j.outputs[0]))
    const pending = jobs.filter((j) => j.status === "running" || j.status === "queued")
    const failed = jobs.filter((j) => j.status === "failed" || j.status === "canceled")
    if (run && !pending.length) run.done = true
    if (run && run.selected >= done.length) run.selected = 0
    const result = done[run?.selected ?? 0] ? state.assets.get(done[run.selected].outputs[0]) : null

    const children = [bg]
    if (result) children.push(resultView(result))
    else children.push(previewView())
    if (pending.length && !result) children.push(progressView(pending, jobs.length))
    if (run?.done && !done.length && failed.length) children.push(failedView(failed[0]))
    if (result) children.push(h("div.stage-tag", {}, result.demo ? h("span.pill.small.mono", {}, "Demo result") : null, appById(result.appId) ? h("span.pill.small.mono", {}, appById(result.appId).label) : null))
    replace(stage, ...children)
    announce(result ? `Ready. Your ${task.output === "video" ? "video" : "image"} is on the stage.` : pending.length ? "Making it now." : run?.done && failed.length ? (failed[0].status === "canceled" ? "Canceled." : friendlyError(failed[0].error).title) : "")
    renderBelow(result, done, pending)
    renderQuote()
  }

  const live = h("p.sr-only", { role: "status", "aria-live": "polite" })
  root.append(live)
  let said = ""
  function announce(text) {
    if (text === said) return
    said = text
    live.textContent = text
  }

  function previewView() {
    const ratio = ratioFor()
    const size = frameSize(ratio)
    const subject = photoUrl()
    switch (task.stage) {
      case "camera": {
        if (!subject) return emptyStage("Add a", "photo", "and pick how the camera moves.", "image")
        const frame = h("div.stage-frame", { style: size }, cameraThumb(cameraById(v.camera ?? "push-in"), subject))
        return frame
      }
      case "prompt": {
        const swatch = STYLE_SWATCH[v.style ?? "none"]
        const tint = v.style && v.style !== "none" ? swatch : "linear-gradient(160deg,#ffffff,#f1ece4)"
        return h(
          "div.stage-frame",
          { style: { ...size, background: tint, display: "grid", placeItems: "center" } },
          h("div.stage-empty", {}, h("p.display-sm", {}, v.prompt?.trim() ? "Ready when " : "Your image ", h("em", {}, v.prompt?.trim() ? "you are" : "appears here")), h("p.small", {}, styleById(v.style)?.label && v.style !== "none" ? `${styleById(v.style).label} look` : "Describe it on the left")),
        )
      }
      case "talk": {
        if (!subject) return emptyStage("Add a", "face", "and a voice to go with it.", "user")
        const audio = v.audio && state.assets.get(v.audio)
        return h(
          "div.stage-frame",
          { style: size },
          h("img", { src: subject, alt: "" }),
          h("div.tv-scene", { style: { pointerEvents: "none" } }, audio ? h("div.wave", {}, ...Array.from({ length: 14 }, (_, i) => h("i", { style: { "--i": i } }))) : null),
        )
      }
      default: {
        const media = state.assets.get(v.image ?? v.media)
        if (!media) return emptyStage("Add a", "photo", task.stage === "enhance" ? "or a video to sharpen." : "to get started.", "image")
        if (media.kind === "video") return h("div.stage-frame", { style: frameSize(media.width / media.height || 9 / 16) }, h("video", { src: media.url, muted: true, loop: true, autoplay: true, playsinline: true }))
        return h(`div.stage-frame${task.stage === "cutout" ? ".contain" : ""}`, { style: size }, h("img", { src: media.url, alt: "" }))
      }
    }
  }

  function emptyStage(lead, accent, tail, ico) {
    return h("div.stage-empty", {}, h("div.ghost-frame", { style: { width: "120px", height: "150px" } }, icon(ico)), h("p.display-sm", {}, `${lead} `, h("em", {}, accent), ` ${tail}`))
  }

  function progressView(pending, total) {
    const p = pending.reduce((a, j) => a + (j.progress ?? 0), 0) / pending.length
    const lead = pending[0]
    const elapsed = lead.startedAt ? (Date.now() - lead.startedAt) / 1000 : 0
    const eta = lead.status === "running" && lead.estimate ? Math.max(0, lead.estimate - elapsed) : null
    return h(
      "div.stage-progress",
      {},
      ring(p, lead.status === "queued" || p === 0),
      h("p.big", {}, lead.status === "queued" ? "In the queue" : lead.message || "Making it"),
      h("p.meta", {}, [total > 1 ? `${total - pending.length} of ${total} done` : null, p ? `${Math.round(p * 100)}%` : null, eta && p < 0.95 ? `~${fmtSeconds(eta)} left` : null].filter(Boolean).join(" · ") || "Starting"),
      h("button.btn.ghost.small", { type: "button", onclick: () => pending.forEach((j) => api(`/api/jobs/${j.id}/cancel`, { method: "POST" }).catch(fail)) }, "Cancel"),
    )
  }

  function failedView(job) {
    const why = job.status === "canceled" ? { title: "Canceled", advice: "Nothing was made. Change anything you like and make it again." } : friendlyError(job.error)
    return h(
      "div.stage-progress",
      {},
      h("p.big", {}, why.title),
      h("p.small.muted", { style: { maxWidth: "40ch" } }, why.advice),
      job.error && job.status !== "canceled" ? h("details.err-details", {}, h("summary", {}, "Details"), h("p", {}, job.error)) : null,
      h("div.row", {}, h("button.btn.small", { type: "button", onclick: make }, icon("refresh"), "Try again"), why.settings ? h("a.btn.ghost.small", { href: "#/settings" }, "Open Settings") : null),
    )
  }

  function resultView(asset) {
    const size = frameSize(asset.width && asset.height ? asset.width / asset.height : ratioFor())
    const src = state.assets.get(v.image ?? v.media)
    if ((task.stage === "compare" || task.stage === "cutout" || (task.stage === "enhance" && asset.kind === "image") || task.stage === "photo") && src?.kind === "image" && asset.kind === "image") {
      return h(`div.stage-frame${task.stage === "cutout" ? ".checker" : ""}`, { style: size }, compare(src.url, asset.url, task.stage === "cutout"))
    }
    if (asset.kind === "video") return h("div.stage-frame", { style: size }, h("video", { src: asset.url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true }))
    return h("div.stage-frame", { style: { ...size, cursor: "zoom-in" }, onclick: () => openLightbox(asset.id, resultIds()) }, h("img", { src: asset.url, alt: asset.prompt || "" }))
  }

  const resultIds = () => (run ? run.jobIds.map((id) => state.jobs.get(id)?.outputs?.[0]).filter((id) => id && state.assets.get(id)) : [])

  function compare(before, after, contain) {
    const el = h(`div.compare${contain ? ".contain" : ""}`, { role: "slider", "aria-label": "Before and after", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 50, tabindex: "0" })
    el.append(h("img", { src: before, alt: "Before" }), h("img.after", { src: after, alt: "After" }), h("span.handle"), h("span.lbl.l", {}, "Before"), h("span.lbl.r", {}, "After"))
    const setCut = (pct) => {
      const c = Math.max(0, Math.min(100, pct))
      el.style.setProperty("--cut", `${c}%`)
      el.setAttribute("aria-valuenow", Math.round(c))
    }
    const fromEvent = (e) => {
      const r = el.getBoundingClientRect()
      setCut(((e.clientX - r.left) / r.width) * 100)
    }
    el.addEventListener("pointerdown", (e) => (el.setPointerCapture(e.pointerId), fromEvent(e)))
    el.addEventListener("pointermove", (e) => e.buttons && fromEvent(e))
    el.addEventListener("keydown", (e) => {
      const now = Number(el.getAttribute("aria-valuenow"))
      if (e.key === "ArrowLeft") setCut(now - 5)
      if (e.key === "ArrowRight") setCut(now + 5)
    })
    // A gentle sweep so people notice it's a slider.
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      let t = 0
      const id = setInterval(() => {
        t += 1
        setCut(50 + Math.sin(t / 7) * 22)
        if (t > 44) (clearInterval(id), setCut(50))
      }, 30)
    }
    return el
  }

  let quoteEl = null
  function renderQuote() {
    quoteEl?.remove()
    quoteEl = null
    const text = String(v.prompt ?? "").trim()
    if (!text || task.stage === "prompt" || (run && !run.done)) return
    if (run?.done && resultIds().length) return
    quoteEl = h("p.stage-quote", {}, `“${short(text, 110)}”`)
    stage.append(quoteEl)
  }

  function renderBelow(result, done, pending) {
    const parts = []
    if (done.length > 1 || (done.length && pending.length)) {
      parts.push(
        h(
          "div.variants",
          {},
          ...done.map((j, i) => {
            const a = state.assets.get(j.outputs[0])
            return h(`button.variant${i === run.selected ? ".selected" : ""}`, { type: "button", "aria-label": `Option ${i + 1}`, onclick: () => ((run.selected = i), renderStage()) }, a.kind === "video" ? h("video", { src: a.url, muted: true }) : h("img", { src: a.thumbUrl ?? a.url, alt: "" }))
          }),
          ...pending.map((j) => h("span.variant.pending", {}, ring(j.progress ?? 0, j.status === "queued"))),
        ),
      )
    }
    if (result) {
      parts.push(
        h(
          "div.stage-actions",
          {},
          h("button.btn.primary", { type: "button", onclick: () => download(result) }, icon("download"), result.kind === "video" ? "Download video" : "Download"),
          h("button.btn", { type: "button", onclick: () => openLightbox(result.id, resultIds()) }, icon("maximize"), "Open"),
          h("span.spacer"),
          h("button.btn.ghost.small", { type: "button", onclick: () => ((run = null), renderStage(), renderCta()) }, "Back to preview"),
        ),
      )
      const next = nextSteps(result)
      if (next.length)
        parts.push(
          h(
            "div.next-steps",
            {},
            h("h3", {}, "Keep going"),
            h("div.next-row", {}, ...next.map((n) => h("button.next", { type: "button", onclick: n.run }, h("span.ico", {}, icon(n.icon)), n.label))),
          ),
        )
    }
    replace(below, ...parts)
    // Earlier results sit under the whole task, so on a phone the steps come
    // straight after the preview.
    const history = historyFor()
    replace(
      historyEl,
      ...(history.length
        ? [
            h("div.section-head", {}, h("h2", {}, "Made ", h("em.serif-accent", {}, "earlier")), h("a.link", { href: "#/library" }, "All files")),
            h("div.recent-strip", {}, ...history.map((a) => h("button.recent-item", { type: "button", onclick: () => openLightbox(a.id, history.map((x) => x.id)), "aria-label": "Open an earlier result" }, a.kind === "video" ? h("video", { src: a.url, poster: a.thumbUrl ?? undefined, muted: true, preload: "metadata" }) : h("img", { src: a.thumbUrl ?? a.url, alt: "" })))),
          ]
        : []),
    )
  }

  function nextSteps(asset) {
    const out = []
    if (asset.kind === "image") {
      out.push({ label: "Bring it to life", icon: "film", run: () => openTask("animate", { image: asset.id }) })
      if (taskId !== "change") out.push({ label: "Change something", icon: "wand", run: () => openTask("change", { image: asset.id }) })
      if (taskId === "cutout") out.push({ label: "Put it in a new scene", icon: "box", run: () => openTask("photo", { image: asset.id }) })
      else out.push({ label: "Remove the background", icon: "scissors", run: () => openTask("cutout", { image: asset.id }) })
      if (taskId !== "enhance") out.push({ label: "Sharpen and enlarge", icon: "maximize", run: () => openTask("enhance", { media: asset.id }) })
    }
    if (asset.kind === "video") {
      if (taskId !== "enhance") out.push({ label: "Sharpen and enlarge", icon: "maximize", run: () => openTask("enhance", { media: asset.id, action: "up2" }) })
      out.push({ label: "Smooth the motion", icon: "zap", run: () => openTask("enhance", { media: asset.id, action: "smooth" }) })
      out.push({ label: "Make an ad instead", icon: "megaphone", run: () => (location.hash = "#/ads") })
    }
    return out
  }

  function historyFor() {
    const apps = new Set(task.steps.length ? [task.app({ ...v, motion: "camera" }), task.app({ ...v, motion: "ai" }), task.app({ ...v, hasText: true }), task.app({ ...v, hasText: false })] : [])
    return [...state.assets.values()]
      .filter((a) => apps.has(a.appId) && a.source !== "ad-part")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10)
  }

  // ------------------------------------------------------------ live updates, drop, paste
  const onJob = (j) => {
    if (!run?.jobIds.includes(j.id)) return
    renderStage()
    renderCta()
  }
  const onPaste = (e) => {
    const file = e.clipboardData?.files?.[0]
    if (!file || e.target.closest?.("textarea, input")) return
    e.preventDefault()
    addFile(file)
  }
  const onDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) addFile(file)
  }
  const onPrefill = () => {
    prefill()
    stepEls.forEach((el) => el.remove())
    stepEls.clear()
    renderSteps()
    renderStage()
    renderCta()
  }
  const ro = new ResizeObserver(() => {
    const frame = stage.querySelector(".stage-frame")
    if (!frame) return
    const media = run ? state.assets.get(resultIds()[run.selected]) : null
    Object.assign(frame.style, frameSize(media?.width ? media.width / media.height : ratioFor()))
  })
  ro.observe(stage)
  root.addEventListener("dragover", (e) => e.preventDefault())
  root.addEventListener("drop", onDrop)
  document.addEventListener("paste", onPaste)
  window.addEventListener("kino:flow-prefill", onPrefill)
  const offs = [on("job", onJob), on("asset", (a) => (run?.jobIds.some((id) => state.jobs.get(id)?.outputs?.includes(a.id)) ? renderStage() : null)), on("boot", () => (renderCta(), renderStage()))]

  // The Studio can pick up from here when you switch to Advanced.
  viewState.get = () => {
    const app = appNow()
    return app ? { tool: app.tool, appId: app.id, values: task.values(v) } : null
  }

  prefill()
  autofill()
  renderSteps()
  renderCta()
  requestAnimationFrame(() => renderStage())

  return () => {
    offs.forEach((off) => off())
    ro.disconnect()
    document.removeEventListener("paste", onPaste)
    window.removeEventListener("kino:flow-prefill", onPrefill)
  }
}

// ---------------------------------------------------------------- helpers

/** Title words that rise one by one; the last part is the italic accent. */
/** What went wrong, in words a brand owner can act on. The raw message stays available under "Details". */
export function friendlyError(message = "") {
  const m = String(message)
  if (/model file missing|install the custom node|not in list|missing_node_type/i.test(m)) return { title: "The GPU is missing something", advice: "The connected GPU doesn't have a model this needs yet. Settings → Save and test lists what to install.", settings: true }
  if (/out of memory|CUDA|OOM|allocate/i.test(m)) return { title: "The GPU ran out of memory", advice: "Try a shorter length, a smaller format, or fewer variations.", settings: false }
  if (/401|403|unauthori[sz]ed|forbidden|api key|invalid key/i.test(m)) return { title: "The GPU key was turned down", advice: "Check the key in Settings, then try again.", settings: true }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|timed? ?out|502|503|504|unreachable|socket hang up/i.test(m)) return { title: "Couldn't reach the GPU", advice: "Check that your GPU server is running (Settings shows its status), then try again.", settings: true }
  if (/ffmpeg/i.test(m)) return { title: "The video step failed", advice: "This one runs on this computer. Try again; if it repeats, try a different photo.", settings: false }
  return { title: "That didn't work", advice: "Try again. If it keeps failing, the details below say what the engine reported.", settings: true }
}

export function wordsFor([plain, accent], { delay = 0 } = {}) {
  const words = [...plain.split(" ").map((w) => ({ w })), ...accent.split(" ").map((w) => ({ w, em: true }))]
  return h(
    "span.words",
    {},
    ...words.flatMap((x, i) => [
      h("span.word", {}, h("span", { style: { "--d": `${delay + i * 0.06}s` } }, x.em ? h("em", {}, x.w) : x.w)),
      i < words.length - 1 ? " " : null,
    ]),
  )
}

const short = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
