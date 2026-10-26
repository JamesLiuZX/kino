// Ad Studio: brand + platform + angle -> scripts you can edit -> a finished,
// captioned ad. Every script is checked against the brand's banned words and
// Meta/TikTok health-ad rules before anything is generated.

import { h, icon, api, toast, fail, confirmDialog, sheet, aspectGlyph, copyText, timeAgo, fmtSeconds, replace, store } from "./ui.mjs"
import { state, on, emit, cameraById, isWeb } from "./state.mjs"
import { openCameraSheet, cameraThumb } from "./pickers.mjs"
import { download } from "./media.mjs"

const STATUS = {
  draft: { label: "Draft", kind: "" },
  making: { label: "Making shots", kind: "busy" },
  rendering: { label: "Editing", kind: "busy" },
  done: { label: "Ready", kind: "ok" },
  failed: { label: "Needs attention", kind: "bad" },
}

export function mountAds(root) {
  const cfg = state.boot.ads
  const form = store.get("ad-form", { brandId: cfg.brands[0]?.id, platform: "tiktok", language: "zh", angles: ["ritual", "gift"], engine: "instant", notes: "" })
  if (!cfg.brands.some((b) => b.id === form.brandId)) form.brandId = cfg.brands[0]?.id
  let drafts = []
  let draftSource = null
  let writing = false

  const formEl = h("section.ad-form.card")
  const draftsEl = h("section.ad-drafts")
  const listEl = h("section.ad-list")
  root.append(
    h(
      "div.page.ads-page",
      {},
      h("header.page-head", {}, h("div", {}, h("h1", {}, "Ad Studio"), h("p.muted", {}, "Scripts, shots and a finished ad for TikTok and Meta, checked against health-ad rules before anything is made."))),
      h("div.ads-layout", {}, formEl, h("div.ads-main", {}, draftsEl, h("h2.section-title", {}, "Your ads"), listEl)),
    ),
  )

  const save = () => store.set("ad-form", form)
  const brand = () => cfg.brands.find((b) => b.id === form.brandId)
  const productUrl = () => {
    const b = brand()
    const asset = [...state.assets.values()].find((a) => a.brandImage === `${b?.id}:photo`)
    return asset ? asset.thumbUrl ?? asset.url : null
  }

  // ------------------------------------------------------------ form
  function renderForm() {
    const b = brand()
    replace(
      formEl,
      h("h2", {}, "New ad"),
      h(
        "label.field",
        {},
        h("span", {}, "Brand"),
        h(
          "select.input",
          { onchange: (e) => ((form.brandId = e.target.value), save(), renderForm()) },
          ...cfg.brands.map((x) => h("option", { value: x.id, selected: x.id === form.brandId }, x.name)),
        ),
      ),
      b
        ? h(
            "div.brand-card",
            {},
            productUrl() ? h("img", { src: productUrl(), alt: "" }) : h("div.brand-ph", {}, icon("image")),
            h("div.grow", {}, h("strong", {}, b.product?.name?.[form.language] ?? b.name), h("p.muted.small", {}, `${b.offer?.price ?? ""} · ${b.offer?.bundle?.[form.language] ?? ""}`)),
            h("button.icon-btn.ghost.small", { type: "button", "aria-label": "Edit brand", title: "Edit offer, call to action and claims", onclick: () => editBrand(b) }, icon("wand")),
          )
        : h("p.muted", {}, "Add a brand file in brands/ to get started."),
      h("div.field", {}, h("span", {}, "Where it runs"), h("div.platforms", {}, ...cfg.platforms.map((p) => {
        const [w, hh] = p.aspect.split(":").map(Number)
        return h(`button.platform${p.id === form.platform ? ".active" : ""}`, { type: "button", onclick: () => ((form.platform = p.id), save(), renderForm()), title: p.tip }, aspectGlyph(w, hh, 22), h("span", {}, p.label), h("small", {}, p.aspect))
      }))),
      h(
        "div.field",
        {},
        h("span", {}, "Language"),
        h(
          "div.segmented",
          {},
          ...[
            ["zh", "中文"],
            ["en", "English"],
          ].map(([id, label]) => h(`button${form.language === id ? ".active" : ""}`, { type: "button", onclick: () => ((form.language = id), save(), renderForm()) }, label)),
        ),
      ),
      h(
        "div.field",
        {},
        h("span", {}, "Angles ", h("small.muted", {}, "(up to 3, one script each)")),
        h(
          "div.row.wrap",
          {},
          ...Object.entries(cfg.angles).map(([id, a]) => {
            const on = form.angles.includes(id)
            return h(
              `button.chip.toggle${on ? ".on" : ""}`,
              {
                type: "button",
                title: a.hint,
                onclick: () => {
                  form.angles = on ? form.angles.filter((x) => x !== id) : [...form.angles, id].slice(-3)
                  save()
                  renderForm()
                },
              },
              a.label,
            )
          }),
        ),
      ),
      h(
        "div.field",
        {},
        h("span", {}, "How shots are made"),
        h(
          "div.engines",
          {},
          ...Object.entries(cfg.engines).map(([id, e]) =>
            h(`button.engine${id === form.engine ? ".active" : ""}`, { type: "button", onclick: () => ((form.engine = id), save(), renderForm()) }, h("strong", {}, e.label), h("small", {}, e.blurb)),
          ),
        ),
      ),
      h("label.field", {}, h("span", {}, "Notes for the writer ", h("small.muted", {}, "(optional)")), h("textarea.input", { rows: 2, placeholder: "e.g. Mother's Day gift, mention free delivery", oninput: (e) => ((form.notes = e.target.value), save()) }, form.notes)),
      h(
        `button.btn.primary.block${writing ? ".busy" : ""}`,
        { type: "button", disabled: writing || !b || !form.angles.length, onclick: write },
        icon("sparkles"),
        writing ? "Writing…" : `Write ${form.angles.length || ""} script${form.angles.length === 1 ? "" : "s"}`,
      ),
      h("p.muted.small.center", {}, state.boot.claude.available ? "Written by Claude from your brand profile." : "Written from templates. Add a Claude key in Settings for custom scripts."),
    )
  }

  const editBrand = (b) => editBrandSheet(b, { onSaved: () => renderForm() })

  async function write() {
    writing = true
    renderForm()
    try {
      const res = await api("/api/ads/draft", { method: "POST", body: { brandId: form.brandId, platform: form.platform, language: form.language, angles: form.angles, notes: form.notes } })
      drafts = res.briefs
      draftSource = res.source
      renderDrafts()
      draftsEl.scrollIntoView({ behavior: "smooth", block: "start" })
    } catch (e) {
      fail(e)
    } finally {
      writing = false
      renderForm()
    }
  }

  // ------------------------------------------------------------ drafts
  function renderDrafts() {
    if (!drafts.length) return replace(draftsEl)
    replace(
      draftsEl,
      h("div.row.between", {}, h("h2.section-title", {}, `Scripts ${draftSource === "claude" ? "by Claude" : "from templates"}`), h("button.btn.ghost.small", { type: "button", onclick: () => ((drafts = []), renderDrafts()) }, "Clear")),
      h(
        "div.drafts",
        {},
        ...drafts.map((brief, i) =>
          h(
            "article.draft.card",
            {},
            briefEditor(brief, { engine: form.engine, productUrl: productUrl() }),
            h(
              "div.row.end",
              {},
              h("button.btn.ghost", { type: "button", onclick: () => (drafts.splice(i, 1), renderDrafts()) }, "Discard"),
              h("button.btn.primary", { type: "button", onclick: (e) => makeAd(brief, e.currentTarget) }, icon("film"), "Make this ad"),
            ),
          ),
        ),
      ),
    )
  }

  async function makeAd(brief, btn) {
    btn.classList.add("busy")
    try {
      const { issues, ...clean } = brief
      const ad = await api("/api/ads", { method: "POST", body: { brandId: form.brandId, brief: clean, engine: form.engine } })
      state.ads.set(ad.id, ad)
      await startMaking(ad)
      drafts = drafts.filter((d) => d !== brief)
      renderDrafts()
      renderList()
    } catch (e) {
      fail(e)
    } finally {
      btn.classList.remove("busy")
    }
  }

  async function startMaking(ad, acceptWarnings = false) {
    try {
      const updated = await api(`/api/ads/${ad.id}/make`, { method: "POST", body: { acceptWarnings } })
      state.ads.set(updated.id, updated)
      toast("Making your ad. Shots appear below as they finish.", { kind: "ok" })
    } catch (e) {
      if (e.status === 409 && (await confirmDialog(`${e.message}`, { confirm: "Make it anyway", danger: true }))) return startMaking(ad, true)
      if (e.status !== 409) throw e
    }
  }

  // ------------------------------------------------------------ list
  function renderList() {
    const ads = [...state.ads.values()].sort((a, b) => b.createdAt - a.createdAt)
    if (!ads.length) return replace(listEl, h("div.empty-hero.small", {}, h("p.muted", {}, "Ads you make show up here, with downloads for each platform.")))
    replace(listEl, ...ads.map(adCard))
  }

  function adCard(ad) {
    const st = STATUS[ad.status] ?? STATUS.draft
    const out = ad.outputAssetId && state.assets.get(ad.outputAssetId)
    const platform = cfg.platforms.find((p) => p.id === ad.brief.platform)
    const blocking = ad.issues?.filter((i) => i.severity === "block").length ?? 0
    const warns = ad.issues?.filter((i) => i.severity === "warn").length ?? 0
    return h(
      "article.ad-card.card",
      { dataset: { id: ad.id } },
      h("div.ad-preview", {}, out ? player(out, platform) : shotsBoard(ad)),
      h(
        "div.ad-info",
        {},
        h("div.row.wrap", {}, h(`span.pill.${st.kind}`, {}, st.label), h("span.pill", {}, platform?.label ?? ad.brief.platform), h("span.pill", {}, cfg.engines[ad.engine]?.label ?? ad.engine), blocking ? h("span.pill.bad", {}, `${blocking} compliance issue${blocking > 1 ? "s" : ""}`) : warns ? h("span.pill.warn", {}, `${warns} to review`) : h("span.pill.ok", {}, "Compliance clean")),
        h("h3", {}, ad.brief.title),
        h("p.muted.small", {}, `${fmtSeconds(ad.brief.seconds)} · ${ad.brief.language === "zh" ? "中文" : "English"} · ${timeAgo(ad.createdAt)}`),
        ad.error ? h("p.error", {}, ad.error) : null,
        h("p.ad-hook", {}, ad.brief.hook),
        h(
          "div.row.wrap",
          {},
          out ? h("button.btn.primary", { type: "button", onclick: () => download(out) }, icon("download"), `Download ${(out.file?.split(".").pop() || "mp4").toUpperCase()}`) : null,
          ad.brief.postCopy?.primaryText ? h("button.btn", { type: "button", onclick: () => copyText(postText(ad.brief), "Post text copied") }, icon("copy"), "Copy post text") : null,
          ...(out ? adShareButtons(ad) : []),
          out
            ? h(
                "select.input.small",
                {
                  "aria-label": "Also make for another platform",
                  onchange: (e) => {
                    const p = e.target.value
                    e.target.value = ""
                    if (p) api(`/api/ads/${ad.id}/render`, { method: "POST", body: { platform: p } }).then((x) => (state.ads.set(x.id, x), renderList()), fail)
                  },
                },
                h("option", { value: "" }, "Also make for…"),
                ...cfg.platforms.filter((p) => p.id !== ad.brief.platform).map((p) => h("option", { value: p.id }, `${p.label} (${p.aspect})`)),
              )
            : null,
          ad.status === "draft" || ad.status === "failed" ? h("button.btn", { type: "button", onclick: () => startMaking(ad).then(renderList, fail) }, icon("film"), ad.status === "failed" ? "Try again" : "Make") : null,
          ad.status !== "making" && ad.status !== "rendering" ? h("button.btn.ghost", { type: "button", onclick: () => editAd(ad) }, icon("wand"), "Edit script") : null,
          h("button.icon-btn.danger", { type: "button", "aria-label": "Delete ad", onclick: async () => (await confirmDialog("Delete this ad? Its finished videos stay in your library.")) && api(`/api/ads/${ad.id}`, { method: "DELETE" }).then(() => (state.ads.delete(ad.id), renderList()), fail) }, icon("trash")),
        ),
        renderOtherCuts(ad),
      ),
    )
  }

  function renderOtherCuts(ad) {
    const extra = (ad.renders ?? []).filter((r) => r.assetId && r.assetId !== ad.outputAssetId && state.assets.get(r.assetId))
    if (!extra.length) return null
    return h(
      "div.other-cuts",
      {},
      h("p.muted.small", {}, "Other cuts"),
      ...extra.map((r) => h("button.chip.small", { type: "button", onclick: () => download(state.assets.get(r.assetId)) }, icon("download"), cfg.platforms.find((p) => p.id === r.platform)?.label ?? r.platform)),
    )
  }

  function player(asset, platform) {
    let showSafe = store.get("show-safe", false)
    const wrap = h("div.player", { style: { aspectRatio: `${asset.width} / ${asset.height}` } })
    const video = h("video", { src: asset.url, poster: asset.thumbUrl, controls: true, playsinline: true, preload: "metadata" })
    const overlay = h("div.safe-overlay", { "aria-hidden": "true" })
    const s = platform?.safe
    if (s) overlay.append(h("div.safe.top", { style: { height: `${s.top * 100}%` } }), h("div.safe.bottom", { style: { height: `${s.bottom * 100}%` } }), h("div.safe.right", { style: { width: `${s.right * 100}%`, top: `${s.top * 100}%`, bottom: `${s.bottom * 100}%` } }))
    const toggle = h("button.chip.small.safe-toggle", {
      type: "button",
      onclick: () => {
        showSafe = !showSafe
        store.set("show-safe", showSafe)
        wrap.classList.toggle("show-safe", showSafe)
        toggle.classList.toggle("on", showSafe)
      },
      title: "Shade where the app's buttons and captions sit",
    }, icon("eye"), "App UI")
    wrap.classList.toggle("show-safe", showSafe)
    toggle.classList.toggle("on", showSafe)
    wrap.append(video, overlay, toggle)
    return wrap
  }

  function shotsBoard(ad) {
    return h(
      "div.shots-board",
      {},
      ...ad.brief.shots.map((s, i) => {
        const st = ad.shots?.[s.id]
        const job = state.jobs.get(st?.clipJob) ?? state.jobs.get(st?.stillJob)
        const asset = st?.clipAssetId ? state.assets.get(st.clipAssetId) : st?.stillAssetId ? state.assets.get(st.stillAssetId) : null
        const failed = st?.status === "failed" || st?.status === "canceled"
        return h(
          `div.shot-cell${failed ? ".failed" : st?.status === "done" ? ".done" : ""}`,
          {},
          asset ? h("img", { src: asset.thumbUrl ?? asset.url, alt: "" }) : null,
          h("span.shot-n", {}, i + 1),
          !asset && job && job.status !== "done" ? h("div.shot-progress", {}, h("i", { style: { width: `${Math.round((job.progress ?? 0) * 100)}%` } })) : null,
          failed ? h("button.chip.small", { type: "button", onclick: () => api(`/api/ads/${ad.id}/shots/${s.id}/retry`, { method: "POST" }).then((x) => (state.ads.set(x.id, x), renderList()), fail) }, icon("refresh"), "Retry") : null,
        )
      }),
    )
  }

  function editAd(ad) {
    const brief = structuredClone(ad.brief)
    const s = sheet(
      "Edit script",
      h(
        "div",
        {},
        briefEditor(brief, { engine: ad.engine, productUrl: productUrl(), issues: ad.issues }),
        h(
          "div.row.end",
          {},
          h("button.btn.ghost", { type: "button", onclick: () => s.close() }, "Cancel"),
          h(
            "button.btn.primary",
            {
              type: "button",
              onclick: async () => {
                try {
                  const updated = await api(`/api/ads/${ad.id}`, { method: "PUT", body: { brief } })
                  state.ads.set(updated.id, updated)
                  s.close()
                  renderList()
                  toast("Saved. Changed shots will be made again when you press Make.", { kind: "ok" })
                } catch (e) {
                  fail(e)
                }
              },
            },
            "Save",
          ),
        ),
      ),
      { wide: true },
    )
  }

  const offs = [
    on("ad", () => renderList()),
    on("ad-removed", () => renderList()),
    on("job", (j) => {
      if (j.adId) {
        const card = listEl.querySelector(`[data-id="${j.adId}"] .shots-board`)
        const ad = state.ads.get(j.adId)
        if (card && ad) card.replaceWith(shotsBoard(ad))
      }
    }),
    on("asset", (a) => {
      if (a.brandImage) renderForm()
      // A finished cut can arrive after the ad's own update.
      if (a.adId && a.source === "ad") renderList()
    }),
  ]
  renderForm()
  renderDrafts()
  renderList()
  return () => offs.forEach((off) => off())
}

