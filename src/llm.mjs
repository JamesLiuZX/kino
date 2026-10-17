// Claude does the writing: turning a one-line idea into a prompt the chosen
// model reads well, and drafting ad storyboards. Both are optional. Without an
// API key, or without the SDK installed (`npm install`), Kino falls back to
// rule-based writing and says so in the UI. The studio never depends on it.

import { readFile } from "node:fs/promises"
import { cameraById, styleById } from "./presets.mjs"

// Server-side refusal fallbacks exist on these models only; elsewhere the
// parameter is a 400.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"])
const EFFORT_MODELS = /^claude-(fable|mythos|opus|sonnet|haiku)-5|^claude-opus-4-[5-8]/

let sdkPromise
const loadSdk = () => (sdkPromise ??= import("@anthropic-ai/sdk").then((m) => m.default, () => null))
const clients = new Map()

export class ClaudeError extends Error {}

export async function claudeStatus(settings) {
  const Anthropic = await loadSdk()
  if (!Anthropic) return { available: false, reason: "Run `npm install` in the Kino folder to enable Claude." }
  if (!settings.get("anthropicKey")) return { available: false, reason: "Add a Claude API key in Settings for smarter prompts and ad scripts." }
  return { available: true, model: settings.get("anthropicModel") }
}

async function clientFor(settings) {
  const key = settings.get("anthropicKey")
  const Anthropic = await loadSdk()
  if (!Anthropic || !key) return null
  if (!clients.has(key)) clients.set(key, new Anthropic({ apiKey: key, maxRetries: 2 }))
  return { client: clients.get(key), Anthropic }
}

/**
 * One request. With `schema`, Claude's answer is constrained to that JSON
 * Schema (structured outputs) and returned parsed.
 */
async function ask(settings, { system, content, schema, effort = "medium", maxTokens = 16000 }) {
  const c = await clientFor(settings)
  if (!c) return null
  const model = settings.get("anthropicModel")
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
  }
  const outputConfig = {}
  if (EFFORT_MODELS.test(model)) outputConfig.effort = effort
  if (schema) outputConfig.format = { type: "json_schema", schema }
  if (Object.keys(outputConfig).length) params.output_config = outputConfig
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ["server-side-fallback-2026-07-01"]
    params.fallbacks = "default"
  }

  let message
  try {
    message = await c.client.beta.messages.stream(params).finalMessage()
  } catch (e) {
    const { Anthropic } = c
    if (e instanceof Anthropic.AuthenticationError) throw new ClaudeError("Claude rejected the API key. Check it in Settings.")
    if (e instanceof Anthropic.PermissionDeniedError) throw new ClaudeError("That Claude API key can't use this model.")
    if (e instanceof Anthropic.NotFoundError) throw new ClaudeError(`Claude doesn't know the model "${model}". Check it in Settings.`)
    if (e instanceof Anthropic.RateLimitError) throw new ClaudeError("Claude is busy (rate limited). Try again in a minute.")
    if (e instanceof Anthropic.APIError) throw new ClaudeError(`Claude returned an error (${e.status ?? "network"}): ${e.message}`)
    throw e
  }
  if (message.stop_reason === "refusal") throw new ClaudeError("Claude declined to write this one. Try rephrasing.")
  if (message.stop_reason === "max_tokens") throw new ClaudeError("Claude's answer was cut off. Try fewer variants.")
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
  if (!schema) return text
  try {
    return JSON.parse(text)
  } catch {
    throw new ClaudeError("Claude's answer wasn't valid JSON.")
  }
}

// ---------------------------------------------------------------------------
// Prompt help.

const ENHANCE_SYSTEM = {
  image: `You rewrite short ideas into prompts for a photorealistic text-to-image model (Z-Image / Qwen Image). Describe the subject, setting, composition, lighting, lens and mood in one flowing paragraph of 40-80 words. Keep every specific the person gave (names, products, text to render, colours, numbers). If they ask for text in the image, quote it exactly. Do not add a style tag or aspect ratio; the app adds those. Write in the language the person used.`,
  video: `You rewrite short ideas into prompts for an image-to-video or text-to-video model with native audio (MiniMax H3). Describe what happens over a few seconds: the subject's action, how things move, the setting, the light. 35-70 words, present tense, one continuous shot. Do not name a camera move, a style or the sound; the app appends those from the person's presets. If a reference image is attached, the video starts on it: describe the motion from that frame instead of re-describing the picture. Write in English unless the person wrote Chinese.`,
  edit: `You rewrite requests to edit a photo into clear instructions for an instruction-following image editor (Qwen Image Edit). State exactly what to change and what must stay the same (the person, the product, its label and text). One or two sentences, imperative voice. If a photo is attached, refer to what is actually in it.`,
  talk: `You write a short performance note for a talking-photo model (LTX lip-sync): how the person in the photo should look and move while speaking (expression, small head movements, gestures, setting). 20-40 words. Do not write the spoken words.`,
}

const RULE_TAILS = {
  image: "highly detailed, natural light, sharp focus, balanced composition",
  video: "natural, fluid motion, consistent subject and lighting throughout",
  edit: "",
  talk: "",
}

/**
 * Returns { prompt, source: "claude" | "rules", note? }.
 * `image` is an optional local file path shown to Claude for context.
 */
export async function enhancePrompt(settings, { tool, prompt, image, camera, style }) {
  const kind = ENHANCE_SYSTEM[tool] ? tool : "image"
  const idea = String(prompt ?? "").trim()
  try {
    const content = []
    if (image) {
      const data = (await readFile(image)).toString("base64")
      const media_type = { png: "image/png", webp: "image/webp", gif: "image/gif" }[image.split(".").pop().toLowerCase()] ?? "image/jpeg"
      content.push({ type: "image", source: { type: "base64", media_type, data } })
    }
    const context = [
      camera ? `Camera preset the app will append: ${cameraById(camera)?.phrase ?? camera}.` : "",
      style && style !== "none" ? `Style the app will append: ${styleById(style).suffix}.` : "",
    ].filter(Boolean)
    content.push({
      type: "text",
      text: `${context.join("\n")}${context.length ? "\n\n" : ""}Idea: ${idea || "(none: suggest something that suits the attached image)"}\n\nReply with the prompt only, no preamble and no quotes.`,
    })
    const text = await ask(settings, { system: ENHANCE_SYSTEM[kind], content, effort: "low", maxTokens: 2000 })
    if (text) return { prompt: text.replace(/^["“]|["”]$/g, ""), source: "claude" }
  } catch (e) {
    if (!(e instanceof ClaudeError)) throw e
    return { prompt: ruleEnhance(kind, idea), source: "rules", note: e.message }
  }
  return { prompt: ruleEnhance(kind, idea), source: "rules" }
}

function ruleEnhance(kind, idea) {
  if (!idea) return idea
  if (kind === "edit") return /^(change|make|replace|remove|add|turn|put)\b/i.test(idea) ? idea : `Edit the photo: ${idea}. Keep everything else exactly the same.`
  const tail = RULE_TAILS[kind]
  return tail && !idea.includes(tail) ? `${idea.replace(/[.\s]+$/, "")}, ${tail}` : idea
}

/** Structured JSON from Claude, or null when Claude isn't set up. */
export function askJson(settings, { system, content, schema, effort = "high", maxTokens = 32000 }) {
  return ask(settings, { system, content, schema, effort, maxTokens })
}
