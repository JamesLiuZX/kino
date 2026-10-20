// "This computer": the zip reader, resumable downloads, picking the engine
// build, installing it, and the local provider driving a fake sd-server
// through real jobs (start, steps, cancel, swapping packs, failures).

import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import { unzip } from "../src/engine/unzip.mjs"
import { download } from "../src/engine/download.mjs"
import { PACKS, RECIPES, packById, packForApp, pickAssets } from "../src/engine/catalog.mjs"
import { Engine } from "../src/engine/index.mjs"
import { LocalProvider, promptFor } from "../src/providers/local.mjs"
import { Settings } from "../src/settings.mjs"
import { appById } from "../apps/catalog.mjs"
import { resolveValues } from "../src/apps.mjs"
import { hasFfmpeg } from "../src/media/ffmpeg.mjs"
import { proceduralImage } from "../src/media/png.mjs"
import { makeZip } from "./helpers/zip.mjs"

const FAKE = fileURLToPath(new URL("./helpers/fake-sd-server.mjs", import.meta.url))
const tmp = () => mkdtempSync(join(tmpdir(), "kino-engine-"))
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)))

/** A folder with sd-server and sd-cli that run the fake. */
function fakeBinaries(env = {}) {
  const dir = tmp()
  const vars = Object.entries(env)
    .map(([k, v]) => `${k}=${JSON.stringify(String(v))} `)
    .join("")
  for (const tool of ["sd-server", "sd-cli"]) {
    const file = join(dir, tool)
    writeFileSync(file, `#!/bin/sh\n${vars}exec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\n`)
    chmodSync(file, 0o755)
  }
  return dir
}

/** An engine whose programs are the fake and whose packs are on disk (as empty files). */
function fakeEngine({ env = {}, packs = ["images-fast"], idle = 10 } = {}) {
  const dir = tmp()
  const log = join(dir, "requests.jsonl")
  const bin = fakeBinaries({ FAKE_SD_LOG: log, ...env })
  const settings = { get: (k) => ({ engineBinary: bin, engineIdleMinutes: idle })[k] }
  const engine = new Engine({ dir, settings })
  mkdirSync(engine.modelsDir, { recursive: true })
  for (const id of packs) for (const f of Object.values(packById(id).files)) writeFileSync(engine.modelPath(f.name), "weights")
  const requests = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : []
  return { engine, requests, dir }
}

const job = (appId, input = {}) => {
  const app = appById(appId)
  return { app, values: resolveValues(app, input) }
}

// ------------------------------------------------------------------ unzip

test("unzip: stored and deflated entries, folders, executable bits and symlinks", async () => {
  const dir = tmp()
  const zip = join(dir, "engine.zip")
  const big = Buffer.alloc(300_000, "kino ")
  writeFileSync(
    zip,
    makeZip([
      { name: "bin/", mode: 0o755 },
      { name: "bin/sd-server", data: "#!/bin/sh\necho hi\n", mode: 0o755, deflate: true },
      { name: "bin/libstable-diffusion.so.1", data: big, deflate: true },
      { name: "bin/libstable-diffusion.so", data: "libstable-diffusion.so.1", symlink: true },
      { name: "LICENSE.txt", data: "MIT" },
    ]),
  )
  const out = join(dir, "out")
  const names = await unzip(zip, out)
  assert.equal(names.length, 5)
  assert.equal(readFileSync(join(out, "bin/sd-server"), "utf8"), "#!/bin/sh\necho hi\n")
  assert.equal(statSync(join(out, "bin/sd-server")).mode & 0o777, 0o755)
  assert.deepEqual(readFileSync(join(out, "bin/libstable-diffusion.so.1")), big)
  assert.ok(lstatSync(join(out, "bin/libstable-diffusion.so")).isSymbolicLink())
  assert.equal(readlinkSync(join(out, "bin/libstable-diffusion.so")), "libstable-diffusion.so.1")
  assert.equal(readFileSync(join(out, "LICENSE.txt"), "utf8"), "MIT")
})

test("unzip: refuses paths that would escape the folder", async () => {
  const dir = tmp()
  const zip = join(dir, "evil.zip")
  writeFileSync(zip, makeZip([{ name: "../outside.txt", data: "no" }]))
  await assert.rejects(unzip(zip, join(dir, "out")), /unsafe path/)
  assert.ok(!existsSync(join(dir, "outside.txt")))
})

