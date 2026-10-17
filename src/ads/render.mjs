// The editor: shot clips + captions + end card + sound -> one upload-ready MP4.
// One ffmpeg pass: every clip is fitted to the platform frame and its shot
// length, the end card is composed from the product cut-out, libass burns in
// the captions, and the mix is loudness-normalised to -14 LUFS (what TikTok and
// Meta play back at).

import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { run } from "../media/ffmpeg.mjs"
import { buildAss, endCardPlan } from "./captions.mjs"
import { platformById } from "./platforms.mjs"

const FPS = 30

// A soft, slowly changing chord pad: Cmaj7 - Am7 - Fmaj7 - G6, voiced low, each
// note doubled with a slightly detuned copy for warmth. Royalty-free by
// construction; good enough under captions, and replaceable with any track.
const CHORDS = [
  [130.81, 164.81, 196.0, 246.94],
  [110.0, 130.81, 164.81, 196.0],
  [87.31, 110.0, 130.81, 164.81],
  [98.0, 123.47, 146.83, 164.81],
]

export async function renderPad(out, seconds) {
  const seg = 5
  const fade = 1.5
  const n = Math.max(2, Math.ceil((seconds + fade) / (seg - fade)) + 1)
  const parts = []
  const labels = []
  for (let i = 0; i < n; i++) {
    const notes = CHORDS[i % CHORDS.length]
    const expr = notes.map((f) => `sin(2*PI*${f}*t)+0.7*sin(2*PI*${(f * 1.0035).toFixed(3)}*t)`).join("+")
    parts.push(`aevalsrc='0.045*(${expr})':s=48000:d=${seg}[c${i}]`)
    labels.push(`c${i}`)
  }
  let last = labels[0]
  for (let i = 1; i < n; i++) {
    parts.push(`[${last}][${labels[i]}]acrossfade=d=${fade}:c1=qsin:c2=qsin[x${i}]`)
    last = `x${i}`
  }
  parts.push(`[${last}]lowpass=f=1500,aecho=0.8:0.55:90|170:0.22|0.14,pan=stereo|c0=c0|c1=c0,atrim=duration=${seconds.toFixed(2)},afade=t=in:d=1[pad]`)
  await run("ffmpeg", ["-y", "-v", "error", "-filter_complex", parts.join(";"), "-map", "[pad]", "-c:a", "pcm_s16le", out])
  return out
}

/**
 * clips: [{path, hasAudio}] in shot order. cutout: product image with alpha (or
 * any product photo). music: "calm" | "none" | a file path.
 */
export async function renderAd({ brief, brand, clips, cutout, out, workDir, font, music = brief.music, onProgress = () => {}, signal }) {
  const p = platformById(brief.platform)
  const [W, H] = p.size
  const { productH, productTop } = endCardPlan({ width: W, height: H, safe: p.safe, ...brief.endCard })
  const shots = brief.shots.map((s, i) => ({ ...s, clip: clips[i] }))
  if (shots.some((s) => !s.clip)) throw new Error("Some shots haven't been made yet.")
  const endSeconds = brief.endCard.seconds
  const total = +(shots.reduce((a, s) => a + s.seconds, 0) + endSeconds).toFixed(2)

  // Captions timeline: the hook rides the first shot, then one caption per shot.
  const timeline = []
  let t = 0
  shots.forEach((s, i) => {
    const text = i === 0 && brief.hook ? brief.hook : s.caption
    timeline.push({ start: t + 0.04, end: t + s.seconds - 0.04, text, kind: i === 0 && brief.hook ? "hook" : "caption" })
    if (i === 0 && brief.hook && s.caption && s.caption !== brief.hook) timeline.push({ start: t + Math.min(1.2, s.seconds / 2), end: t + s.seconds - 0.04, text: s.caption, kind: "caption" })
    t += s.seconds
  })
  const ass = buildAss({
    width: W,
    height: H,
    safe: p.safe,
    font,
    colors: brand.colors,
    timeline,
    endCard: { start: t + 0.15, end: total, headline: brief.endCard.headline, offer: brief.endCard.offer, cta: brief.endCard.cta },
  })
  const assPath = join(workDir, "captions.ass")
  await writeFile(assPath, ass)

  let musicPath = null
  if (music === "calm") musicPath = await renderPad(join(workDir, "pad.wav"), total)
  else if (music && music !== "none") musicPath = music

  const args = ["-y", "-v", "error", "-progress", "pipe:1", "-nostats"]
  shots.forEach((s) => args.push("-i", s.clip.path))
  const cutoutIndex = shots.length
  args.push("-i", cutout)
  const musicIndex = musicPath ? shots.length + 1 : -1
  if (musicPath) args.push("-i", musicPath)

  const bg = (brand.colors.background ?? "#FBF4E8").replace("#", "0x")
  const f = []
  shots.forEach((s, i) => {
    const d = s.seconds.toFixed(3)
    f.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=15,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`,
    )
    if (s.clip.hasAudio) f.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`)
    else f.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d}[a${i}]`)
  })
  const e = endSeconds.toFixed(3)
  f.push(`color=c=${bg}:s=${W}x${H}:r=${FPS}:d=${e},format=yuv420p[bg]`)
  f.push(`[${cutoutIndex}:v]scale=-2:${productH},format=rgba,split[pc][ps]`)
  f.push(`[ps]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.28,boxblur=22:2[sh]`)
  f.push(`[bg][sh]overlay=(W-w)/2+14:${productTop + 26}[b1]`)
  f.push(`[b1][pc]overlay=(W-w)/2:${productTop},fade=t=in:st=0:d=0.3,format=yuv420p[vend]`)
  f.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${e}[aend]`)
  const pairs = shots.map((_, i) => `[v${i}][a${i}]`).join("") + "[vend][aend]"
  f.push(`${pairs}concat=n=${shots.length + 1}:v=1:a=1[vc][ac]`)
  f.push(`[vc]ass=filename=${filterPath(assPath)}${process.env.KINO_FONTS_DIR ? `:fontsdir=${filterPath(process.env.KINO_FONTS_DIR)}` : ""}[vs]`)
  const anyAudio = shots.some((s) => s.clip.hasAudio)
  if (musicPath) {
    const vol = anyAudio ? 0.22 : 0.55
    f.push(`[${musicIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${total},asetpts=PTS-STARTPTS,afade=t=in:d=0.6,afade=t=out:st=${Math.max(0, total - 1.6).toFixed(2)}:d=1.6,volume=${vol}[m]`)
    f.push(`[ac][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[am]`)
  } else {
    f.push(`[ac]anull[am]`)
  }
  // Silence stays silence: loudnorm would otherwise pump up noise.
  if (anyAudio || musicPath) f.push(`[am]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,afade=t=out:st=${Math.max(0, total - 0.8).toFixed(2)}:d=0.8[aout]`)
  else f.push(`[am]anull[aout]`)

  args.push(
    "-filter_complex", f.join(";"),
    "-map", "[vs]",
    "-map", "[aout]",
    "-t", String(total),
    "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    out,
  )

  let buffer = ""
  await run("ffmpeg", args, {
    signal,
    timeoutMs: 20 * 60_000,
    onStdout: (chunk) => {
      buffer += chunk
      const m = [...buffer.matchAll(/out_time_us=(\d+)/g)].at(-1)
      if (m) onProgress(Math.min(0.98, Number(m[1]) / 1e6 / total), "Editing the final cut")
      if (buffer.length > 4096) buffer = buffer.slice(-1024)
    },
  })
  return { out, seconds: total, width: W, height: H }
}

/** Escape a path for use inside an ffmpeg filter argument. */
function filterPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,")
}
