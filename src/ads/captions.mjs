// Burned-in captions as an ASS subtitle file, rendered by libass inside ffmpeg.
// ASS gives real typography (CJK fonts, boxes, outlines, fades, wrapping) that
// drawtext can't, and keeps every caption inside the platform's safe zone.

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, "0")
const ts = (s) => `${pad(s / 3600, 1)}:${pad((s % 3600) / 60)}:${pad(s % 60)}.${pad((s % 1) * 100)}`

/** "#7F351E" + alpha 0..1 -> ASS "&HAABBGGRR" (ASS alpha: 00 is opaque). */
export function assColor(hex, alpha = 1) {
  const h = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map((i) => h.slice(i, i + 2))
  const a = Math.round((1 - alpha) * 255)
    .toString(16)
    .padStart(2, "0")
  return `&H${a}${b}${g}${r}`.toUpperCase()
}

const escapeText = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/[{}]/g, "")
    .replace(/\r?\n/g, "\\N")

const CJK = /[　-〿㐀-鿿＀-￯]/
const BREAK_AFTER = /[，。！？、；：,.!?;:·]$/

/**
 * Balanced line breaks measured in "units" (one CJK character = 1, a Latin
 * character about half). Latin words and numbers never split ("WhatsApp 8426
 * 1225" stays readable); breaks prefer punctuation near the middle.
 */
export function wrap(text, maxUnits) {
  const s = String(text ?? "").trim()
  // Phone numbers ("8426 1225") are one token; so is any Latin/digit run.
  const tokens = s.match(/\d+(?: \d+)+|[　-〿㐀-鿿＀-￯]|[^\s　-〿㐀-鿿＀-￯]+|\s+/g) ?? []
  const space = (t) => /^\s+$/.test(t)
  const width = (t) => (CJK.test(t) ? 1 : space(t) ? 0.3 : t.length * 0.56)
  const total = tokens.reduce((a, t) => a + width(t), 0)
  if (total <= maxUnits) return s
  // A line may end after token i if a space or punctuation is there, or between
  // two CJK characters. Never inside "买3送1" or "S$39".
  const breakable = (i) => {
    const a = tokens[i]
    const b = tokens[i + 1]
    return !!b && (space(a) || space(b) || BREAK_AFTER.test(a) || (CJK.test(a) && CJK.test(b) && !/^[，。！？、；：]$/.test(b)))
  }
  // Width of the unbreakable run that starts after token i.
  const nextRun = (i) => {
    let w = 0
    for (let k = i + 1; k < tokens.length; k++) {
      w += width(tokens[k])
      if (breakable(k)) break
    }
    return w
  }
  const layout = (count) => {
    const target = total / count
    const lines = []
    let start = 0
    let w = 0
    for (let i = 0; i < tokens.length; i++) {
      w += width(tokens[i])
      if (lines.length === count - 1 || !breakable(i)) continue
      const overflow = w + nextRun(i) > maxUnits
      const balanced = w >= target
      const atPunct = BREAK_AFTER.test(tokens[i]) && w >= target * 0.7
      if (overflow || balanced || atPunct) {
        lines.push({ text: tokens.slice(start, i + 1).join("").trim(), w })
        start = i + 1
        w = 0
      }
    }
    lines.push({ text: tokens.slice(start).join("").trim(), w })
    return lines.filter((l) => l.text)
  }
  const first = Math.ceil(total / maxUnits)
  let best = layout(first)
  for (let count = first + 1; count <= first + 3 && best.some((l) => l.w > maxUnits * 1.04); count++) best = layout(count)
  return best.map((l) => l.text).join("\n")
}

/** Type sizes and the text measure for a frame. */
export function typeScale(W, safe) {
  const base = Math.round(W * 0.076) // ~82px at 1080 wide: readable for older eyes on a phone
  const marginL = Math.round(safe.left * W) + 24
  const marginR = Math.round(safe.right * W) + 24
  const sizes = { caption: base, hook: Math.round(base * 1.25), headline: Math.round(base * 1.05), offer: Math.round(base * 0.85), cta: Math.round(base * 0.72) }
  const maxUnits = Math.max(6, (W - marginL - marginR - 40) / (base * 1.02))
  return { base, marginL, marginR, sizes, unitsFor: (size) => (maxUnits * base) / size }
}

/**
 * The end card, laid out from the bottom of the safe area up: CTA, offer and
 * headline get the room their wrapped lines need, and the product photo takes
 * what is left (up to 42% of the frame).
 */
