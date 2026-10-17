// The ad brief: everything needed to make one short vertical ad, from the hook
// to the end card. Claude writes it against BRIEF_SCHEMA (structured outputs);
// the template writer produces the same shape; people edit it in the Ad
// Studio. normalizeBrief() is the single gate every brief passes before it is
// stored, whoever wrote it.

import { CAMERA } from "../presets.mjs"
import { platformById } from "./platforms.mjs"

export const ANGLES = {
  ritual: { label: "Daily ritual", hint: "the warm moment at the end of a long day" },
  gift: { label: "Gift for parents", hint: "grown-up children buying for Mum and Dad" },
  tradition: { label: "Ancient tradition", hint: "myrrh and frankincense, two thousand years of use" },
  howto: { label: "How to use", hint: "spray, wait ten seconds, press with your palm" },
  offer: { label: "The offer", hint: "price, bundle, delivery, guarantee" },
  community: { label: "Singapore homes", hint: "everyday people and places, no invented testimonials" },
}

export const SHOT_ROLES = ["hook", "moment", "product", "how", "claim", "offer"]
export const SOURCES = ["product-photo", "generate"]
export const MUSIC = ["calm", "none"]
const CAMERA_IDS = CAMERA.map((c) => c.id)

export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "angle", "hook", "shots", "endCard", "music", "postCopy", "notes"],
  properties: {
    title: { type: "string", description: "A short internal name for this variant, e.g. 'Gift · daughter hands box'." },
    angle: { type: "string", enum: Object.keys(ANGLES) },
    hook: {
      type: "string",
      description: "On-screen text for the first 1.5 seconds, in the ad language. At most 8 English words or 12 Chinese characters.",
    },
    shots: {
      type: "array",
      description: "4 to 6 shots in order. The first shot carries the hook. Total length 12 to 20 seconds before the end card.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "seconds", "source", "visual", "camera", "caption", "voiceover"],
        properties: {
          role: { type: "string", enum: SHOT_ROLES },
          seconds: { type: "number", description: "Between 2 and 4." },
          source: {
            type: "string",
            enum: SOURCES,
            description:
              "product-photo animates the real product photo and must be used for every shot where the product appears. generate creates a new scene that does not show the product (people, places, hands, ingredients).",
          },
          visual: {
            type: "string",
            description:
              "English prompt for the image and video models: subject, action, setting, light, mood, 25-60 words. For product-photo shots, describe only motion and light around the product. No on-screen text, no camera directions, no brand names.",
          },
          camera: { type: "string", enum: CAMERA_IDS },
          caption: { type: "string", description: "On-screen text in the ad language. At most 10 English words or 14 Chinese characters. May repeat an approved claim word for word." },
          voiceover: { type: "string", description: "A spoken line in the ad language that fits the shot length, or an empty string." },
        },
      },
    },
    endCard: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "offer", "cta"],
      properties: {
        headline: { type: "string", description: "At most 6 English words or 10 Chinese characters." },
        offer: { type: "string", description: "Price and offer exactly as the brand states them." },
        cta: { type: "string", description: "How to buy, exactly as the brand states it." },
      },
    },
    music: { type: "string", enum: MUSIC },
    postCopy: {
      type: "object",
      additionalProperties: false,
      required: ["primaryText", "headline", "hashtags"],
      properties: {
        primaryText: { type: "string", description: "The post text above the ad, 1-3 short sentences in the ad language, ending with the call to action." },
        headline: { type: "string", description: "Meta headline under the video, at most 40 characters." },
        hashtags: { type: "array", items: { type: "string" }, description: "3 to 6 hashtags, no spaces." },
      },
    },
    notes: { type: "string", description: "One or two sentences for the reviewer: who this variant is for and why it should work." },
  },
}

export const BRIEFS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["briefs"],
  properties: { briefs: { type: "array", items: BRIEF_SCHEMA } },
}

const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max)
const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : d)

/** Fill gaps, clamp ranges, add ids and platform facts. Never throws on a sloppy brief. */
export function normalizeBrief(raw, { platform = "tiktok", language = "zh", brandId, id } = {}) {
  const p = platformById(raw?.platform ?? platform)
  const shots = (Array.isArray(raw?.shots) ? raw.shots : []).slice(0, 8).map((s, i) => ({
    id: s.id ?? `s${i + 1}`,
    role: SHOT_ROLES.includes(s.role) ? s.role : i === 0 ? "hook" : "moment",
    seconds: +clamp(s.seconds, 1.5, 6, 3).toFixed(1),
    source: SOURCES.includes(s.source) ? s.source : "generate",
    visual: str(s.visual, 600),
    camera: CAMERA_IDS.includes(s.camera) ? s.camera : "push-in",
    caption: str(s.caption, 80),
    voiceover: str(s.voiceover, 200),
  }))
  const brief = {
    id: id ?? raw?.id ?? null,
    brandId: raw?.brandId ?? brandId,
    platform: p.id,
    aspect: p.aspect,
    language: raw?.language ?? language,
    title: str(raw?.title, 80) || "Untitled ad",
    angle: ANGLES[raw?.angle] ? raw.angle : "ritual",
    hook: str(raw?.hook, 60),
    shots,
    endCard: {
      headline: str(raw?.endCard?.headline, 60),
      offer: str(raw?.endCard?.offer, 80),
      cta: str(raw?.endCard?.cta, 80),
      seconds: +clamp(raw?.endCard?.seconds, 1.5, 5, 2.5).toFixed(1),
    },
    music: MUSIC.includes(raw?.music) ? raw.music : "calm",
    postCopy: {
      primaryText: str(raw?.postCopy?.primaryText, 600),
      headline: str(raw?.postCopy?.headline, 60),
      hashtags: (Array.isArray(raw?.postCopy?.hashtags) ? raw.postCopy.hashtags : [])
        .map((h) => `#${String(h).replace(/^#+/, "").replace(/\s+/g, "")}`)
        .filter((h) => h.length > 1)
        .slice(0, 8),
    },
    notes: str(raw?.notes, 400),
  }
  brief.seconds = +(brief.shots.reduce((s, x) => s + x.seconds, 0) + brief.endCard.seconds).toFixed(1)
  return brief
}

/** Structural problems that stop an ad from being made at all. */
export function briefProblems(brief) {
  const problems = []
  if (brief.shots.length < 2) problems.push("An ad needs at least two shots.")
  brief.shots.forEach((s, i) => {
    if (s.source === "generate" && !s.visual) problems.push(`Shot ${i + 1} needs a description of what to show.`)
  })
  return problems
}
