// Simple mode's start screen: "What will you make today?", one card per task
// with a small live preview made from your own product photo, and the latest
// results to pick up from.

import { h, icon, replace } from "./ui.mjs"
import { state, on, cameraById, isDemo, isWeb, setMode } from "./state.mjs"
import { cameraThumb } from "./pickers.mjs"
import { openLightbox, actionsFor } from "./media.mjs"
import { wordsFor } from "./flow.mjs"

export function mountHome(root) {
  const hero = h("section.hero.grain")
  const tasksEl = h("div.tasks")
  const recentEl = h("section.recent")
  root.append(h("div.home", {}, hero, recentEl))

  const brandImg = (kind) => {
    const a = [...state.assets.values()].find((x) => x.source === "brand" && x.brandImage?.endsWith(`:${kind}`))
    return a ? a.url : null
  }

  function renderHero() {
    const p = state.boot.provider
    const status = isWeb() ? "Web demo · runs in your browser, nothing to install" : p.id === "mock" ? "Demo mode · try anything, nothing to set up" : `Connected · ${p.id === "runpod" ? "RunPod" : "ComfyUI"}`
    replace(
      hero,
      h(
        "div.hero-bg",
        {},
        h("div.grid-lines"),
        h("div.orb.violet", { style: { width: "42rem", height: "42rem", left: "-14rem", top: "-12rem" } }),
        h("div.orb.cyan", { style: { width: "36rem", height: "36rem", right: "-10rem", top: "6rem" } }),
        h("div.orb.warm", { style: { width: "30rem", height: "30rem", left: "30%", bottom: "-18rem" } }),
        h("div.spotlight"),
      ),
      h(
        "div.hero-inner",
        {},
        h("p.eyebrow.rise", { style: { "--d": "0s" } }, h(`span.dot.${p.id === "mock" ? "warn" : "ok"}.live`), status),
        h("h1.display", {}, wordsFor(["What will you", "make"], { delay: 0.05 }), h("span.word", {}, h("span", { style: { "--d": "0.32s" } }, " today?"))),
        h("p.lede.rise", { style: { "--d": "0.35s" } }, "Pick a task. Kino chooses the model, writes the prompt and does the editing. ", h("strong", {}, "You choose the photo, the moment and the look.")),
      ),
      tasksEl,
    )
    renderTasks()
  }

  function card({ id, href, onclick, featured, title, blurb, visual, meta, d }) {
    return h(
      `a.task.rise${featured ? ".featured" : ""}`,
      { href: href ?? "#", onclick, style: { "--d": `${d}s` }, dataset: { task: id }, "aria-label": `${title.join(" ")}: ${blurb}` },
      h("div.task-visual", {}, visual),
      h(
        "div.task-body",
        {},
        h("h2.task-title", {}, h("span", {}, title[0], " ", h("em", {}, title[1])), icon("arrow-right")),
        h("p.task-blurb", {}, blurb),
        meta ? h("div.task-meta", {}, ...meta.map((m) => h(`span.pill.small${m.kind ? `.${m.kind}` : ""}`, {}, m.label))) : null,
      ),
    )
  }

  function renderTasks() {
    const photo = brandImg("photo")
    const cutout = brandImg("cutout")
    const brand = state.boot.ads.brands[0]
    const claims = brand?.claims?.approved?.zh?.slice(0, 2) ?? []
    const offer = brand?.offer ? `${brand.offer.price ?? ""} · ${brand.offer.bundle?.zh ?? ""}` : ""
    const captions = [...claims, offer].filter(Boolean).slice(0, 3)

    const product = (src, cls = "product") => (src ? h(`img.${cls}`, { src, alt: "" }) : h("div", {}, icon("box")))

    const adVisual = h(
      "div.tv-scene.dusk",
      {},
      h(
        "div.tv-phone",
        {},
        h(
          "div.screen",
          {},
          photo ? cameraThumb(cameraById("push-in"), photo) : null,
          ...captions.map((c, i) => h("span.cap", { style: { "--i": i } }, c)),
          h("div.ui", {}, h("i"), h("i"), h("i")),
        ),
      ),
      h(
        "div.tv-ad-side",
        {},
        h("span.line", { style: { "--d": "0.5s" } }, icon("sparkles"), "Script written"),
        h("span.line.ok", { style: { "--d": "0.75s" } }, icon("shield"), "Ready for Meta & TikTok review"),
        h("span.line", { style: { "--d": "1s" } }, icon("film"), "Captions and end card"),
      ),
    )
    const animateVisual = h("div.tv-scene.paper", {}, photo ? cameraThumb(cameraById("orbit"), photo) : product(null))
    if (animateVisual.firstChild?.classList?.contains("cam-thumb")) Object.assign(animateVisual.firstChild.style, { position: "absolute", inset: "0", borderRadius: "0" })
    const photoVisual = h(
      "div.tv-scene.paper",
      {},
      h(
        "div.halves",
        {},
        h("div", { style: { background: "#f4f1ec" } }, product(cutout), h("span.tv-label", {}, "Your photo")),
        h("div", { style: { background: "radial-gradient(120% 90% at 30% 20%, #fff1dc, #e7b98d 55%, #9f6b4f)" } }, product(cutout), h("span.tv-label", {}, "New scene")),
      ),
    )
    const changeVisual = h(
      "div.tv-scene.paper",
      {},
      h(
        "div.halves",
        {},
        h("div", {}, photo ? h("img.photo", { src: photo, alt: "" }) : null, h("span.tv-label", {}, "Before")),
        h("div", {}, photo ? h("img.photo", { src: photo, alt: "", style: { filter: "sepia(0.35) saturate(1.35) hue-rotate(-12deg) brightness(1.04)" } }) : null, h("span.tv-label", {}, "Golden hour")),
      ),
    )
    const cutoutVisual = h("div.tv-scene.check", {}, product(cutout))
    const imageVisual = h("div.tv-scene.studio", {}, h("div", { style: { width: "54%", aspectRatio: "1", borderRadius: "18px", background: "linear-gradient(135deg,#f7d46b,#f29a72)", boxShadow: "0 18px 30px -16px rgba(21,19,26,.35)" } }), h("span.type-line", {}, "A cosy HDB living room at golden hour"))
    const talkVisual = h(
      "div.tv-scene.studio",
      {},
      h("div", { style: { width: "86px", height: "86px", borderRadius: "50%", display: "grid", placeItems: "center", background: "rgba(255,255,255,.85)", boxShadow: "0 14px 26px -14px rgba(21,19,26,.35)" } }, icon("user")),
      h("div.wave", {}, ...Array.from({ length: 14 }, (_, i) => h("i", { style: { "--i": i } }))),
    )
    const enhanceVisual = h("div.tv-scene.paper", {}, photo ? h("img.photo", { src: photo, alt: "" }) : null, h("div.sharpen"), h("span.tv-label", { style: { left: "8px" } }, "2× sharper"))
    const studioVisual = h(
      "div.tv-scene.paper",
      {},
      h(
        "div",
        { style: { display: "grid", gap: "9px", width: "68%" } },
        ...[0.72, 0.4, 0.86].map((w) => h("div", { style: { height: "8px", borderRadius: "8px", background: "rgba(21,19,26,.08)", position: "relative" } }, h("i", { style: { position: "absolute", left: 0, top: 0, bottom: 0, width: `${w * 100}%`, borderRadius: "8px", background: "var(--accent-grad)" } }))),
      ),
    )

    replace(
      tasksEl,
      card({ id: "ad", href: "#/ads", featured: true, title: ["A video", "ad"], blurb: "From your product photo to a finished TikTok or Reels ad: script, shots, captions and an end card, checked against Meta and TikTok health-ad rules.", visual: adVisual, meta: [{ label: "About a minute" }, { label: "Free in Quick mode", kind: "ok" }], d: 0.4 }),
      card({ id: "photo", href: "#/make/photo", title: ["Product photo,", "new scene"], blurb: "Your real product, somewhere new. The label stays as it is.", visual: photoVisual, d: 0.46 }),
      card({ id: "animate", href: "#/make/animate", title: ["Bring it", "to life"], blurb: "Twenty camera moves, previewed on your photo.", visual: animateVisual, d: 0.52 }),
      card({ id: "change", href: "#/make/change", title: ["Change a", "photo"], blurb: "New background or new light, with words.", visual: changeVisual, d: 0.58 }),
      card({ id: "cutout", href: "#/make/cutout", title: ["Remove the", "background"], blurb: "A clean cut-out for listings and posts.", visual: cutoutVisual, d: 0.64 }),
      card({ id: "image", href: "#/make/image", title: ["Image from", "words"], blurb: "Anything you can describe, posters included.", visual: imageVisual, d: 0.7 }),
      card({ id: "talk", href: "#/make/talk", title: ["Make it", "talk"], blurb: "A face photo that speaks your recording.", visual: talkVisual, d: 0.76 }),
      card({ id: "enhance", href: "#/make/enhance", title: ["Sharpen and", "enlarge"], blurb: "Upscale photos and video, smooth the motion.", visual: enhanceVisual, d: 0.82 }),
      card({
        id: "studio",
        title: ["Every knob,", "in Advanced"],
        blurb: "Pick the model and every setting yourself, or bring your own ComfyUI workflow.",
        visual: studioVisual,
        d: 0.88,
        onclick: (e) => {
          e.preventDefault()
          setMode("advanced")
          location.hash = "#/studio"
        },
      }),
    )
  }

  function renderRecent() {
    const items = [...state.assets.values()]
      .filter((a) => a.source !== "ad-part" && a.source !== "brand" && a.source !== "upload")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12)
    const ids = items.map((a) => a.id)
    replace(
      recentEl,
      h("div.section-head", {}, h("h2", {}, "Pick up where you ", h("em.serif-accent", {}, "left off")), items.length ? h("a.link", { href: "#/library" }, "Open the library") : null),
      items.length
        ? h(
            "div.recent-strip",
            {},
            ...items.map((a) => {
              const video = a.kind === "video" ? h("video", { src: a.url, poster: a.thumbUrl ?? undefined, muted: true, loop: true, playsinline: true, preload: "metadata" }) : null
              return h(
                "div.recent-item",
                video ? { onmouseenter: () => video.play().catch(() => {}), onmouseleave: () => video.pause() } : {},
                h("button.ri-open", { type: "button", onclick: () => openLightbox(a.id, ids), "aria-label": `Open ${a.prompt || a.name || (a.kind === "video" ? "video" : "photo")}` }, video ?? h("img", { src: a.thumbUrl ?? a.url, alt: "", loading: "lazy" })),
                h("span.ri-meta", {}, h("span.pill.small", {}, a.source === "ad" ? "Ad" : a.kind === "video" ? "Video" : "Photo"), a.demo ? h("span.pill.small", {}, "Demo") : null),
                h("span.ri-actions", {}, ...actionsFor(a).slice(0, 2).map((x) => h("button.ri-act", { type: "button", onclick: x.run }, icon(x.icon), x.label))),
              )
            }),
          )
        : h("p.empty-note", {}, "Things you make appear here, ready to download, animate or turn into an ad."),
      h("p.advanced-hint", {}, icon("sliders"), "Want every model and setting? ", h("button.link", { type: "button", onclick: () => (setMode("advanced"), (location.hash = "#/studio")) }, "Switch to Advanced")),
    )
  }

  // Soft spotlight under the pointer (desktop, motion allowed).
  let frame = 0
  const onMove = (e) => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const r = hero.getBoundingClientRect()
      hero.style.setProperty("--sx", `${((e.clientX - r.left) / r.width) * 100}%`)
      hero.style.setProperty("--sy", `${((e.clientY - r.top) / r.height) * 100}%`)
      const spot = hero.querySelector(".spotlight")
      if (spot) spot.style.setProperty("--sx", hero.style.getPropertyValue("--sx")), spot.style.setProperty("--sy", hero.style.getPropertyValue("--sy"))
    })
  }
  if (matchMedia("(pointer: fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches) hero.addEventListener("pointermove", onMove, { passive: true })

  const offs = [on("asset", renderRecent), on("asset-removed", renderRecent), on("boot", renderHero)]
  renderHero()
  renderRecent()
  return () => {
    offs.forEach((off) => off())
    if (frame) cancelAnimationFrame(frame)
  }
}

export const isDemoMode = isDemo