export function editBrandSheet(b, { onSaved } = {}) {
const cfg = state.boot.ads
  const two = (label, obj = {}, help) => {
    const zh = h("input.input", { value: obj.zh ?? "", placeholder: "中文" })
    const en = h("input.input", { value: obj.en ?? "", placeholder: "English" })
    return { el: h("div.field", {}, h("span", {}, label), zh, en, help ? h("small.muted", {}, help) : null), get: () => ({ ...obj, zh: zh.value.trim(), en: en.value.trim() }) }
  }
  const lines = (label, list = [], help) => {
    const ta = h("textarea.input", { rows: 4 })
    ta.value = list.join("\n")
    return { el: h("label.field", {}, h("span", {}, label), ta, help ? h("small.muted", {}, help) : null), get: () => ta.value.split("\n").map((s) => s.trim()).filter(Boolean) }
  }
  const price = h("input.input", { value: b.offer?.price ?? "" })
  const original = h("input.input", { value: b.offer?.originalPrice ?? "" })
  const bundle = two("Offer", b.offer?.bundle)
  const guarantee = two("Guarantee", b.offer?.guarantee)
  const cta = two("Call to action (end card)", b.cta, "e.g. WhatsApp 8xxx xxxx 订购. Saved on this machine only.")
  const claimsZh = lines("Approved claims, 中文 (one per line)", b.claims?.approved?.zh)
  const claimsEn = lines("Approved claims, English (one per line)", b.claims?.approved?.en, "Ads may use these word for word. Anything else that sounds like an effect gets flagged.")
  const banned = lines("Banned words (one per line, any language)", [...(b.banned?.zh ?? []), ...(b.banned?.en ?? [])])
  const s = sheet(
    `Edit ${b.name}`,
    h(
      "div.brand-edit",
      {},
      h("div.row", {}, h("label.field.grow", {}, h("span", {}, "Price"), price), h("label.field.grow", {}, h("span", {}, "Was"), original)),
      bundle.el,
      guarantee.el,
      cta.el,
      claimsZh.el,
      claimsEn.el,
      banned.el,
      h(
        "div.row.end",
        {},
        h("button.btn.ghost", { type: "button", onclick: () => s.close() }, "Cancel"),
        h(
          "button.btn.primary",
          {
            type: "button",
            onclick: async () => {
              const words = banned.get()
              try {
                const saved = await api(`/api/brands/${b.id}`, {
                  method: "PUT",
                  body: {
                    offer: { ...b.offer, price: price.value.trim(), originalPrice: original.value.trim(), bundle: bundle.get(), guarantee: guarantee.get() },
                    cta: cta.get(),
                    claims: { ...b.claims, approved: { zh: claimsZh.get(), en: claimsEn.get() } },
                    banned: { zh: words.filter((w) => /[㐀-鿿]/.test(w)), en: words.filter((w) => !/[㐀-鿿]/.test(w)) },
                  },
                })
                cfg.brands = cfg.brands.map((x) => (x.id === saved.id ? saved : x))
                s.close()
                onSaved?.(saved)
                toast("Brand saved. New scripts will use it.", { kind: "ok" })
              } catch (e) {
                fail(e)
              }
            },
          },
          "Save",
        ),
      ),
    ),
  )
}