export function endCardPlan({ width: W, height: H, safe, headline, offer, cta }) {
  const { sizes, unitsFor } = typeScale(W, safe)
  const lines = (text, size) => (text ? wrap(text, unitsFor(size)).split("\n").length : 0)
  const block = (text, size, pad = 0) => (text ? lines(text, size) * size * 1.22 + pad * 2 : 0)
  const gap = H * 0.016
  // Only text must clear the app's UI; the product photo may reach a little
  // into the top band (where the account name sits) to stay big.
  const top = Math.round(Math.max(H * 0.05, safe.top * H - H * 0.06))
  const bottom = Math.round((1 - safe.bottom) * H - H * 0.015)
  const ctaH = block(cta, sizes.cta, 16)
  const offerH = block(offer, sizes.offer)
  const headH = block(headline, sizes.headline)
  const textH = headH + offerH + ctaH + gap * 3
  const productH = Math.max(Math.round(H * 0.2), Math.min(Math.round(H * 0.42), bottom - top - textH)) & ~1
  const y1 = top + productH + gap
  const y2 = y1 + headH + gap * 0.6
  const y3 = y2 + offerH + gap
  return { productTop: top, productH, y1: Math.round(y1), y2: Math.round(y2), y3: Math.round(y3 + 16) }
}

/**
 * timeline: [{start, end, text, kind: "hook" | "caption"}]
 * endCard:  {start, end, headline, offer, cta} (laid out by endCardPlan)
 */
export function buildAss({ width, height, safe, font, colors, timeline, endCard }) {
  const W = width
  const H = height
  const { base, marginL, marginR, unitsFor } = typeScale(W, safe)
  const capV = Math.round(safe.bottom * H) + 36
  const hookV = Math.round(safe.top * H) + 48
  const box = assColor(colors.primary, 0.92)
  const white = assColor("#FFFFFF")
  const ink = assColor(colors.text ?? "#2B1A12")
  const brand = assColor(colors.primary)
  const shadow = assColor("#000000", 0.45)

  const { sizes } = typeScale(W, safe)
  const styles = [
    // name, size, primary, outline(box) colour, back(shadow), bold, borderStyle, outline, shadow, alignment, marginV
    ["Caption", sizes.caption, white, box, shadow, -1, 3, 18, 0, 2, capV],
    ["Hook", sizes.hook, white, box, shadow, -1, 3, 22, 0, 8, hookV],
    ["EndHeadline", sizes.headline, brand, assColor("#FFFFFF", 0), shadow, -1, 1, 0, 0, 8, 0],
    ["EndOffer", sizes.offer, ink, assColor("#FFFFFF", 0), shadow, -1, 1, 0, 0, 8, 0],
    ["EndCta", sizes.cta, white, brand, shadow, -1, 3, 16, 0, 8, 0],
  ]
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles.map(
      ([name, size, primary, outline, back, bold, bs, ol, sh, align, mv]) =>
        `Style: ${name},${font},${size},${primary},${primary},${outline},${back},${bold},0,0,0,100,100,0,0,${bs},${ol},${sh},${align},${marginL},${marginR},${mv},1`,
    ),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ]

  const events = []
  for (const t of timeline) {
    if (!t.text) continue
    const style = t.kind === "hook" ? "Hook" : "Caption"
    const units = unitsFor(t.kind === "hook" ? base * 1.25 : base)
    // A small pop-in: scale from 92% with a quick fade.
    const fx = "{\\fad(120,80)\\fscx92\\fscy92\\t(0,160,\\fscx100\\fscy100)}"
    events.push(`Dialogue: 1,${ts(t.start)},${ts(t.end)},${style},,0,0,0,,${fx}${escapeText(wrap(t.text, units))}`)
  }

  if (endCard) {
    const { start, end, headline, offer, cta } = endCard
    const { y1, y2, y3 } = endCardPlan({ width: W, height: H, safe, headline, offer, cta })
    const { sizes } = typeScale(W, safe)
    const fx = (delay) => `{\\fad(${200 + delay},0)}`
    if (headline) events.push(`Dialogue: 2,${ts(start)},${ts(end)},EndHeadline,,0,0,${y1},,${fx(0)}${escapeText(wrap(headline, unitsFor(sizes.headline)))}`)
    if (offer) events.push(`Dialogue: 2,${ts(start)},${ts(end)},EndOffer,,0,0,${y2},,${fx(150)}${escapeText(wrap(offer, unitsFor(sizes.offer)))}`)
    if (cta) events.push(`Dialogue: 2,${ts(start)},${ts(end)},EndCta,,0,0,${y3},,${fx(300)}${escapeText(wrap(cta, unitsFor(sizes.cta)))}`)
  }
  return `${[...header, ...events].join("\n")}\n`
}
