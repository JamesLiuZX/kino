// The visual pickers behind the composer's chips: camera moves (animated
// previews on your own photo), looks, aspect ratios, sound and duration.

import { h, icon, popover, closePopover, sheet, aspectGlyph } from "./ui.mjs"
import { state } from "./state.mjs"

// A small illustrated scene, so camera previews move something even before
// you've added a photo.
const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#191b38"/><stop offset=".42" stop-color="#6d3a5f"/><stop offset=".72" stop-color="#ee8a4c"/><stop offset="1" stop-color="#ffd47e"/></linearGradient><radialGradient id="g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff5d6"/><stop offset=".55" stop-color="#ffd47e" stop-opacity=".9"/><stop offset="1" stop-color="#ffd47e" stop-opacity="0"/></radialGradient><linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0a160"/><stop offset="1" stop-color="#231b38"/></linearGradient></defs><rect width="400" height="500" fill="url(#s)"/><circle cx="252" cy="250" r="96" fill="url(#g)"/><circle cx="252" cy="250" r="32" fill="#fff2c9"/><path d="M0 300 70 228 122 270 192 186 262 262 312 222 400 288V345H0Z" fill="#4a2a4e"/><path d="M0 322 62 284 132 310 204 268 284 316 344 290 400 318V352H0Z" fill="#2c2040"/><rect y="345" width="400" height="155" fill="url(#l)"/><g fill="#fff2c9" opacity=".75"><rect x="222" y="356" width="62" height="4" rx="2"/><rect x="232" y="372" width="42" height="3" rx="1.5"/><rect x="240" y="386" width="26" height="3" rx="1.5"/></g><g fill="#140e22"><ellipse cx="124" cy="420" rx="70" ry="16"/><path d="M112 418c1-26 6-44 14-50 8 6 12 24 13 50z"/><circle cx="126" cy="356" r="9"/></g></svg>`
export const SCENE_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SCENE)}`

export const STYLE_SWATCH = {
  none: "linear-gradient(135deg,#2b2b34,#17171c)",
  cinematic: "linear-gradient(135deg,#0d2a3e 10%,#d9822b)",
  product: "linear-gradient(135deg,#f6f3ec,#c7c0b2)",
  ugc: "linear-gradient(135deg,#f1c27d,#7b3a63)",
  editorial: "linear-gradient(135deg,#0e0e0e 20%,#c6a77e)",
  "warm-home": "linear-gradient(135deg,#f7d46b,#f29a72)",
  ink: "linear-gradient(135deg,#f4f3ee 30%,#3b3b3b)",
  anime: "linear-gradient(135deg,#ff9aa2,#9f8cd6)",
  "3d": "linear-gradient(135deg,#a5c6fd,#d6f0fb)",
  watercolor: "linear-gradient(135deg,#d6fb7f,#8fe0a3)",
  noir: "linear-gradient(135deg,#f0c 0%,#33399a)",
  flat: "linear-gradient(135deg,#ff6070,#ffc371)",
  vintage: "linear-gradient(135deg,#c48f7f,#e3ae7c)",
}

const AUDIO_ICON = { ambient: "waves", upbeat: "music", cinematic: "film", asmr: "waves", "warm-zh": "mic", "warm-en": "mic", silent: "volume-x" }

/** Loop a preset's preview keyframes on an element. */
export function animateCamera(el, preset, { duration = 2600 } = {}) {
  if (!preset?.preview || !el.animate) return null
  return el.animate(preset.preview, {
    duration,
    iterations: Infinity,
    direction: preset.preview.length === 2 ? "alternate" : "normal",
    easing: "ease-in-out",
  })
}

export function cameraThumb(preset, subject, size = "card") {
  const img = h("img", { src: subject || SCENE_URL, alt: "", draggable: "false" })
  const box = h(`div.cam-thumb.${size}`, {}, img)
  requestAnimationFrame(() => animateCamera(img, preset))
  return box
}

export function openCameraSheet({ current, subject, onPick }) {
  const presets = state.boot.presets.camera
  const groups = ["All", ...new Set(presets.map((p) => p.group))]
  let group = "All"
  const grid = h("div.cam-grid")
  const tabs = h("div.tabs.small", { role: "tablist" })
  const render = () => {
    tabs.replaceChildren(...groups.map((g) => h(`button.tab${g === group ? ".active" : ""}`, { role: "tab", "aria-selected": g === group ? "true" : "false", onclick: () => ((group = g), render()) }, g)))
    grid.replaceChildren(
      ...presets
        .filter((p) => group === "All" || p.group === group)
        .map((p) =>
          h(
            `button.cam-card${p.id === current ? ".selected" : ""}`,
            { onclick: () => (onPick(p.id), s.close()), title: p.phrase },
            cameraThumb(p, subject),
            h("span.cam-label", {}, p.label),
            p.id === current ? h("span.cam-check", {}, icon("check")) : null,
          ),
        ),
    )
  }
  const s = sheet("Camera move", h("div.cam-sheet", {}, h("p.muted", {}, subject ? "Previewed on your photo. The AI models get the move as words, the instant mode renders it exactly." : "Add a photo to preview the moves on it."), tabs, grid), { wide: true })
  render()
  return s
}

export function aspectPicker(anchor, { options, current, onPick }) {
  const list = state.boot.presets.aspects.filter((a) => !options || options.includes(a.id))
  popover(
    anchor,
    h(
      "div.aspect-grid",
      {},
      ...list.map((a) =>
        h(
          `button.aspect-opt${a.id === current ? ".selected" : ""}`,
          { onclick: () => (onPick(a.id), closePopover()) },
          h("span.aspect-box", {}, aspectGlyph(a.w, a.h, 28)),
          h("strong", {}, a.label),
          h("small", {}, a.hint),
        ),
      ),
    ),
    { className: "pop-aspect" },
  )
}

export function stylePicker(anchor, { current, onPick }) {
  popover(
    anchor,
    h(
      "div.style-grid",
      {},
      ...state.boot.presets.styles.map((st) =>
        h(
          `button.style-opt${st.id === current ? ".selected" : ""}`,
          { onclick: () => (onPick(st.id), closePopover()), title: st.suffix || "No added style" },
          h("span.style-swatch", { style: { background: STYLE_SWATCH[st.id] ?? STYLE_SWATCH.none } }),
          h("span", {}, st.label),
        ),
      ),
    ),
    { className: "pop-style" },
  )
}

export function audioPicker(anchor, { current, onPick }) {
  popover(
    anchor,
    h(
      "div.menu",
      {},
      ...state.boot.presets.audio.map((a) =>
        h(`button.menu-item${a.id === current ? ".selected" : ""}`, { onclick: () => (onPick(a.id), closePopover()) }, icon(AUDIO_ICON[a.id] ?? "volume"), h("span", {}, h("strong", {}, a.label), h("small", {}, a.phrase))),
      ),
    ),
    { className: "pop-menu" },
  )
}

export function durationPicker(anchor, { min = 2, max = 10, step = 1, current, onPick }) {
  const out = h("strong.dur-value", {}, `${current}s`)
  const input = h("input", { type: "range", min, max, step, value: current, "aria-label": "Duration" })
  input.addEventListener("input", () => (out.textContent = `${input.value}s`))
  input.addEventListener("change", () => onPick(Number(input.value)))
  popover(anchor, h("div.dur", {}, h("div.row.between", {}, h("span.muted", {}, "Length"), out), input, h("div.row.between.muted.small", {}, h("span", {}, `${min}s`), h("span", {}, `${max}s`))), { className: "pop-dur" })
}

export function selectPicker(anchor, { options, current, onPick }) {
  popover(
    anchor,
    h(
      "div.menu",
      {},
      ...Object.entries(options).map(([value, label]) => h(`button.menu-item${value === current ? ".selected" : ""}`, { onclick: () => (onPick(value), closePopover()) }, h("span", {}, String(label)), value === current ? icon("check") : null)),
    ),
    { className: "pop-menu" },
  )
}

export { AUDIO_ICON }
