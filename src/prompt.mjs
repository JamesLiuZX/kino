// What a person types is one line. What each model was trained on is not: MiniMax
// H3 reads shot lists with an Audio line and <Picture N> references, image models
// like a style tail, Wan likes the camera spelled out. These builders do that
// translation so the composer can stay a single text box.

import { audioById, cameraById, styleById } from "./presets.mjs"

const clean = (s) => String(s ?? "").trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "")

export function imagePrompt(prompt, styleId) {
  const style = styleById(styleId)
  return [clean(prompt), style.suffix].filter(Boolean).join(", ")
}

/**
 * MiniMax H3 / FastH3. `shots` lets the Ad Studio pass a storyboard; the composer
 * passes one prompt and gets a single shot.
 */
export function h3Prompt({ prompt, shots, camera, audio, hasImage = false, hasEndImage = false, style }) {
  const lines = []
  if (hasImage) lines.push("The video opens exactly on <Picture 1>, keeping its subject, product and setting consistent.")
  if (hasEndImage) lines.push(`It ends exactly on <Picture ${hasImage ? 2 : 1}>.`)
  const list = shots?.length ? shots : [{ text: prompt, camera }]
  list.forEach((s, i) => {
    const cam = cameraById(s.camera ?? camera)
    const parts = [clean(s.text), cam?.phrase]
    lines.push(`SHOT ${i + 1}: ${parts.filter(Boolean).join("; ")}.`)
  })
  if (style && style !== "none") lines.push(`Look: ${styleById(style).suffix}.`)
  lines.push(`Audio: ${audioById(audio).phrase}.`)
  return lines.join("\n")
}

export function wanPrompt({ prompt, camera, style }) {
  const cam = cameraById(camera)
  return [clean(prompt), cam?.phrase, style && style !== "none" ? styleById(style).suffix : ""].filter(Boolean).join(". ") + "."
}

export function talkingPrompt({ prompt }) {
  return clean(prompt) || "The person looks into the camera and speaks naturally, with small head movements and natural blinking."
}
