import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkBrief } from "../src/ads/compliance.mjs"
import { buildAss, endCardPlan, wrap } from "../src/ads/captions.mjs"
import { PLATFORMS } from "../src/ads/platforms.mjs"
import { renderAd } from "../src/ads/render.mjs"
import { ANGLES, BRIEF_SCHEMA, normalizeBrief } from "../src/ads/schema.mjs"
import { templateBrief, writeBriefs } from "../src/ads/writer.mjs"
import { hasFfmpeg, probe } from "../src/media/ffmpeg.mjs"
import { renderMotion } from "../src/media/motion.mjs"

const brand = JSON.parse(readFileSync(new URL("../brands/herbalbath.json", import.meta.url), "utf8"))

test("template scripts are compliant by construction, in both languages and every angle", () => {
  for (const language of ["zh", "en"]) {
    for (const angle of Object.keys(ANGLES)) {
      const b = templateBrief({ brand, platform: "tiktok", language, angle })
      assert.deepEqual(checkBrief(b, brand), [], `${language}/${angle}`)
      assert.ok(b.seconds >= 12 && b.seconds <= 25, `${language}/${angle} length ${b.seconds}`)
      assert.ok(b.shots.every((s) => s.caption), `${language}/${angle} every shot has a caption`)
      assert.ok(b.shots.filter((s) => s.source === "generate").every((s) => !/\b(bottle|spray|label|box)\b/i.test(s.visual)), "generated scenes never show the product")
    }
  }
})

test("compliance flags medical words, personal attributes and before/after, but allows approved claims", () => {
  const base = templateBrief({ brand, platform: "reels", language: "en", angle: "ritual" })
  const edit = (fn) => {
    const b = structuredClone(base)
    fn(b)
    return checkBrief(normalizeBrief(b), brand)
  }
  const rules = (issues) => issues.map((i) => `${i.severity}:${i.rule}`)
  assert.ok(rules(edit((b) => (b.hook = "Cures joint pain fast"))).includes("block:banned-word"))
  assert.ok(rules(edit((b) => (b.shots[1].caption = "Is your knee pain back?"))).includes("block:personal-attributes"))
  assert.ok(rules(edit((b) => (b.shots[1].caption = "您的膝盖还在痛吗？"))).includes("block:personal-attributes"))
  assert.ok(rules(edit((b) => (b.shots[2].caption = "治疗关节炎"))).includes("block:banned-word"))
  assert.ok(rules(edit((b) => (b.postCopy.primaryText = "See the before and after!"))).includes("block:before-after"))
  assert.ok(rules(edit((b) => (b.shots[2].caption = "The best spray in Singapore"))).includes("warn:superlative"))
  assert.ok(rules(edit((b) => (b.shots[2].caption = "Soothes deep relief"))).includes("warn:effect-claim"))
  assert.ok(rules(edit((b) => (b.shots[1].visual = "a doctor in a lab coat"))).includes("warn:medical-setting"))
  assert.ok(rules(edit((b) => ((b.shots[1].source = "generate"), (b.shots[1].visual = "a hand holding the spray bottle")))).includes("warn:invented-product"))
  assert.ok(rules(edit((b) => (b.shots[3].caption = "Loved by 15,000+ Singaporeans"))).includes("warn:confirm-claim"))
  // The product's own name and the approved claims pass.
  assert.deepEqual(edit((b) => (b.shots[3].caption = "HerbalBath Myrrh Herbal Energy Oil: Warmth in 10 seconds")), [])
  assert.deepEqual(edit((b) => (b.shots[3].caption = "没药草本能量油 · 10秒感受温热")), [])
})

test("normalizeBrief repairs sloppy input instead of failing", () => {
  const b = normalizeBrief({ shots: [{ seconds: 40, camera: "warp-drive", source: "?" }, { role: "nope" }], postCopy: { hashtags: ["#ok", "two words", "", "##x"] } }, { platform: "feed" })
  assert.equal(b.platform, "feed")
  assert.equal(b.aspect, "4:5")
  assert.equal(b.shots[0].seconds, 6)
  assert.equal(b.shots[0].camera, "push-in")
  assert.equal(b.shots[0].source, "generate")
  assert.equal(b.shots[1].role, "moment")
  assert.deepEqual(b.postCopy.hashtags, ["#ok", "#twowords", "#x"])
})

