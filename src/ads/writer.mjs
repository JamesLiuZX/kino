// Writes ad briefs. With Claude: from the brand profile, the platform's rules
// and the product photo, constrained to BRIEFS_SCHEMA. Without Claude: from
// angle templates filled with the brand's own approved words, so every
// template ad is compliant by construction.

import { readFile } from "node:fs/promises"
import { askJson } from "../llm.mjs"
import { CAMERA } from "../presets.mjs"
import { ANGLES, BRIEFS_SCHEMA, normalizeBrief } from "./schema.mjs"
import { templateBrief } from "./templates.mjs"
import { platformById } from "./platforms.mjs"

const SYSTEM = `You are a direct-response creative director who writes short vertical video ads for small consumer brands in Singapore. You write storyboards that a video model will render shot by shot, and that a careful compliance reviewer will approve.

How the ads are made:
- Each shot is rendered by an AI video model from either the real product photo (source "product-photo": the camera moves around the actual bottle and box) or a newly generated scene (source "generate": people, homes, parks, hands, ingredients). A generated scene must never show the product, because the model would invent a different bottle.
- Captions are burned in by the editor, so "visual" must not contain text, logos, brand names or camera directions; the camera move is a separate field.
- The first shot must stop the scroll within one second. Captions are the main storytelling device because most people watch muted; keep them short and big.
- The end card shows the product cut-out with the headline, the offer and the call to action.

Rules you must follow:
- Use the brand's approved claims word for word, or make no claim about effects at all. Prefer warmth, ritual, tradition, family, gifting and the offer.
- Never address the viewer's body, health, age or condition ("your knee pain", "are you over 60"): Meta rejects it. Show people instead.
- None of the brand's banned words, in any language. No before-and-after, no doctors, clinics or lab coats, no comparisons with other products.
- Write captions, voice-over, end card and post copy in the requested language; write "visual" in English.
- Cast people the audience recognises: Singaporean, mostly Chinese, everyday homes (HDB flats), void decks, hawker centres, parks.`

export async function writeBriefs(settings, { brand, platform = "tiktok", language = "zh", angles = ["ritual"], notes = "", productImage }) {
  const p = platformById(platform)
  const wanted = angles.filter((a) => ANGLES[a]).slice(0, 3)
  if (!wanted.length) wanted.push("ritual")

  const content = []
  if (productImage) {
    content.push({ type: "image", source: { type: "base64", media_type: productImage.endsWith(".png") ? "image/png" : "image/jpeg", data: (await readFile(productImage)).toString("base64") } })
  }
  content.push({
    type: "text",
    text: [
      `Brand profile (JSON):\n${JSON.stringify(brandForPrompt(brand), null, 1)}`,
      `Platform: ${p.label}, ${p.aspect}. ${p.tip} Keep the whole ad between ${p.seconds[0]} and ${p.seconds[1]} seconds including a 2.5 second end card.`,
      `Camera moves available: ${CAMERA.map((c) => `${c.id} (${c.label})`).join(", ")}.`,
      `Language for everything the viewer reads or hears: ${language === "zh" ? "Simplified Chinese" : "English"}.`,
      `Write ${wanted.length} variant${wanted.length > 1 ? "s" : ""}, one per angle, in this order: ${wanted.map((a) => `${a} (${ANGLES[a].hint})`).join("; ")}.`,
      productImage ? "The attached photo is the real product." : "",
      notes ? `Notes from the brand owner: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  })

  const result = await askJson(settings, { system: SYSTEM, content, schema: BRIEFS_SCHEMA, effort: "high", maxTokens: 24000 })
  if (result?.briefs?.length) {
    return { source: "claude", briefs: result.briefs.slice(0, wanted.length).map((b) => normalizeBrief(b, { platform: p.id, language, brandId: brand.id })) }
  }
  return { source: "templates", briefs: wanted.map((a) => templateBrief({ brand, platform: p.id, language, angle: a })) }
}

function brandForPrompt(brand) {
  const { id, ...rest } = brand
  return { ...rest, product: { ...brand.product, images: undefined } }
}

export { templateBrief } from "./templates.mjs"
