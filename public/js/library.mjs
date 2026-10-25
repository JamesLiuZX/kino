// Library: everything you've made or uploaded, searchable, with favourites.

import { h, icon, api, upload, toast, fail, replace } from "./ui.mjs"
import { state, on, isPart } from "./state.mjs"
import { assetCard, masonry } from "./media.mjs"

const FILTERS = [
  { id: "all", label: "All" },
  { id: "image", label: "Images", test: (a) => a.kind === "image" },
  { id: "video", label: "Videos", test: (a) => a.kind === "video" },
  { id: "audio", label: "Audio", test: (a) => a.kind === "audio" },
  { id: "upload", label: "Uploads", test: (a) => a.source === "upload" || a.source === "brand" },
  { id: "ad", label: "Ads", test: (a) => a.source === "ad" },
  { id: "fav", label: "Favourites", test: (a) => a.favorite },
]

export function mountLibrary(root) {
  let filter = "all"
  let q = ""
  const tabs = h("div.tabs", { role: "tablist" })
  const search = h("input.input.search", { type: "search", placeholder: "Search prompts and names", "aria-label": "Search" })
  const fileInput = h("input", { type: "file", multiple: true, accept: "image/*,video/*,audio/*", hidden: true, onchange: (e) => uploadAll([...e.target.files]) })
  const grid = h("div.grid")
  const empty = h("div.empty-hero.small")
  root.append(
    h(
      "div.page",
      {},
      h("header.page-head", {}, h("div", {}, h("h1", {}, "Library"), h("p.muted", {}, "Everything you've made and uploaded.")), h("div.row", {}, search, h("button.btn", { onclick: () => fileInput.click() }, icon("upload"), "Upload"), fileInput)),
      tabs,
      grid,
      empty,
    ),
  )
  const grid$ = masonry(grid)
  search.addEventListener("input", () => {
    q = search.value.trim().toLowerCase()
    render()
  })

  const visible = () => {
    const f = FILTERS.find((x) => x.id === filter)
    return [...state.assets.values()]
      .filter((a) => !isPart(a))
      .filter((a) => !f.test || f.test(a))
      .filter((a) => !q || `${a.prompt ?? ""} ${a.name ?? ""} ${a.model ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  function render() {
    replace(tabs, ...FILTERS.map((f) => h(`button.tab${f.id === filter ? ".active" : ""}`, { role: "tab", "aria-selected": f.id === filter ? "true" : "false", onclick: () => ((filter = f.id), render()) }, f.label)))
    const list = visible()
    const ids = list.map((a) => a.id)
    grid.replaceChildren(...list.map((a) => assetCard(a, { list: () => ids, badge: a.source === "upload" ? "Upload" : a.source === "ad" ? "Ad" : null })))
    grid$.layout()
    empty.hidden = list.length > 0
    replace(empty, h("h2", {}, q ? "Nothing matches that search" : "Nothing here yet"), h("p.muted", {}, q ? "Try other words." : "Drop files anywhere on this page, or make something on Create."))
  }

  async function uploadAll(files) {
    for (const f of files) {
      const close = toast(`Uploading ${f.name}…`, { timeout: 0 })
      try {
        const a = await upload(f)
        state.assets.set(a.id, a)
      } catch (e) {
        fail(e)
      } finally {
        close()
      }
    }
    render()
  }

  root.addEventListener("dragover", (e) => e.preventDefault())
  root.addEventListener("drop", (e) => {
    e.preventDefault()
    const files = [...(e.dataTransfer?.files ?? [])]
    if (files.length) uploadAll(files)
  })

  const offs = [on("asset", render), on("asset-removed", render)]
  render()
  return () => {
    offs.forEach((off) => off())
    grid$.disconnect()
  }
}
