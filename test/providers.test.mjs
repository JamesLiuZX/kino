import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ComfyProvider } from "../src/providers/comfy.mjs"
import { RunpodProvider } from "../src/providers/runpod.mjs"
import { explainComfyError } from "../src/providers/common.mjs"
import { proceduralImage } from "../src/media/png.mjs"
import { fakeComfy, fakeRunpod } from "./helpers/fakes.mjs"

const prompt = () => ({
  3: { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
  4: { class_type: "KSampler", inputs: { seed: 1, steps: 4 } },
  5: { class_type: "LoadImage", inputs: { image: "kino_j1_image.png" } },
  9: { class_type: "SaveImage", inputs: { images: ["4", 0], filename_prefix: "Kino" } },
})

function inputFile() {
  const dir = mkdtempSync(join(tmpdir(), "kino-test-"))
  const path = join(dir, "in.png")
  writeFileSync(path, proceduralImage({ width: 16, height: 16, seed: 2 }))
  return { param: "image", name: "kino_j1_image.png", path, mime: "image/png" }
}

test("comfy: uploads inputs, queues with its own prompt id, follows progress, downloads saved outputs only", async () => {
  const fake = await fakeComfy()
  try {
    const provider = new ComfyProvider({ url: fake.url, pollMs: 200 })
    const progress = []
    const out = await provider.run({ prompt: prompt(), files: [inputFile()], onProgress: (p, m) => progress.push([p, m]) })
    assert.equal(fake.seen.uploads.length, 1)
    assert.equal(fake.seen.uploads[0].name, "kino_j1_image.png")
    assert.ok(fake.seen.uploads[0].overwrite)
    assert.equal(fake.seen.prompts.length, 1)
    assert.match(fake.seen.prompts[0].prompt_id, /^[0-9a-f-]{36}$/)
    assert.ok(fake.seen.prompts[0].client_id)
    assert.equal(fake.seen.ws, 1, "listened on the websocket")
    assert.equal(out.length, 1, "temp previews are skipped when saved files exist")
    assert.equal(out[0].mime, "image/png")
    assert.equal(out[0].data.readUInt32BE(0), 0x89504e47)
    assert.ok(progress.some(([, m]) => /Generating \d\/4/.test(m)), "step progress from the socket")
    for (let i = 1; i < progress.length; i++) assert.ok(progress[i][0] >= 0 && progress[i][0] <= 1)
  } finally {
    await fake.close()
  }
})

test("comfy: a missing model comes back as a plain-language error", async () => {
  const fake = await fakeComfy({ mode: "missing-model" })
  try {
    const provider = new ComfyProvider({ url: fake.url })
    await assert.rejects(provider.run({ prompt: prompt() }), /Model file missing on the GPU server: z_image_turbo_bf16\.safetensors/)
  } finally {
    await fake.close()
  }
})

test("comfy: an execution error surfaces the node and message", async () => {
  const fake = await fakeComfy({ mode: "exec-error" })
  try {
    await assert.rejects(new ComfyProvider({ url: fake.url, pollMs: 100 }).run({ prompt: prompt() }), /KSampler failed: CUDA out of memory/)
  } finally {
    await fake.close()
  }
})

test("comfy: cancelling removes the prompt from the queue and interrupts it", async () => {
  const fake = await fakeComfy({ mode: "slow" })
  try {
    const controller = new AbortController()
    const run = new ComfyProvider({ url: fake.url, pollMs: 100 }).run({ prompt: prompt(), signal: controller.signal })
    setTimeout(() => controller.abort(), 300)
    await assert.rejects(run, (e) => e.canceled === true)
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(fake.seen.deletes.length, 1)
    assert.equal(fake.seen.interrupts.length, 1)
    assert.equal(fake.seen.interrupts[0].prompt_id, fake.seen.prompts[0].prompt_id)
  } finally {
    await fake.close()
  }
})

test("comfy: status reports the GPU and which apps have their models", async () => {
  const fake = await fakeComfy()
  try {
    const s = await new ComfyProvider({ url: fake.url }).status({
      "image-fast": [{ name: "z_image_turbo_bf16.safetensors", directory: "diffusion_models" }],
      "image-pro": [{ name: "qwen_image_2.1_turbo_int8_convrot.safetensors", directory: "diffusion_models" }],
    })
    assert.equal(s.ok, true)
    assert.match(s.label, /ComfyUI 0\.41\.0 on NVIDIA L40S \(48 GB\)/)
    assert.equal(s.apps["image-fast"].ready, true)
    assert.equal(s.apps["image-pro"].ready, false)
    assert.equal(s.apps["image-pro"].missing[0].name, "qwen_image_2.1_turbo_int8_convrot.safetensors")
  } finally {
    await fake.close()
  }
})

test("runpod: sends the workflow with base64 inputs, polls to completion, decodes outputs", async () => {
  const fake = await fakeRunpod()
  try {
    const provider = new RunpodProvider({ endpoint: "ep123", key: "rpa_test", base: fake.base, pollMs: 50 })
    const progress = []
    const out = await provider.run({ prompt: prompt(), files: [inputFile()], onProgress: (p, m) => progress.push(m), expectedSeconds: 5 })
    const sent = fake.seen.runs[0].input
    assert.ok(sent.workflow["9"])
    assert.equal(sent.images.length, 1)
    assert.equal(sent.images[0].name, "kino_j1_image.png")
    assert.equal(Buffer.from(sent.images[0].image, "base64").readUInt32BE(0), 0x89504e47)
    assert.equal(out[0].data.readUInt32BE(0), 0x89504e47)
    assert.ok(progress.includes("Waiting for a GPU worker"))
    assert.ok(progress.includes("Generating"))
    assert.ok(fake.seen.auth.every((a) => a === "Bearer rpa_test"))
  } finally {
    await fake.close()
  }
})

test("runpod: failures carry the worker's message, plus a fix for missing models", async () => {
  const fake = await fakeRunpod({ mode: "fail" })
  try {
    const provider = new RunpodProvider({ endpoint: "ep123", key: "rpa_test", base: fake.base, pollMs: 30 })
    await assert.rejects(provider.run({ prompt: prompt() }), /'z_image_turbo_bf16\.safetensors' not found in diffusion_models[\s\S]*download-models\.sh/)
  } finally {
    await fake.close()
  }
  const crash = await fakeRunpod({ mode: "crash" })
  try {
    const provider = new RunpodProvider({ endpoint: "ep123", key: "rpa_test", base: crash.base, pollMs: 30 })
    await assert.rejects(provider.run({ prompt: prompt() }), (e) => e.message === "CUDA error: out of memory")
  } finally {
    await crash.close()
  }
})

test("runpod: a wrong key is explained, cancel reaches RunPod, oversize inputs are refused", async () => {
  const fake = await fakeRunpod({ mode: "slow" })
  try {
    await assert.rejects(new RunpodProvider({ endpoint: "ep", key: "wrong", base: fake.base }).status(), /rejected the API key/)
    const provider = new RunpodProvider({ endpoint: "ep", key: "rpa_test", base: fake.base, pollMs: 30 })
    assert.match((await provider.status()).label, /1 worker warm/)
    const controller = new AbortController()
    const run = provider.run({ prompt: prompt(), signal: controller.signal })
    setTimeout(() => controller.abort(), 150)
    await assert.rejects(run, (e) => e.canceled === true)
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(fake.seen.cancels, ["job-1"])
    const big = { param: "video", name: "big.mp4", data: Buffer.alloc(9 * 1024 * 1024), mime: "video/mp4" }
    await assert.rejects(provider.run({ prompt: prompt(), files: [big] }), /too large for RunPod Serverless/)
  } finally {
    await fake.close()
  }
})

test("explainComfyError names missing custom nodes and passes other errors through", () => {
  assert.match(explainComfyError({ error: { type: "missing_node_type", message: "Node 'VHS_VideoCombine' not found." } }), /Install the custom node/)
  assert.match(explainComfyError({ node_errors: { 7: { class_type: "KSampler", errors: [{ type: "required_input_missing", message: "Required input is missing", details: "model" }] } } }), /KSampler \(node 7\): Required input is missing — model/)
})
