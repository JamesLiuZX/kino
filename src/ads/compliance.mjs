// A reviewer's first pass over every brief, before anything is generated or
// posted. It checks the words people will see and hear against the brand's
// banned list and approved claims, and against the platform rules that reject
// most health-adjacent ads: Meta's personal-attributes policy (never assert or
// imply the viewer's health, age or condition) and the shared ban on
// before-and-after comparisons. It is a safety net, not legal advice: the
// person running the ads makes the final call.

const lower = (s) => String(s ?? "").toLowerCase()

const PERSONAL_EN =
  /\b(you|your|you're|you are|are you)\b[^.?!]{0,40}\b(pain|painful|ache|aches|aching|sore|soreness|arthritis|joints?|knees?|back|shoulders?|stiff|stiffness|insomnia|sleepless|diabetes|blood pressure|cholesterol|overweight|weight|old|older|elderly|senior|age|over \d+)\b/i
const PERSONAL_ZH = /(你|您)(的|是否|有没有|是不是|还在|也)?[^。？！?!]{0,12}(痛|疼|酸|关节|膝盖|腰|肩|失眠|风湿|病|老了|年纪|岁)/
const BEFORE_AFTER = /before\s*(and|&|\/|-)\s*after|使用前后|前后对比/i
const SUPERLATIVE_EN = /\b(best|no\.?\s?1|number one|#1|most effective|strongest|fastest)\b/i
const SUPERLATIVE_ZH = /(第一|最好|最有效|最强|最快|顶级)/
const EFFECT_EN = /\b(relief|relieve|relieves|soothe|soothes|soothing|reduce|reduces|eliminate|eliminates|repair|recovery|recover|improve|improves|deep relief)\b/i
const EFFECT_ZH = /(缓解|舒缓|消除|修复|改善|减轻|深层)/

/** Every piece of text in a brief that a viewer can read or hear, with where it lives. */
export function briefTexts(brief) {
  const out = [{ field: "hook", text: brief.hook }]
  brief.shots.forEach((s, i) => {
    out.push({ field: `shots.${i}.caption`, text: s.caption })
    out.push({ field: `shots.${i}.voiceover`, text: s.voiceover })
  })
  out.push({ field: "endCard.headline", text: brief.endCard.headline })
  out.push({ field: "endCard.offer", text: brief.endCard.offer })
  out.push({ field: "endCard.cta", text: brief.endCard.cta })
  out.push({ field: "postCopy.primaryText", text: brief.postCopy.primaryText })
  out.push({ field: "postCopy.headline", text: brief.postCopy.headline })
  return out.filter((t) => t.text)
}

/**
 * Returns [{ severity: "block" | "warn", field, rule, message, text }].
 * "block" means the platform is likely to reject the ad, or the brand forbids it.
 */
export function checkBrief(brief, brand) {
  const issues = []
  // The product's own name ("…Relief Spray", "…舒缓喷雾") isn't a claim in itself.
  const names = [brand?.product?.name, brand?.product?.short]
    .flatMap((n) => [n?.zh, n?.en])
    .filter(Boolean)
    .flatMap((n) => [n, n.replace(brand?.name ?? "", "").trim()])
    .filter(Boolean)
  const approved = [...names, ...(brand?.claims?.approved?.zh ?? []), ...(brand?.claims?.approved?.en ?? [])].sort((a, b) => b.length - a.length)
  const banned = [...(brand?.banned?.en ?? []).map((w) => ({ w, en: true })), ...(brand?.banned?.zh ?? []).map((w) => ({ w, en: false }))]

  for (const { field, text } of briefTexts(brief)) {
    const t = lower(text)
    // Approved claims are allowed even when they contain a watched word.
    const scrubbed = approved.reduce((acc, claim) => acc.split(lower(claim)).join(" "), t)

    for (const { w, en } of banned) {
      const word = lower(w)
      const hit = en ? new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(scrubbed) : scrubbed.includes(word)
      if (hit) issues.push({ severity: "block", field, rule: "banned-word", message: `“${w}” is on the brand's banned list (medical or efficacy language).`, text })
    }
    if (PERSONAL_EN.test(text) || PERSONAL_ZH.test(text)) {
      issues.push({
        severity: "block",
        field,
        rule: "personal-attributes",
        message: "Speaks to the viewer about their body, health or age. Meta rejects this (personal attributes policy); show a person instead of saying “you”.",
        text,
      })
    }
    if (BEFORE_AFTER.test(text)) issues.push({ severity: "block", field, rule: "before-after", message: "Before-and-after comparisons aren't allowed for health-related products on Meta or TikTok.", text })
    if (SUPERLATIVE_EN.test(scrubbed) || SUPERLATIVE_ZH.test(scrubbed)) {
      issues.push({ severity: "warn", field, rule: "superlative", message: "Superlatives need proof you can show if asked (Singapore Code of Advertising Practice).", text })
    }
    if (EFFECT_EN.test(scrubbed) || EFFECT_ZH.test(scrubbed)) {
      issues.push({ severity: "warn", field, rule: "effect-claim", message: "Describes an effect that isn't one of the approved claims. Use an approved claim word for word, or describe the warmth and the ritual.", text })
    }
    for (const c of brand?.claims?.confirm ?? []) {
      if ([c.zh, c.en].filter(Boolean).some((v) => t.includes(lower(v)) || t.includes(lower(v).replace(/[^\d,+]/g, "")))) {
        issues.push({ severity: "warn", field, rule: "confirm-claim", message: c.note ?? "Confirm this claim before running the ad.", text })
      }
    }
  }

  // The words the video model is given matter too: a doctor in a lab coat is a
  // medical claim even with no caption.
  brief.shots.forEach((s, i) => {
    if (/\b(doctor|nurse|hospital|clinic|lab coat|x-ray|injection|pills?)\b/i.test(s.visual)) {
      issues.push({ severity: "warn", field: `shots.${i}.visual`, rule: "medical-setting", message: "Medical settings or people imply a medical claim. Choose a home or everyday setting.", text: s.visual })
    }
    if (s.source === "generate" && /\b(bottle|spray|label|package|box|product)\b/i.test(s.visual)) {
      issues.push({ severity: "warn", field: `shots.${i}.visual`, rule: "invented-product", message: "A generated shot that shows the product will invent a different bottle. Use the product photo for this shot.", text: s.visual })
    }
  })

  if (brief.seconds > 60) issues.push({ severity: "warn", field: "shots", rule: "length", message: "Longer than 60 seconds; most short-video ads do best under 30.", text: "" })
  return dedupe(issues)
}

function dedupe(issues) {
  const seen = new Set()
  return issues.filter((i) => {
    const k = `${i.field}|${i.rule}|${i.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