export const postText = (brief) => [brief.postCopy.primaryText, brief.postCopy.hashtags?.join(" ")].filter(Boolean).join("\n\n")

/** A finished ad as a draft post: its video, its post text and hashtags, for the platforms it was made for. */
export const adPost = (ad) => ({
  media: [ad.outputAssetId],
  title: ad.brief.title,
  text: ad.brief.postCopy?.primaryText ?? "",
  hashtags: ad.brief.postCopy?.hashtags ?? [],
  platforms: ad.brief.platform === "tiktok" ? ["tiktok"] : ["instagram", "facebook"],
  from: { adId: ad.id },
})

/** Post it, and every size with its words as one zip (the full studio only). */
export const adShareButtons = (ad) =>
  isWeb()
    ? []
    : [
        h("button.btn", { type: "button", title: "Schedule it, or send it to your webhook", onclick: () => emit("new-post", adPost(ad)) }, icon("send"), "Post"),
        h("a.btn.ghost", { href: `/api/ads/${ad.id}/zip`, download: "", title: "Every size made, the post text and the script" }, icon("download"), "All sizes and text"),
      ]

/** Edits a brief in place: hook, shots, end card and post copy. */
export function briefEditor(brief, { engine, productUrl, issues = brief.issues ?? [] }) {
  const el = h("div.brief")
  const issueFor = (field) => issues.filter((i) => i.field === field || i.field.startsWith(`${field}.`))
  const flag = (field) => {
    const list = issueFor(field)
    if (!list.length) return null
    const worst = list.some((i) => i.severity === "block") ? "bad" : "warn"
    return h(`span.flag.${worst}`, { title: list.map((i) => i.message).join("\n") }, icon("alert"))
  }
  const textInput = (obj, key, { placeholder, field, multiline } = {}) => {
    const input = h(multiline ? "textarea.input" : "input.input", { placeholder, rows: multiline ? 2 : undefined, value: multiline ? undefined : obj[key] ?? "" })
    if (multiline) input.value = obj[key] ?? ""
    input.addEventListener("input", () => (obj[key] = input.value))
    return h("div.input-wrap", {}, input, field ? flag(field) : null)
  }
  const total = () => brief.shots.reduce((a, s) => a + Number(s.seconds || 0), 0) + (brief.endCard?.seconds ?? 2.5)
  const blocking = issues.filter((i) => i.severity === "block")
  const warns = issues.filter((i) => i.severity === "warn")

  function render() {
    replace(
      el,
      h(
        "div.brief-head",
        {},
        h("div", {}, h("h3", {}, brief.title), h("p.muted.small", {}, `${state.boot.ads.angles[brief.angle]?.label ?? brief.angle} · ${fmtSeconds(total())} · ${brief.shots.length} shots`)),
        blocking.length ? h("span.pill.bad", {}, icon("alert"), `${blocking.length} likely rejection${blocking.length > 1 ? "s" : ""}`) : warns.length ? h("span.pill.warn", {}, `${warns.length} to review`) : h("span.pill.ok", {}, icon("check"), "Compliance clean"),
      ),
      brief.notes ? h("p.brief-notes", {}, brief.notes) : null,
      h("label.field", {}, h("span", {}, "Hook (first second)"), textInput(brief, "hook", { field: "hook" })),
      h(
        "div.shots",
        {},
        ...brief.shots.map((s, i) =>
          h(
            "div.shot",
            {},
            h("div.shot-top", {}, h("span.shot-index", {}, i + 1), h("span.pill.small", {}, s.role), h("label.secs", {}, h("input.input.small", { type: "number", min: 1.5, max: 6, step: 0.5, value: s.seconds, oninput: (e) => (s.seconds = Number(e.target.value)) }), "s")),
            h(
              "div.segmented.small",
              {},
              h(`button${s.source === "product-photo" ? ".active" : ""}`, { type: "button", onclick: () => ((s.source = "product-photo"), render()) }, "Product photo"),
              h(`button${s.source === "generate" ? ".active" : ""}`, { type: "button", onclick: () => ((s.source = "generate"), render()) }, "New scene"),
            ),
            h(
              "button.chip.cam-chip",
              { type: "button", onclick: () => openCameraSheet({ current: s.camera, subject: s.source === "product-photo" ? productUrl : null, onPick: (x) => ((s.camera = x), render()) }) },
              cameraThumb(cameraById(s.camera), s.source === "product-photo" ? productUrl : null, "mini"),
              cameraById(s.camera)?.label ?? s.camera,
            ),
            h("label.field.compact", {}, h("span", {}, "Caption"), textInput(s, "caption", { field: `shots.${i}.caption` })),
            h("details", {}, h("summary", {}, s.source === "generate" ? "Scene description" : "Motion and light"), textInput(s, "visual", { field: `shots.${i}.visual`, multiline: true })),
            engine === "pro" ? h("label.field.compact", {}, h("span", {}, "Voice line"), textInput(s, "voiceover", { field: `shots.${i}.voiceover`, placeholder: "Optional" })) : null,
          ),
        ),
      ),
      h(
        "div.endcard-edit",
        {},
        h("h4", {}, "End card"),
        h("label.field.compact", {}, h("span", {}, "Headline"), textInput(brief.endCard, "headline", { field: "endCard.headline" })),
        h("label.field.compact", {}, h("span", {}, "Offer"), textInput(brief.endCard, "offer", { field: "endCard.offer" })),
        h("label.field.compact", {}, h("span", {}, "Call to action"), textInput(brief.endCard, "cta", { field: "endCard.cta" })),
      ),
      h(
        "details.postcopy",
        {},
        h("summary", {}, "Post text and hashtags"),
        h("label.field.compact", {}, h("span", {}, "Primary text"), textInput(brief.postCopy, "primaryText", { field: "postCopy.primaryText", multiline: true })),
        h("label.field.compact", {}, h("span", {}, "Headline"), textInput(brief.postCopy, "headline", { field: "postCopy.headline" })),
        h("p.muted.small", {}, (brief.postCopy.hashtags ?? []).join(" ")),
      ),
      issues.length
        ? h(
            "ul.issues",
            {},
            ...issues.map((i) => h(`li.${i.severity === "block" ? "bad" : "warn"}`, {}, icon("alert"), h("span", {}, h("strong", {}, fieldLabel(i.field)), " ", i.message))),
          )
        : null,
    )
  }
  render()
  return el
}

function fieldLabel(field) {
  const m = /^shots\.(\d+)\.(\w+)/.exec(field)
  if (m) return `Shot ${Number(m[1]) + 1} ${m[2] === "voiceover" ? "voice" : m[2]}:`
  return `${field.replace("endCard.", "End card ").replace("postCopy.", "Post ").replace("hook", "Hook")}:`
}