test("the brief schema is strict enough for structured outputs", () => {
  const walk = (s, path) => {
    if (s.type === "object") {
      assert.equal(s.additionalProperties, false, `${path} closes its properties`)
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${path} requires every property`)
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`)
    }
    if (s.type === "array") walk(s.items, `${path}[]`)
    for (const bad of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"]) assert.equal(s[bad], undefined, `${path} avoids ${bad}`)
  }
  walk(BRIEF_SCHEMA, "brief")
})

test("without Claude the writer falls back to templates", async () => {
  const settings = { get: (k) => ({ anthropicKey: "", anthropicModel: "claude-opus-5-5" })[k] }
  const res = await writeBriefs(settings, { brand, platform: "tiktok", language: "zh", angles: ["gift", "offer", "howto", "ritual"] })
  assert.equal(res.source, "templates")
  assert.equal(res.briefs.length, 3, "at most three variants")
  assert.deepEqual(res.briefs.map((b) => b.angle), ["gift", "offer", "howto"])
})

test("captions wrap at safe points and keep phone numbers and prices whole", () => {
  assert.equal(wrap("忙了一天，给自己一点温暖", 8.6), "忙了一天，\n给自己一点温暖")
  assert.equal(wrap("WhatsApp 8426 1225 订购", 11).split("\n")[0], "WhatsApp 8426 1225")
  assert.ok(!wrap("S$39 · 买3送1 + 免费送货", 10).includes("送\n1"))
  for (const line of wrap("Winding down before bed, a quick spray", 10).split("\n")) assert.ok(line.length * 0.56 <= 10.6, line)
  assert.equal(wrap("短句", 10), "短句")
})

test("end card text always clears the platform's UI", () => {
  for (const p of Object.values(PLATFORMS)) {
    const [width, height] = p.size
    const plan = endCardPlan({ width, height, safe: p.safe, headline: "试试没药的温热", offer: "S$39 · 买3送1 + 免费送货", cta: "立即订购 herbalbathsg.com" })
    assert.ok(plan.y3 < (1 - p.safe.bottom) * height, `${p.id}: CTA above the bottom UI`)
    assert.ok(plan.y1 > p.safe.top * height, `${p.id}: headline below the top UI`)
    assert.ok(plan.productH >= height * 0.2, `${p.id}: product stays big`)
  }
  const ass = buildAss({ width: 1080, height: 1920, safe: PLATFORMS.tiktok.safe, font: "Noto Sans CJK SC", colors: brand.colors, timeline: [{ start: 0, end: 2, text: "Hook {bad}", kind: "hook" }], endCard: { start: 2, end: 4, headline: "H", offer: "O", cta: "C" } })
  assert.match(ass, /Style: Hook,Noto Sans CJK SC,/)
  assert.match(ass, /Dialogue: 1,0:00:00\.00,0:00:02\.00,Hook,,0,0,0,,\{\\fad/)
  assert.ok(!ass.includes("{bad}"), "braces in captions can't inject ASS overrides")
  assert.match(ass, /&H001E357F/, "brand colour in ASS byte order")
})

test("renderAd cuts shots, captions and an end card into a platform-sized MP4", { skip: !(await hasFfmpeg()) && "ffmpeg not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-ad-"))
  const photo = new URL("../brands/herbalbath/product.jpg", import.meta.url).pathname
  const clip = join(dir, "clip.mp4")
  await renderMotion({ image: photo, out: clip, camera: "push-in", aspect: "9:16", duration: 2 })
  const brief = templateBrief({ brand, platform: "feed", language: "en", angle: "offer" })
  brief.shots = brief.shots.slice(0, 2).map((s) => ({ ...s, seconds: 1.5 }))
  brief.endCard.seconds = 1.5
  const out = join(dir, "ad.mp4")
  const res = await renderAd({ brief, brand, clips: [{ path: clip, hasAudio: false }, { path: clip, hasAudio: false }], cutout: new URL("../brands/herbalbath/product-cutout.webp", import.meta.url).pathname, out, workDir: dir, font: "DejaVu Sans", music: "calm" })
  const info = await probe(out)
  assert.deepEqual([info.width, info.height], [1080, 1350])
  assert.ok(Math.abs(info.duration - 4.5) < 0.15, `duration ${info.duration}`)
  assert.equal(info.hasAudio, true)
  assert.equal(res.seconds, 4.5)
})
