// Record a voice in the browser for "Make it talk": one big button, a live
// level meter and a timer, then play it back and use it or record again.
// Saves a mono 24 kHz WAV, which every model and ffmpeg reads.

import { h, icon, sheet, replace } from "./ui.mjs"

const RATE = 24000

export function openRecorder({ maxSeconds = 15, onDone }) {
  let stream = null
  let recorder = null
  let ctx = null
  let raf = 0
  let timer = 0
  let url = null
  const body = h("div.recorder", { "aria-live": "polite" })
  const s = sheet("Record the voice", body, { onClose: stopAll })

  function stopAll() {
    cancelAnimationFrame(raf)
    clearInterval(timer)
    if (recorder?.state === "recording") {
      recorder.onstop = null
      recorder.stop()
    }
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    ctx?.close().catch(() => {})
    ctx = null
    if (url) URL.revokeObjectURL(url)
    url = null
  }

  function idle(note) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return problem("This browser can't record here. Recording needs a secure address (https, or localhost on this computer). You can add an mp3 or wav instead.")
    }
    replace(
      body,
      h("button.rec-btn", { type: "button", "aria-label": "Start recording", onclick: start }, icon("mic")),
      h("p.rec-time", {}, `Up to ${maxSeconds} seconds`),
      h("p.small.muted", {}, note ?? "Speak close to the microphone, somewhere quiet. Say exactly what the photo should say."),
    )
  }

  function problem(text) {
    replace(body, h("div.rec-problem", {}, icon("alert"), h("p", {}, text)), h("div.row", {}, h("button.btn", { type: "button", onclick: () => idle() }, icon("refresh"), "Try again"), h("button.btn.ghost", { type: "button", onclick: () => s.close() }, "Close")))
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
    } catch (e) {
      return problem(
        e.name === "NotAllowedError"
          ? "Kino can't hear you yet. Allow the microphone (the icon in the address bar), then try again."
          : e.name === "NotFoundError"
            ? "No microphone found. Plug one in, or add an mp3 or wav instead."
            : `The microphone didn't start: ${e.message}`,
      )
    }
    const chunks = []
    recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.onstop = () => finish(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }))
    recorder.start()

    const bars = Array.from({ length: 32 }, () => h("i"))
    const time = h("p.rec-time", {}, `0:00 / 0:${String(maxSeconds).padStart(2, "0")}`)
    replace(body, h("button.rec-btn.on", { type: "button", "aria-label": "Stop recording", onclick: () => recorder.stop() }, h("span.stop")), time, h("div.rec-meter", { "aria-hidden": "true" }, ...bars), h("p.small.muted", {}, "Tap to stop when you're done."))

    // Level meter: a short history of loudness, newest on the right.
    ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)
    const levels = bars.map(() => 0)
    let last = 0
    const draw = (t) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 70) return
      last = t
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (const x of buf) sum += ((x - 128) / 128) ** 2
      levels.shift()
      levels.push(Math.min(1, Math.sqrt(sum / buf.length) * 4))
      bars.forEach((b, i) => (b.style.height = `${8 + levels[i] * 92}%`))
    }
    raf = requestAnimationFrame(draw)

    const began = Date.now()
    timer = setInterval(() => {
      const sec = (Date.now() - began) / 1000
      time.textContent = `0:${String(Math.floor(sec)).padStart(2, "0")} / 0:${String(maxSeconds).padStart(2, "0")}`
      if (sec >= maxSeconds && recorder.state === "recording") recorder.stop()
    }, 200)
  }

  async function finish(blob) {
    cancelAnimationFrame(raf)
    clearInterval(timer)
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    replace(body, h("p.rec-time", {}, "Getting it ready…"))
    let wav
    try {
      wav = await toWav(blob)
    } catch (e) {
      return problem(`That recording couldn't be read (${e.message}). Try again, or add an mp3 or wav.`)
    }
    if (wav.seconds < 0.6) return idle("That was very short. Tap the button, speak, then tap again to stop.")
    url = URL.createObjectURL(wav.blob)
    const file = new File([wav.blob], `voice-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.wav`, { type: "audio/wav" })
    replace(
      body,
      h("audio", { src: url, controls: true, autoplay: true }),
      h("p.rec-time", {}, `${wav.seconds.toFixed(1)} seconds`),
      h(
        "div.row",
        {},
        h("button.btn.ghost", { type: "button", onclick: () => (URL.revokeObjectURL(url), (url = null), idle()) }, icon("refresh"), "Record again"),
        h(
          "button.btn.primary",
          {
            type: "button",
            onclick: () => {
              s.close()
              onDone(file)
            },
          },
          icon("check"),
          "Use this recording",
        ),
      ),
    )
  }

  idle()
  return s
}

/** Decode whatever the browser recorded, mix to mono, resample, lift quiet takes, and write a 16-bit WAV. */
async function toWav(blob) {
  const decoder = new AudioContext()
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer())
    const length = Math.max(1, Math.ceil(decoded.duration * RATE))
    const offline = new OfflineAudioContext(1, length, RATE)
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const samples = (await offline.startRendering()).getChannelData(0)
    let peak = 0
    for (const x of samples) peak = Math.max(peak, Math.abs(x))
    const gain = peak > 0 ? Math.min(4, 0.89 / peak) : 1
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
    const text = (at, str) => [...str].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
    text(0, "RIFF")
    view.setUint32(4, 36 + samples.length * 2, true)
    text(8, "WAVE")
    text(12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, RATE, true)
    view.setUint32(28, RATE * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, "data")
    view.setUint32(40, samples.length * 2, true)
    for (let i = 0; i < samples.length; i++) {
      const x = Math.max(-1, Math.min(1, samples[i] * gain))
      view.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
    }
    return { blob: new Blob([view], { type: "audio/wav" }), seconds: decoded.duration }
  } finally {
    decoder.close().catch(() => {})
  }
}
