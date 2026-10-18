// Simple mode's ad maker: product, where it runs, one idea, language and
// quality. Kino writes the script, previews it as a storyboard on a phone
// before anything is made, explains any compliance risk in plain words, then
// makes the ad. You can leave while it works; the activity tray follows it.

import { h, icon, api, toast, fail, store, aspectGlyph, copyText, timeAgo, fmtSeconds, confirmDialog, sheet, replace } from "./ui.mjs"
import { state, on, cameraById, isDemo, isWeb, fullStudioUrl, watched } from "./state.mjs"
import { cameraThumb, SCENE_URL } from "./pickers.mjs"
import { download, ring } from "./media.mjs"
import { briefEditor, editBrandSheet, postText } from "./ads.mjs"
import { wordsFor, friendlyError } from "./flow.mjs"

const QUALITY = [
  { id: "instant", label: "Quick", sub: "Camera moves on your product photo and on generated stills. About a minute.", tag: "Free" },
  { id: "pro", label: "Cinematic", sub: "A video model animates every shot with sound. A few minutes on a GPU.", tag: "GPU" },
]

export function mountAdsSimple(root) {
  const cfg = state.boot.ads
  const form = store.get("ad-simple", { brandId: cfg.brands[0]?.id, platform: "tiktok", angle: "ritual", language: "zh", engine: "instant" })
  if (!cfg.brands.some((b) => b.id === form.brandId)) form.brandId = cfg.brands[0]?.id
  let draft = null // the brief being previewed
  let draftSource = null
  let dirty = false // the script was edited by hand
  let writing = false
  let adId = store.get("ad-simple-current", null) // the ad on stage
  if (adId && !state.ads.get(adId)) adId = null

  const stepsEl = h("div.steps")
  const scriptEl = h("div.steps")
  const ctaEl = h("div.flow-cta")
  const stage = h("div.stage")
  const below = h("div", { style: { display: "grid", gap: "14px" } })
  const historyEl = h("section", { style: { marginTop: "34px" } })

  root.append(
    h(
      "div.flow",
      {},
      h(
        "header.flow-head",
        {},
        h("a.back", { href: "#/home" }, icon("arrow-left"), "All tasks"),
        h("h1", {}, wordsFor(["A video ad, ready", "to post"])),
        h("p.rise", { style: { "--d": "0.25s" } }, "Pick the product, where it runs and the idea. Kino writes the script, checks it against Meta and TikTok's health-ad rules, and makes the video."),
      ),
      h("div.flow-grid", {}, h("div", { style: { display: "grid", gap: "12px", alignContent: "start" } }, stepsEl, scriptEl, ctaEl), h("div.stage-col", {}, stage, below)),
      historyEl,
    ),
  )

  const save = () => store.set("ad-simple", form)
  const brand = () => cfg.brands.find((b) => b.id === form.brandId)
  const platform = (id = form.platform) => cfg.platforms.find((p) => p.id === id)
  const brandAsset = (kind, b = brand()) => [...state.assets.values()].find((a) => a.brandImage === `${b?.id}:${kind}`)
  const ad = () => (adId ? state.ads.get(adId) : null)

  async function set(key, value) {
    if (form[key] === value) return
    // A new product, idea or language needs a new script. Ask before dropping
    // hand edits; the platform only reshapes the frame, so the script stays.
    const rewrites = draft && ["brandId", "angle", "language"].includes(key)
    if (rewrites && dirty && !(await confirmDialog("Start a new script? Your edits to this one will be lost.", { confirm: "New script", danger: false }))) return
    form[key] = value
    save()
    if (rewrites) draft = null
    if (draft && key === "platform") draft.platform = value
    // A finished ad stays in "Your ads" below.
    if (ad() && ["brandId", "platform", "angle", "language", "engine"].includes(key)) setAd(null)
    renderAll()
  }

  function setAd(id) {
    adId = id
    store.set("ad-simple-current", id)
    if (id) watched.add(`ad:${id}`)
  }

  // ------------------------------------------------------------ steps
  function step(n, title, hint, body, { done, active } = {}) {
    return h(
      `section.step${active ? ".active" : ""}${done ? ".done" : ""}`,
      { style: { "--d": `${0.08 + n * 0.06}s` } },
      h("span.step-num", {}, done ? icon("check") : String(n)),
      h("div.step-top", {}, h("h2.step-title", {}, title)),
      hint ? h("p.step-hint", {}, hint) : null,
      body,
    )
  }

  function renderSteps() {
    const b = brand()
    const p = platform()
    const angles = Object.entries(cfg.angles)
    replace(
      stepsEl,
      step(
        1,
        "Your product",
        cfg.brands.length ? null : "Add a brand file in kino/brands/ to get started.",
        h(
          "div.brand-picks",
          {},
          ...cfg.brands.map((x) => {
            const photo = brandAsset("photo", x)
            return h(
              `button.brand-pick${x.id === form.brandId ? ".selected" : ""}`,
              { type: "button", onclick: () => set("brandId", x.id) },
              photo ? h("img", { src: photo.thumbUrl ?? photo.url, alt: "" }) : h("div.brand-ph", {}, icon("box")),
              h("div.grow", {}, h("strong", {}, x.product?.name?.[form.language] ?? x.name), h("small", {}, [x.offer?.price, x.offer?.bundle?.[form.language]].filter(Boolean).join(" · "))),
            )
          }),
          b ? h("button.btn.ghost.small", { type: "button", style: { justifySelf: "start" }, onclick: () => editBrandSheet(b, { onSaved: () => ((draft = null), renderAll()) }) }, icon("wand"), "Edit offer and claims") : null,
        ),
        { done: !!b },
      ),
      step(
        2,
        "Where it runs",
        null,
        h(
          "div",
          { style: { display: "grid", gap: "10px" } },
          h(
            "div.platform-cards",
            {},
            ...cfg.platforms.map((x) => {
              const [w, hh] = x.aspect.split(":").map(Number)
              return h(`button.platform-card${x.id === form.platform ? ".selected" : ""}`, { type: "button", onclick: () => set("platform", x.id) }, aspectGlyph(w, hh, 24), h("strong", {}, x.label), h("small", {}, x.aspect))
            }),
          ),
          p?.tip ? h("p.platform-tip", {}, icon("info"), p.tip) : null,
        ),
        { done: true },
      ),
      step(
        3,
        "The idea",
        "One idea per ad works best. You can make another with a different idea afterwards.",
        h(
          "div.idea-cards",
          {},
          ...angles.map(([id, a]) => h(`button.idea-card${id === form.angle ? ".selected" : ""}`, { type: "button", onclick: () => set("angle", id) }, h("strong", {}, a.label), h("small", {}, cap(a.hint)))),
        ),
        { done: !!form.angle },
      ),
      step(
        4,
        "Language and quality",
        null,
        h(
          "div",
          { style: { display: "grid", gap: "10px" } },
          h(
            "div.segmented",
            {},
            ...[
              ["zh", "中文"],
              ["en", "English"],
            ].map(([id, label]) => h(`button${form.language === id ? ".active" : ""}`, { type: "button", onclick: () => set("language", id) }, label)),
          ),
          h(
            "div.options.two",
            {},
            ...QUALITY.map((q) => h(`button.option${form.engine === q.id ? ".selected" : ""}`, { type: "button", onclick: () => set("engine", q.id) }, h("strong", {}, q.label), h("small", {}, q.sub), h(`span.pill.small.tag${q.tag === "Free" ? ".ok" : ""}`, {}, q.tag))),
          ),
        ),
        { done: true, active: !draft && !ad() },
      ),
    )
  }

  // ------------------------------------------------------------ call to action
  function renderCta() {
    const a = ad()
    const busy = a && (a.status === "making" || a.status === "rendering")
    let main
    if (writing) main = h("button.make-btn.busy", { type: "button", disabled: true }, icon("refresh"), h("span", {}, "Writing your script…"))
    else if (busy) main = h("button.make-btn.busy", { type: "button", disabled: true }, icon("refresh"), h("span", {}, a.status === "rendering" ? "Editing your ad…" : "Making the shots…"))
    else if (draft)
      main = h("button.make-btn", { type: "button", onclick: makeAd }, icon("film"), h("span", {}, "Make this ad"), h("small", {}, form.engine === "instant" ? "Free · about a minute" : "GPU · a few minutes"))
    else main = h("button.make-btn", { type: "button", onclick: write, disabled: !brand() }, icon("sparkles"), h("span", {}, a?.status === "done" ? "Write a new ad" : "Write my ad"), h("small", {}, state.boot.claude.available ? "Written by Claude" : "From approved templates"))
    replace(
      ctaEl,
      main,
      draft && !writing ? h("button.btn.ghost.small", { type: "button", style: { justifySelf: "center" }, onclick: write }, icon("refresh"), "Write another version") : null,
      h("p.cta-note", {}, isWeb() ? [icon("info"), "Web demo: the edit is real, AI scenes are stand-ins. ", h("a.link", { href: fullStudioUrl(), target: "_blank", rel: "noopener" }, "Get the full studio")] : isDemo() ? [icon("info"), "Demo mode: shots are placeholders, the edit is real. ", h("a.link", { href: "#/settings" }, "Connect a GPU")] : [icon("shield"), "Checked against the brand's banned words and health-ad rules"]),
    )
  }

  async function write() {
    writing = true
    setAd(null)
    renderCta()
    renderStage()
    try {
      const res = await api("/api/ads/draft", { method: "POST", body: { brandId: form.brandId, platform: form.platform, language: form.language, angles: [form.angle] } })
      draft = res.briefs[0] ?? null
      draftSource = res.source
      dirty = false
    } catch (e) {
      fail(e)
    } finally {
      writing = false
      renderAll()
    }
    if (draft) scrollToEl(scriptEl)
  }

  async function makeAd() {
    const { issues, ...clean } = draft
    try {
      const created = await api("/api/ads", { method: "POST", body: { brandId: form.brandId, brief: clean, engine: form.engine } })
      state.ads.set(created.id, created)
      setAd(created.id)
      draft = null
      dirty = false
      await startMaking(created)
    } catch (e) {
      fail(e)
    }
    renderAll()
  }

  async function startMaking(a, acceptWarnings = false) {
    try {
      const updated = await api(`/api/ads/${a.id}/make`, { method: "POST", body: { acceptWarnings } })
      state.ads.set(updated.id, updated)
    } catch (e) {
      if (e.status === 409 && (await confirmDialog(`${e.message}`, { confirm: "Make it anyway", danger: true }))) return startMaking(a, true)
      if (e.status !== 409) throw e
    }
  }

  // ------------------------------------------------------------ stage
  function phoneClass(pid = form.platform) {
    const aspect = platform(pid)?.aspect
    return aspect === "4:5" ? ".feed" : aspect === "1:1" ? ".square" : ""
  }

  function renderStage() {
    const bg = h("div.hero-bg", {}, h("div.orb.violet", { style: { width: "60%", height: "60%", left: "-14%", top: "-12%" } }), h("div.orb.warm", { style: { width: "55%", height: "55%", right: "-14%", bottom: "-16%" } }))
    const a = ad()
    let phone
    if (a?.status === "done" && a.outputAssetId && state.assets.get(a.outputAssetId)) phone = finishedPhone(a)
    else if (a && (a.status === "making" || a.status === "rendering")) phone = makingPhone(a)
    else if (a?.status === "failed") phone = failedPhone(a)
    else if (writing) phone = idlePhone("Writing your script…", true)
    else if (draft) phone = storyboard(draft)
    else phone = idlePhone()
    replace(stage, bg, phone)
    renderBelow()
  }

  function idlePhone(text, busy) {
    const photo = brandAsset("photo")
    return h(
      `div.phone${phoneClass()}`,
      {},
      h("span.phone-notch"),
      h(
        "div.phone-screen",
        {},
        photo ? h("div.sb-shot.on", {}, cameraThumb(cameraById("push-in"), photo.thumbUrl ?? photo.url)) : null,
        h("div.sb-shot.on", { style: { background: "transparent" } }, h("span.sb-caption", { style: { opacity: 1, transform: "none" } }, text ?? "Your hook goes here")),
        busy ? h("div.stage-progress", { style: { background: "rgba(250,248,244,.35)" } }, ring(0, true)) : null,
      ),
    )
  }

  let timer = null
  function storyboard(brief) {
    clearTimeout(timer)
    const photo = brandAsset("photo")
    const cutout = brandAsset("cutout")
    const src = photo ? photo.thumbUrl ?? photo.url : null
    const shots = brief.shots.map((s, k) =>
      h(
        `div.sb-shot${s.source === "generate" ? ".scene" : ""}`,
        {},
        cameraThumb(cameraById(s.camera), s.source === "product-photo" && src ? src : SCENE_URL),
        s.source === "generate" ? h("span.pill.small", { style: { position: "absolute", top: "46px", left: "12px", background: "rgba(255,255,255,.9)" } }, "New scene") : null,
        s.source === "generate" && s.visual ? h("span.sb-visual", {}, cap(shortVisual(s.visual))) : null,
        k === 0 ? h("span.sb-hook", {}, brief.hook ?? "") : null,
        h(`span.sb-caption${k === 0 && brief.hook ? ".later" : ""}`, { hidden: k === 0 && !!brief.hook && brief.hook === s.caption }, s.caption),
      ),
    )
    const end = h(
      "div.sb-endcard",
      {},
      cutout ? h("img", { src: cutout.url, alt: "" }) : null,
      h("strong", {}, brief.endCard?.headline ?? ""),
      h("span", {}, brief.endCard?.offer ?? ""),
      brief.endCard?.cta ? h("em", {}, brief.endCard.cta) : null,
    )
    const dots = h("div.sb-dots", {}, ...[...brief.shots, brief.endCard].map(() => h("i")))
    const frames = [...shots, end]
    const durations = [...brief.shots.map((s) => Number(s.seconds) || 2.5), brief.endCard?.seconds ?? 2.5]
    let i = 0
    const show = () => {
      frames.forEach((f, k) => f.classList.toggle("on", k === i))
      ;[...dots.children].forEach((d, k) => {
        d.className = k < i ? "past" : k === i ? "now" : ""
        d.style.setProperty("--dur", `${durations[k]}s`)
      })
      timer = setTimeout(() => {
        i = (i + 1) % frames.length
        if (frames[0].isConnected) show()
      }, durations[i] * 1000)
    }
    const phone = h(`div.phone${phoneClass(brief.platform)}`, {}, h("span.phone-notch"), h("div.phone-screen", {}, ...frames, dots, safeShade(brief.platform)))
    requestAnimationFrame(show)
    return phone
  }

  function safeShade(pid) {
    const s = platform(pid)?.safe
    if (!s) return null
    return h("div.safe-shade", {}, h("i", { style: { top: 0, height: `${s.top * 100}%` } }), h("i", { style: { bottom: 0, height: `${s.bottom * 100}%` } }), h("i", { style: { left: "auto", right: 0, width: `${s.right * 100}%`, top: `${s.top * 100}%`, bottom: `${s.bottom * 100}%` } }))
  }

  function makingPhone(a) {
    const total = a.brief.shots.length
    const doneShots = a.brief.shots.filter((s) => a.shots?.[s.id]?.status === "done").length
    return h(
      `div.phone${phoneClass(a.brief.platform)}`,
      {},
      h("span.phone-notch"),
      h(
        "div.phone-screen",
        { style: { display: "grid", alignContent: "center", gap: "14px", padding: "44px 14px 18px", background: "#f6f2ec" } },
        h(
          "div.making-shots",
          {},
          ...a.brief.shots.map((s, i) => {
            const st = a.shots?.[s.id]
            const job = state.jobs.get(st?.clipJob) ?? state.jobs.get(st?.stillJob)
            const asset = st?.clipAssetId ? state.assets.get(st.clipAssetId) : st?.stillAssetId ? state.assets.get(st.stillAssetId) : null
            return h(
              `div.shot-cell${st?.status === "done" ? ".done" : ""}${st?.status === "failed" ? ".failed" : ""}`,
              {},
              asset ? (asset.kind === "video" ? h("video", { src: asset.url, muted: true, autoplay: true, loop: true, playsinline: true, style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" } }) : h("img", { src: asset.thumbUrl ?? asset.url, alt: "" })) : null,
              h("span.shot-n", {}, i + 1),
              !asset && job ? h("div.shot-progress", {}, h("i", { style: { width: `${Math.round((job.progress ?? 0) * 100)}%` } })) : null,
            )
          }),
        ),
        h("div", { style: { textAlign: "center", display: "grid", gap: "4px" } }, h("p", { style: { font: "400 22px/1.15 var(--font-display)" } }, a.status === "rendering" ? "Editing your ad" : `Shot ${Math.min(total, doneShots + 1)} of ${total}`), h("p.meta", { style: { font: "500 10.5px/1 var(--font-mono)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" } }, a.status === "rendering" ? "Captions, end card, music" : "You can leave this page")),
      ),
    )
  }

  function failedPhone(a) {
    return h(
      `div.phone${phoneClass(a.brief.platform)}`,
      {},
      h("span.phone-notch"),
      h(
        "div.phone-screen",
        { style: { display: "grid", placeContent: "center", gap: "10px", padding: "24px", textAlign: "center", background: "#f6f2ec" } },
        h("p", { style: { font: "400 24px/1.15 var(--font-display)" } }, friendlyError(a.error).title),
        h("p.small.muted", {}, friendlyError(a.error).advice),
        a.error ? h("details.err-details", {}, h("summary", {}, "Details"), h("p", {}, a.error)) : null,
        h("button.btn.small", { type: "button", onclick: () => startMaking(a).then(renderAll, fail) }, icon("refresh"), "Try again"),
      ),
    )
  }

  function finishedPhone(a) {
    const out = state.assets.get(a.outputAssetId)
    const phone = h(`div.phone${phoneClass(a.brief.platform)}`, {}, h("span.phone-notch"), h("div.phone-screen", {}, h("video", { src: out.url, poster: out.thumbUrl ?? undefined, controls: true, autoplay: true, muted: true, loop: true, playsinline: true }), safeShade(a.brief.platform)))
    if (store.get("show-safe", false)) phone.classList.add("show-safe")
    return phone
  }

  // ------------------------------------------------------------ beside the stage
  // Left column shows what you do, right column what you see: the script and
  // the finished ad's actions sit under the steps so the phone never scrolls away.
  function renderBelow() {
    const idle = !draft && !writing && !ad()
    replace(below, idle ? h("p.stage-note", {}, icon("info"), "Press “Write my ad”. The script previews on this phone, captions and end card included, before anything is made.") : null)
  }

  function renderScript() {
    const a = ad()
    if (a?.status === "done" && a.outputAssetId && state.assets.get(a.outputAssetId)) return replace(scriptEl, step(5, "Your ad is ready", null, result(a), { done: true, active: true }))
    if (draft && !writing) return replace(scriptEl, step(5, "Your script", "Change any line; the phone updates as you type.", h("div", { style: { display: "grid", gap: "12px" } }, verdict(draft.issues ?? []), scriptLines(draft)), { active: true }))
    replace(scriptEl)
  }

  function result(a) {
    const out = state.assets.get(a.outputAssetId)
    const others = cfg.platforms.filter((p) => p.id !== a.brief.platform)
    const showSafe = store.get("show-safe", false)
    return h(
      "div",
      { style: { display: "grid", gap: "12px" } },
      h("div.verdict.ok", {}, icon("check"), h("div", {}, h("strong", {}, `“${a.brief.title}”`), `${fmtSeconds(out.duration ?? a.brief.seconds)} · ${platform(a.brief.platform)?.label}. Saved to your library.`)),
      h(
        "div.stage-actions",
        { style: { justifyContent: "flex-start" } },
        h("button.btn.primary", { type: "button", onclick: () => download(out) }, icon("download"), `Download ${(out.file?.split(".").pop() || "mp4").toUpperCase()}`),
        a.brief.postCopy?.primaryText ? h("button.btn", { type: "button", onclick: () => copyText(postText(a.brief), "Post text copied") }, icon("copy"), "Copy post text") : null,
        h(
          `button.chip.toggle${showSafe ? ".on" : ""}`,
          {
            type: "button",
            title: "Shade where the app's buttons and captions sit",
            onclick: () => {
              store.set("show-safe", !showSafe)
              renderStage()
              renderScript()
            },
          },
          icon("eye"),
          "App buttons",
        ),
      ),
      h(
        "div.next-steps",
        {},
        h("h3", {}, "Keep going"),
        h(
          "div.next-row",
          {},
          ...others.map((p) =>
            h(
              "button.next",
              { type: "button", onclick: () => api(`/api/ads/${a.id}/render`, { method: "POST", body: { platform: p.id } }).then((x) => (state.ads.set(x.id, x), toast(`Making the ${p.label} cut…`, { kind: "ok" })), fail) },
              h("span.ico", {}, icon("phone")),
              `Make it for ${p.label}`,
            ),
          ),
          h("button.next", { type: "button", onclick: () => (setAd(null), (draft = null), renderAll(), window.scrollTo({ top: 0, behavior: "smooth" })) }, h("span.ico", {}, icon("plus")), "Start a new ad"),
        ),
        otherCuts(a),
      ),
      a.brief.postCopy?.primaryText ? h("details.post-text", {}, h("summary", {}, "Post text"), h("p", {}, postText(a.brief))) : null,
    )
  }

  function otherCuts(a) {
    const extra = (a.renders ?? []).filter((r) => r.assetId && r.assetId !== a.outputAssetId && state.assets.get(r.assetId))
    if (!extra.length) return null
    return h("div.row.wrap", { style: { marginTop: "4px" } }, h("span.small.muted", {}, "Other cuts:"), ...extra.map((r) => h("button.chip.small", { type: "button", onclick: () => download(state.assets.get(r.assetId)) }, icon("download"), platform(r.platform)?.label ?? r.platform)))
  }

  function verdict(issues) {
    const blocking = issues.filter((i) => i.severity === "block")
    const warns = issues.filter((i) => i.severity === "warn")
    if (!issues.length)
      return h("div.verdict.ok", {}, icon("shield"), h("div", {}, h("strong", {}, "Ready for Meta and TikTok review"), "Checked: banned words, health claims, personal attributes, before-and-after and superlatives."))
    const list = h("ul", {}, ...(blocking.length ? blocking : warns).slice(0, 4).map((i) => h("li", {}, i.message)))
    return blocking.length
      ? h("div.verdict.bad", {}, icon("alert"), h("div", {}, h("strong", {}, `${blocking.length} line${blocking.length > 1 ? "s" : ""} will likely be rejected`), "Rewrite them below, or write another version.", list))
      : h("div.verdict.warn", {}, icon("alert"), h("div", {}, h("strong", {}, `${warns.length} thing${warns.length > 1 ? "s" : ""} to check`), "Fine to make; worth a look first.", list))
  }

  function scriptLines(brief) {
    const line = (n, src, obj, key) => {
      const input = h("input", { value: obj[key] ?? "", "aria-label": `${src} ${n}` })
      input.addEventListener("input", () => {
        obj[key] = input.value
        dirty = true
        refreshCaptions()
      })
      return h("label.script-line", {}, h("span.n", {}, typeof n === "number" ? String(n).padStart(2, "0") : n), input, h("span.src", {}, src))
    }
    return h(
      "div",
      { style: { display: "grid", gap: "8px" } },
      h("div.script", {}, line("H", "Hook", brief, "hook"), ...brief.shots.map((s, i) => line(i + 1, s.source === "product-photo" ? "Product" : "Scene", s, "caption")), line("E", "End card", brief.endCard, "headline")),
      h(
        "div.row.between",
        {},
        h("span.small.muted", {}, `${draftSource === "claude" ? "Written by Claude" : "From approved templates"} · checked again when you press Make`),
        h("button.btn.ghost.small", { type: "button", onclick: () => editAll(brief) }, icon("sliders"), "Every detail"),
      ),
    )
  }

  function refreshCaptions() {
    const caps = stage.querySelectorAll(".sb-caption")
    draft.shots.forEach((s, i) => caps[i] && (caps[i].textContent = s.caption))
    const hook = stage.querySelector(".sb-hook")
    if (hook) hook.textContent = draft.hook ?? ""
    caps[0]?.classList.toggle("later", !!draft.hook)
    caps[0]?.toggleAttribute("hidden", !!draft.hook && draft.hook === draft.shots[0]?.caption)
    const end = stage.querySelector(".sb-endcard strong")
    if (end) end.textContent = draft.endCard?.headline ?? ""
  }

  function editAll(brief) {
    const working = structuredClone(brief)
    const photo = brandAsset("photo")
    const s = sheet(
      "Every detail",
      h(
        "div",
        { style: { display: "grid", gap: "16px" } },
        briefEditor(working, { engine: form.engine, productUrl: photo?.thumbUrl ?? photo?.url, issues: brief.issues ?? [] }),
        h("div.row.end", {}, h("button.btn.ghost", { type: "button", onclick: () => s.close() }, "Cancel"), h("button.btn.primary", { type: "button", onclick: () => ((draft = { ...working, issues: brief.issues }), (dirty = true), s.close(), renderAll()) }, "Use these changes")),
      ),
      { wide: true },
    )
  }

  // ------------------------------------------------------------ history
  function renderHistory() {
    const ads = [...state.ads.values()].sort((a, b) => b.createdAt - a.createdAt)
    if (!ads.length) return replace(historyEl)
    replace(
      historyEl,
      h("div.section-head", {}, h("h2", {}, "Your ", h("em.serif-accent", {}, "ads")), h("a.link", { href: "#/library" }, "All files")),
      h(
        "div.recent-strip",
        { style: { gridAutoColumns: "160px" } },
        ...ads.map((a) => {
          const out = a.outputAssetId && state.assets.get(a.outputAssetId)
          const firstShot = a.brief.shots.map((s) => a.shots?.[s.id]).find((x) => x?.clipAssetId || x?.stillAssetId)
          const thumb = out ?? (firstShot && state.assets.get(firstShot.clipAssetId ?? firstShot.stillAssetId))
          return h(
            `button.recent-item${a.id === adId ? ".selected" : ""}`,
            { type: "button", style: { aspectRatio: "9 / 14", outline: a.id === adId ? "2px solid var(--accent)" : "" }, onclick: () => (setAd(a.id), (draft = null), renderAll(), window.scrollTo({ top: 0, behavior: "smooth" })), title: a.brief.title },
            thumb ? (thumb.kind === "video" ? h("video", { src: thumb.url, poster: thumb.thumbUrl ?? undefined, muted: true, preload: "metadata" }) : h("img", { src: thumb.thumbUrl ?? thumb.url, alt: "" })) : h("div", { style: { display: "grid", placeItems: "center", height: "100%" } }, icon("film")),
            h("span.ri-meta", {}, h(`span.pill.small${a.status === "done" ? ".ok" : a.status === "failed" ? ".bad" : ".busy"}`, {}, a.status === "done" ? "Ready" : a.status === "failed" ? "Needs attention" : "Making"), h("span.pill.small", {}, timeAgo(a.createdAt))),
          )
        }),
      ),
    )
  }

  function renderAll() {
    renderSteps()
    renderScript()
    renderCta()
    renderStage()
    renderHistory()
  }

  const offs = [
    on("ad", (a) => {
      if (a.id === adId) (renderStage(), renderScript(), renderCta())
      renderHistory()
    }),
    on("ad-removed", () => (ad() ? null : setAd(null), renderAll())),
    on("job", (j) => {
      if (j.adId && j.adId === adId) renderStage()
    }),
    on("asset", (a) => {
      if (a.adId && a.adId === adId) (renderStage(), renderScript(), renderHistory())
      if (a.brandImage) renderAll()
    }),
  ]
  if (adId) watched.add(`ad:${adId}`)
  renderAll()
  return () => {
    clearTimeout(timer)
    offs.forEach((off) => off())
  }
}

function scrollToEl(el) {
  const top = el.getBoundingClientRect().top + scrollY - 88
  window.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
// "a grandmother on a sofa in a cosy HDB flat, gently …" -> its first clause.
const shortVisual = (v) => {
  const first = v.split(/[,.;]/)[0].trim()
  return first.length > 80 ? `${first.slice(0, 78).replace(/\s+\S*$/, "")}…` : first
}
