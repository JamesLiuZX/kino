// The website's fal.ai mapping: what each app asks fal for (with the studio's
// own prompt builders), and the queue protocol against a fake fal: submit with
// the visitor's key, wait out the queue, fetch the result, and say plainly
// when the key is wrong; cancelling cancels on fal too.

import { test } from "node:test"
import assert from "node:assert/strict"
import { ENDPOINTS, runOnFal, filesIn } from "../web/cloud.mjs"
import { imagePrompt, wanPrompt, talkingPrompt } from "../src/prompt.mjs"
import { audioById, sizeFor } from "../src/presets.mjs"

const h = {
  imagePrompt,
  wanPrompt,
  talkingPrompt,
  audioPhrase: (id) => audioById(id)?.phrase,
  size: (aspect, mp) => sizeFor(aspect ?? "1:1", mp, 64),
  file: async (id) => `data:image/png;base64,${Buffer.from(id).toString("base64")}`,
}
const ask = (app, values) => Promise.resolve(ENDPOINTS[app].input(values, h))

test("cloud requests: each app asks fal for the same thing the studio would make", async () => {
  const fast = await ask("image-fast", { prompt: "a jar of bath salts", style: "cinematic", aspect: "9:16", detail: "high", seed: 7 })
  assert.equal(fast.prompt, imagePrompt("a jar of bath salts", "cinematic"))
  assert.deepEqual(fast.image_size, sizeFor("9:16", 1, 64))
  assert.equal(fast.num_inference_steps, 12)
  assert.equal(fast.seed, 7)

  assert.deepEqual((await ask("edit", { prompt: "on marble", image: "a", image2: "b" })).image_urls.length, 2)
  assert.equal((await ask("video-pro", { image: "a", duration: 5 })).duration, 6, "LTX-2 takes 6 s and up")
  assert.equal((await ask("video-pro", { image: "a", duration: 10 })).duration, 10)
  assert.equal((await ask("video-scene", { prompt: "rain", duration: 15 })).duration, 16)
  assert.match((await ask("video-scene", { prompt: "rain on a window", camera: "push-in", audio: "ambient" })).prompt, /^rain on a window\. .+Sound: /)
  assert.equal((await ask("talk", { image: "a", audio: "b", duration: 6 })).num_frames, 151, "25 frames a second")
  assert.equal((await ask("talk", { image: "a", audio: "b", duration: 60 })).num_frames, 721, "within fal's limit")
  assert.equal((await ask("video-draft", { prompt: "x", duration: 5 })).num_frames, 121)
  assert.equal(ENDPOINTS["video-draft"].endpoint({ prompt: "x" }), "fal-ai/wan/v2.2-5b/text-to-video")
  assert.equal(ENDPOINTS["video-draft"].endpoint({ prompt: "x", image: "a" }), "fal-ai/wan/v2.2-5b/image-to-video")
  assert.equal((await ask("video-draft", { prompt: "x" })).image_url, undefined)
  assert.equal((await ask("smooth", { video: "v", factor: "4x" })).num_frames, 3)
  assert.equal((await ask("upscale-video", { video: "v", scale: "3x" })).upscale_factor, 3)
})

/** A fal that queues a job, makes it in a few polls, and hands back an image. */
function fakeFal({ status = 200, polls = 2 } = {}) {
  const calls = []
  let left = polls
  const json = (body, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json" } })
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null })
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError")
    if (url === "https://queue.fal.run/fal-ai/z-image/turbo") {
      if (status !== 200) return json({ detail: "No user found for Key ID" }, status)
      return json({ request_id: "r1", status_url: "https://queue.fal.run/fal-ai/z-image/requests/r1/status", response_url: "https://queue.fal.run/fal-ai/z-image/requests/r1", cancel_url: "https://queue.fal.run/fal-ai/z-image/requests/r1/cancel" })
    }
    if (url.endsWith("/status")) return json(left-- > 0 ? { status: left ? "IN_QUEUE" : "IN_PROGRESS", queue_position: left } : { status: "COMPLETED" })
    if (url.endsWith("/cancel")) return json({ status: "CANCELLATION_REQUESTED" })
    if (url.endsWith("/r1")) return json({ images: [{ url: "https://v3.fal.media/files/x/out.png", content_type: "image/png", width: 768, height: 1344 }], seed: 7 })
    return json({}, 404)
  }
  return { fetch, calls }
}

test("cloud queue: submit with the key, wait it out, return the files; a bad key says so", async () => {
  const fal = fakeFal()
  const said = []
  const out = await runOnFal({ appId: "image-fast", values: { prompt: "bath salts", aspect: "9:16" }, key: "k-123", h, fetch: fal.fetch, pollMs: 1, onProgress: (m) => said.push(m) })
  assert.deepEqual(out.files, [{ url: "https://v3.fal.media/files/x/out.png", mime: "image/png", width: 768, height: 1344 }])
  assert.equal(out.model, "Z-Image Turbo · fal.ai")
  const submit = fal.calls[0]
  assert.equal(submit.method, "POST")
  assert.equal(submit.auth, "Key k-123")
  assert.ok(!("seed" in submit.body), "nothing empty is sent")
  assert.ok(fal.calls.every((c) => c.auth === "Key k-123"), "every call carries the key")
  assert.ok(said.includes("Waiting at fal.ai (1 ahead)") && said.includes("Making it on fal.ai"))

  await assert.rejects(runOnFal({ appId: "image-fast", values: { prompt: "x" }, key: "wrong", h, fetch: fakeFal({ status: 401 }).fetch, pollMs: 1 }), /didn't accept the key/)
  await assert.rejects(runOnFal({ appId: "image-fast", values: { prompt: "x" }, key: "", h, fetch: fal.fetch }), /Add your fal.ai key/)
})

test("cloud queue: cancelling stops the wait and cancels the job on fal", async () => {
  const fal = fakeFal({ polls: 1000 })
  const controller = new AbortController()
  const run = runOnFal({ appId: "image-fast", values: { prompt: "x" }, key: "k", h, fetch: fal.fetch, pollMs: 5, signal: controller.signal })
  setTimeout(() => controller.abort(), 30)
  await assert.rejects(run, (e) => e.canceled === true)
  assert.ok(fal.calls.some((c) => c.method === "PUT" && c.url.endsWith("/cancel")))
  assert.deepEqual(filesIn({ video: { url: "https://v3.fal.media/v.mp4", content_type: "video/mp4" } }).map((f) => f.mime), ["video/mp4"])
})