// ------------------------------------------------------------------ downloads

test("download: resumes with a Range request after the connection drops, and stops on a 404", async () => {
  const file = Buffer.alloc(200_000)
  for (let i = 0; i < file.length; i++) file[i] = i % 251
  const seen = []
  let dropped = false
  const server = createServer((req, res) => {
    if (req.url !== "/model.gguf") {
      res.writeHead(404)
      return res.end()
    }
    const range = /bytes=(\d+)-/.exec(req.headers.range ?? "")
    seen.push(range ? Number(range[1]) : 0)
    const start = range ? Number(range[1]) : 0
    res.writeHead(range ? 206 : 200, { "Content-Length": file.length - start, ...(range ? { "Content-Range": `bytes ${start}-${file.length - 1}/${file.length}` } : {}) })
    if (!dropped) {
      dropped = true
      res.write(file.subarray(0, 80_000))
      setTimeout(() => res.destroy(), 20)
      return
    }
    res.end(file.subarray(start))
  })
  const base = await listen(server)
  try {
    const dest = join(tmp(), "models", "model.gguf")
    const progress = []
    await download(`${base}/model.gguf`, dest, { onProgress: (p) => progress.push(p), everyMs: 0, retryDelayMs: 10 })
    assert.deepEqual(readFileSync(dest), file)
    assert.ok(!existsSync(`${dest}.part`))
    assert.equal(seen[0], 0)
    assert.ok(seen[1] > 0, `second request resumed from byte ${seen[1]}`)
    assert.equal(progress.at(-1).received, file.length)
    await assert.rejects(download(`${base}/gone.gguf`, join(tmp(), "gone.gguf"), { retryDelayMs: 10 }), /isn't at .* any more \(404\)/)
  } finally {
    server.close()
  }
})

// ------------------------------------------------------------------ builds

const UPSTREAM = [
  "sd-master-b13a482-bin-Darwin-macOS-15.7.4-arm64.zip",
  "sd-master-b13a482-bin-Linux-Ubuntu-24.04-x86_64.zip",
  "sd-master-b13a482-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip",
  "sd-master-b13a482-bin-Linux-Ubuntu-24.04-x86_64-rocm-7.1.zip",
  "sd-master-b13a482-bin-win-cpu-x64.zip",
  "sd-master-b13a482-bin-win-cuda12-x64.zip",
  "sd-master-b13a482-bin-win-vulkan-x64.zip",
  "cudart-sd-bin-win-cu12-x64.zip",
]

test("engine builds: the right upstream zip for each machine and choice", () => {
  assert.deepEqual(pickAssets(UPSTREAM, { platform: "darwin", arch: "arm64" }), { main: UPSTREAM[0] })
  assert.deepEqual(pickAssets(UPSTREAM, { platform: "darwin", arch: "x64" }), { main: UPSTREAM[0] }, "the macOS build is universal")
  assert.deepEqual(pickAssets(UPSTREAM, { platform: "linux", arch: "x64" }), { main: UPSTREAM[2] }, "Vulkan by default; it falls back to the CPU itself")
  assert.deepEqual(pickAssets(UPSTREAM, { platform: "linux", arch: "x64", build: "cpu" }), { main: UPSTREAM[1] })
  assert.deepEqual(pickAssets(UPSTREAM, { platform: "win32", arch: "x64" }), { main: UPSTREAM[6] })
  assert.deepEqual(pickAssets(UPSTREAM, { platform: "win32", arch: "x64", build: "cuda" }), { main: UPSTREAM[5], extra: UPSTREAM[7] })
  assert.deepEqual(pickAssets(UPSTREAM, { platform: "win32", arch: "x64", build: "cpu" }), { main: UPSTREAM[4] })
  assert.equal(pickAssets(UPSTREAM, { platform: "linux", arch: "arm64" }), null)
  assert.deepEqual(pickAssets(["sd-master-1-bin-win-avx2-x64.zip"], { platform: "win32", arch: "x64", build: "vulkan" }), { main: "sd-master-1-bin-win-avx2-x64.zip" }, "older releases named the CPU build by instruction set")
})

test("engine install: finds the newest release with this machine's build, unpacks it, and remembers it", async () => {
  const zip = makeZip([{ name: "sd-server", data: "#!/bin/sh\n", mode: 0o755 }, { name: "sd-cli", data: "#!/bin/sh\n", mode: 0o755 }, { name: "ggml.txt", data: "MIT" }])
  let base
  const server = createServer((req, res) => {
    if (req.url.startsWith("/repos/leejet/stable-diffusion.cpp/releases")) {
      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end(
        JSON.stringify([
          { tag_name: "master-900-aaaaaaa", assets: [{ name: "sd-master-aaaaaaa-bin-Darwin-macOS-15.7.4-arm64.zip", browser_download_url: `${base}/dl/mac.zip` }] },
          { tag_name: "master-899-bbbbbbb", assets: [{ name: "sd-master-bbbbbbb-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip", browser_download_url: `${base}/dl/linux.zip` }] },
        ]),
      )
    }
    if (req.url === "/dl/linux.zip") {
      res.writeHead(200, { "Content-Length": zip.length })
      return res.end(zip)
    }
    res.writeHead(404)
    res.end()
  })
  base = await listen(server)
  try {
    const engine = new Engine({ dir: tmp(), settings: new Settings(tmp(), {}), platform: "linux", arch: "x64", apiBase: base })
    assert.equal(engine.installed(), false)
    engine.install()
    for (let i = 0; i < 100 && engine.tasks.has("install"); i++) await delay(20)
    const st = engine.status()
    assert.equal(st.install, null, st.install?.error)
    assert.equal(st.installed, true)
    assert.equal(st.release, "master-899-bbbbbbb")
    assert.equal(st.build, "vulkan")
    assert.equal(statSync(engine.binaryPath("sd-server")).mode & 0o111, 0o111, "still executable")
    assert.equal(JSON.parse(readFileSync(join(engine.dir, "engine.json"), "utf8")).release, "master-899-bbbbbbb")
  } finally {
    server.close()
  }
})

// ------------------------------------------------------------------ requests

test("local requests: each app's request carries its model's settings and the app's prompt wording", () => {
  const fast = job("image-fast", { prompt: "a bath pack on marble", style: "cinematic", aspect: "9:16", seed: 7 })
  const r1 = RECIPES["image-fast"]({ ...fast, prompt: promptFor(fast.app, fast.values), images: {} })
  assert.equal(r1.kind, "img_gen")
  assert.match(r1.body.prompt, /a bath pack on marble/)
  assert.notEqual(r1.body.prompt, "a bath pack on marble", "the look's words are added, as for ComfyUI")
  assert.equal(r1.body.seed, 7)
  assert.ok(r1.body.height > r1.body.width && r1.body.width % 64 === 0)
  assert.equal(r1.body.sample_params.sample_steps, 8)
  assert.equal(r1.body.sample_params.guidance.txt_cfg, 1)

  const pro = job("image-pro", { prompt: "poster", resolution: "2mp" })
  const r2 = RECIPES["image-pro"]({ ...pro, prompt: promptFor(pro.app, pro.values), images: {} })
  assert.equal(r2.body.sample_params.custom_sigmas.length, 9, "Qwen Image 2.1 Turbo's 8-step schedule")
  assert.ok(r2.body.width * r2.body.height > 1.8 * 1024 * 1024)

  const edit = job("edit", { prompt: "put it on a beach", image: "a_1", image2: "a_2" })
  const r3 = RECIPES.edit({ ...edit, prompt: promptFor(edit.app, edit.values), images: { image: "data:a", image2: "data:b" }, size: { width: 3000, height: 2000 } })
  assert.deepEqual(r3.body.ref_images, ["data:a", "data:b"])
  assert.ok(r3.body.width > r3.body.height && r3.body.width % 32 === 0, "keeps the photo's shape")

  const cut = job("cutout", { image: "a_1" })
  assert.match(RECIPES.cutout({ ...cut, prompt: "", images: { image: "data:a" } }).body.prompt, /RGBA image with transparency/)

  const video = job("video-draft", { prompt: "steam rises", camera: "orbit", duration: 3, aspect: "9:16" })
  const r5 = RECIPES["video-draft"]({ ...video, prompt: promptFor(video.app, video.values), images: { image: "data:a" } })
  assert.equal(r5.kind, "vid_gen")
  assert.equal(r5.body.video_frames, 73)
  assert.equal((r5.body.video_frames - 1) % 4, 0)
  assert.deepEqual([r5.body.width, r5.body.height], [480, 832])
  assert.equal(r5.body.init_image, "data:a")
  assert.match(r5.body.prompt, /steam rises/)

  for (const p of PACKS) for (const a of p.apps) assert.ok(appById(a), `${p.id} names a real app (${a})`)
  for (const id of ["video-pro", "video-scene", "talk", "upscale-video"]) assert.equal(packForApp(id), undefined, `${id} stays on GPU servers`)
})

// ------------------------------------------------------------------ the provider

test("local: runs a picture through sd-server with live steps, keeps the server warm, and says which pack is missing", async () => {
  const { engine, requests } = fakeEngine()
  try {
    const provider = new LocalProvider({ engine, pollMs: 20 })
    const status = await provider.status({ "image-fast": [], "image-pro": [], smooth: [], talk: [] })
    assert.equal(status.ok, true)
    assert.equal(status.apps["image-fast"].ready, true)
    assert.equal(status.apps["image-pro"].ready, false)
    assert.match(status.apps["image-pro"].reason, /Pro images/)
    assert.match(status.apps.talk.reason, /GPU server/)

    const { app, values } = job("image-fast", { prompt: "a jar of bath salts", seed: 42 })
    const progress = []
    const out = await provider.run({ app, values, inputs: {}, workDir: tmp(), onProgress: (p, m) => progress.push([p, m]) })
    assert.equal(out.length, 1)
    assert.equal(out[0].mime, "image/png")
    assert.equal(out[0].data.readUInt32BE(0), 0x89504e47)
    assert.ok(progress.some(([, m]) => /^Step \d+ of 8$/.test(m)), "steps come through")
    for (let i = 1; i < progress.length; i++) assert.ok(progress[i][0] >= progress[i - 1][0] - 1e-9, "progress never goes backwards")

    const started = requests().filter((r) => r.argv)
    assert.equal(started.length, 1)
    assert.ok(started[0].argv.includes("--diffusion-model") && started[0].argv.some((a) => a.endsWith("z_image_turbo-Q4_K.gguf")))
    assert.ok(started[0].argv.includes("--listen-ip") && started[0].argv.includes("127.0.0.1"))
    const sent = requests().find((r) => r.path === "/sdcpp/v1/img_gen").request
    assert.equal(sent.seed, 42)
    assert.equal(sent.preview, "proj", "asks for previews, which carry the step count")

    await provider.run({ app, values: { ...values, seed: 43 }, inputs: {}, workDir: tmp() })
    assert.equal(requests().filter((r) => r.argv).length, 1, "the second picture reuses the loaded server")

    const pro = job("image-pro", { prompt: "poster" })
    await assert.rejects(provider.run({ ...pro, inputs: {}, workDir: tmp() }), /Download the “Pro images, edits and cut-outs” pack/)
    const talk = job("talk", { image: "a_1", audio: "a_2" })
    await assert.rejects(provider.run({ ...talk, inputs: {}, workDir: tmp() }), /too big to run on this computer/)
  } finally {
    await engine.close()
  }
})

test("local: edits send the photo as a reference, and a different pack swaps the server", async () => {
  const { engine, requests } = fakeEngine({ packs: ["images-fast", "images-pro"] })
  try {
    const provider = new LocalProvider({ engine, pollMs: 20 })
    const fast = job("image-fast", { prompt: "a bowl" })
    await provider.run({ ...fast, inputs: {}, workDir: tmp() })
    const photo = join(tmp(), "photo.png")
    writeFileSync(photo, proceduralImage({ width: 96, height: 64, seed: 3 }))
    const edit = job("edit", { prompt: "on a beach", image: "a_1" })
    const out = await provider.run({ ...edit, inputs: { image: photo }, workDir: tmp() })
    assert.equal(out[0].mime, "image/png")
    const starts = requests().filter((r) => r.argv)
    assert.equal(starts.length, 2, "a second server for the second pack")
    assert.ok(starts[1].argv.some((a) => a.endsWith("qwen_image_2.1_turbo_int8_convrot.safetensors")))
    assert.ok(requests().some((r) => r.signal === "SIGTERM"), "the first server was stopped")
    const sent = requests().filter((r) => r.path === "/sdcpp/v1/img_gen").at(-1).request
    assert.equal(sent.ref_images.length, 1)
    assert.match(sent.ref_images[0], /^data:image\/png;base64,iVBOR/)
    assert.ok(sent.width > sent.height, "the photo's shape")
  } finally {
    await engine.close()
  }
})

test("local: cancelling stops the job on the engine", async () => {
  const { engine, requests } = fakeEngine({ env: { FAKE_SD_STEP_MS: 400 } })
  try {
    const provider = new LocalProvider({ engine, pollMs: 20 })
    const controller = new AbortController()
    const { app, values } = job("image-fast", { prompt: "slow" })
    const running = provider.run({ app, values, inputs: {}, workDir: tmp(), signal: controller.signal, onProgress: (p, m) => /^Step/.test(m) && controller.abort() })
    await assert.rejects(running, (e) => e.canceled === true)
    for (let i = 0; i < 50 && !requests().some((r) => /\/cancel$/.test(r.path ?? "")); i++) await delay(20)
    assert.ok(requests().some((r) => /\/cancel$/.test(r.path ?? "")), "asked sd-server to cancel")
  } finally {
    await engine.close()
  }
})

test("local: a failed job and an engine that dies while loading both explain themselves", async () => {
  const failing = fakeEngine({ env: { FAKE_SD_MODE: "fail" } })
  try {
    const { app, values } = job("image-fast", { prompt: "x" })
    await assert.rejects(new LocalProvider({ engine: failing.engine, pollMs: 20 }).run({ app, values, inputs: {}, workDir: tmp() }), /couldn't make it: generate_image returned empty results/)
  } finally {
    await failing.engine.close()
  }
  const crashing = fakeEngine({ env: { FAKE_SD_MODE: "crash" } })
  try {
    const { app, values } = job("image-fast", { prompt: "x" })
    await assert.rejects(new LocalProvider({ engine: crashing.engine, pollMs: 20 }).run({ app, values, inputs: {}, workDir: tmp() }), /ran out of memory/)
  } finally {
    await crashing.engine.close()
  }
})

test("local: video drafts come back as MP4, and upscaling runs sd-cli", { skip: !(await hasFfmpeg()) && "needs ffmpeg" }, async () => {
  const { engine, requests } = fakeEngine({ packs: ["video-draft", "upscale"] })
  try {
    const provider = new LocalProvider({ engine, pollMs: 20 })
    const video = job("video-draft", { prompt: "waves", duration: 2 })
    const [clip] = await provider.run({ ...video, inputs: {}, workDir: tmp() })
    assert.equal(clip.mime, "video/mp4")
    assert.ok(statSync(clip.path).size > 0)
    assert.equal(requests().find((r) => r.path === "/sdcpp/v1/vid_gen").request.video_frames, 49)

    const photo = join(tmp(), "small.png")
    writeFileSync(photo, proceduralImage({ width: 32, height: 24, seed: 5 }))
    const up = job("upscale-image", { image: "a_1", scale: "2x" })
    const [big] = await provider.run({ ...up, inputs: { image: photo }, workDir: tmp() })
    assert.equal(big.mime, "image/png")
    const cli = requests().find((r) => r.cli)
    assert.deepEqual(cli.cli.slice(0, 2), ["-M", "upscale"])
    assert.ok(cli.cli.some((a) => a.endsWith("RealESRGAN_x4plus.pth")))
  } finally {
    await engine.close()
  }
})

test("settings: 'This computer' is a provider, engine builds are checked, and the desktop app can default to it", () => {
  const dir = tmp()
  const s = new Settings(dir, {}, { defaults: { provider: "local" } })
  assert.equal(s.get("provider"), "local")
  s.update({ provider: "mock" })
  assert.equal(s.get("provider"), "mock", "choosing demo mode sticks even though the default differs")
  s.update({ provider: "local", engineBuild: "cuda", engineIdleMinutes: "0" })
  assert.equal(new Settings(dir, {}, { defaults: { provider: "local" } }).get("provider"), "local")
  assert.equal(s.get("engineBuild"), "cuda")
  assert.equal(s.get("engineIdleMinutes"), 10, "nonsense falls back to the default")
  assert.throws(() => s.update({ engineBuild: "quantum" }), /unknown engine build/)
  assert.equal(new Settings(tmp(), { KINO_SDCPP: "/opt/sd/sd-server" }).public().engineBinary.locked, true)
})
