// What "This computer" can run, and where it gets it. The engine is
// stable-diffusion.cpp (MIT): one C++ program per platform with Metal on Apple
// Silicon, Vulkan or CUDA on PCs, and a CPU path everywhere. Kino keeps its
// sd-server running with one model pack loaded and sends it jobs, so a second
// picture doesn't reload gigabytes of weights the way a fresh process per
// image would.
//
// A pack is the set of files one family of models needs, named by what it lets
// you make. Files are the same open weights Kino's ComfyUI apps use (or the
// GGUF quantisations stable-diffusion.cpp's docs point to), downloaded once
// into the engine folder and shared between packs by name. `gb` sizes are
// as the Engine workflow's link check measured them (October 2026), for the
// Settings page until the real sizes are fetched.
// `node scripts/check-engine-files.mjs` checks every URL still answers.

export const ENGINE_REPO = "leejet/stable-diffusion.cpp"

// Upstream's macOS zip is built without Metal, so on Apple Silicon Kino uses
// its own build (.github/workflows/engine.yml), and upstream's only if that's
// missing.
export const METAL_BUILD_URL = "https://github.com/JamesLiuZX/kino/releases/download/engine-metal/sd-bin-macos-arm64-metal.zip"

const HF = "https://huggingface.co"

// Wan's own recommended negative prompt (from its reference code).
const WAN_NEGATIVE =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走"

// Qwen Image 2.1 Turbo's fixed 8-step schedule (sd.cpp's `--sigmas qwen-image-2.1-turbo`).
const QWEN_TURBO_SIGMAS = [1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0]

export const PACKS = [
  {
    id: "images-fast",
    label: "Fast images",
    model: "Z-Image-Turbo (GGUF)",
    blurb: "Photoreal pictures in 8 steps, prompts in English or Chinese. The one to start with.",
    memoryGb: 12,
    apps: ["image-fast"],
    files: {
      diffusion: { name: "z_image_turbo-Q4_K.gguf", gb: 3.86, url: `${HF}/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf` },
      llm: { name: "Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf", gb: 2.55, url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf` },
      vae: { name: "ae.safetensors", gb: 0.34, url: `${HF}/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors` },
    },
    server: (f) => ["--diffusion-model", f.diffusion, "--llm", f.llm, "--vae", f.vae, "--offload-to-cpu"],
  },
  {
    id: "images-pro",
    label: "Pro images, edits and cut-outs",
    model: "Qwen Image 2.1 Turbo",
    blurb: "Legible text and posters, edits described in words, and transparent cut-outs, from one model.",
    memoryGb: 32,
    apps: ["image-pro", "edit", "cutout"],
    files: {
      diffusion: { name: "qwen_image_2.1_turbo_int8_convrot.safetensors", gb: 7.26, url: `${HF}/Comfy-Org/Qwen-Image-2.1/resolve/main/diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors` },
      llm: { name: "qwen3vl_8b_int8_convrot.safetensors", gb: 9.35, url: `${HF}/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors` },
      vae: { name: "qwen_image_2.1_vae_bf16.safetensors", gb: 0.68, url: `${HF}/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors` },
    },
    server: (f) => ["--diffusion-model", f.diffusion, "--llm", f.llm, "--vae", f.vae, "--offload-to-cpu"],
  },
  {
    id: "video-draft",
    label: "Video drafts",
    model: "Wan 2.2 5B",
    blurb: "Silent motion from words or a photo. Slow on a laptop, fine on a gaming PC.",
    memoryGb: 24,
    apps: ["video-draft"],
    files: {
      diffusion: { name: "wan2.2_ti2v_5B_fp16.safetensors", gb: 10.0, url: `${HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors` },
      t5xxl: { name: "umt5-xxl-encoder-Q8_0.gguf", gb: 6.04, url: `${HF}/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q8_0.gguf` },
      vae: { name: "wan2.2_vae.safetensors", gb: 1.41, url: `${HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors` },
    },
    server: (f) => ["--diffusion-model", f.diffusion, "--t5xxl", f.t5xxl, "--vae", f.vae, "--offload-to-cpu"],
  },
  {
    id: "upscale",
    label: "Upscaling",
    model: "Real-ESRGAN x4",
    blurb: "Sharper, bigger photos in seconds. Small download.",
    memoryGb: 4,
    apps: ["upscale-image"],
    files: {
      upscaler: { name: "RealESRGAN_x4plus.pth", gb: 0.07, url: "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" },
    },
    // No server: upscaling is a one-shot `sd-cli -M upscale`.
    server: null,
  },
]

// ffmpeg for machines that don't have it (camera moves, the ad editor, MP4s):
// static builds with libass, libx264 and libvpx, fetched by the person's own
// Kino from their publishers, never bundled. Linux has it a package away.
// Each platform lists candidate sources in order (each one the zips that hold
// ffmpeg and ffprobe); Kino keeps the first that downloads and actually runs,
// so a publisher moving a build only costs a fallback. In October 2026
// martin-riedl.de's "latest" links answered 404 now and then for builds that
// were there a minute before, so Kino tries each candidate twice, and
// evermeet.cx's long-standing Intel builds come last. Apple Silicon reaches
// the Intel builds only after its own, and runs them under Rosetta.
const RIEDL = "https://ffmpeg.martin-riedl.de/redirect/latest/macos"
const riedl = (arch, channel) => [`${RIEDL}/${arch}/${channel}/ffmpeg.zip`, `${RIEDL}/${arch}/${channel}/ffprobe.zip`]
const EVERMEET = ["https://evermeet.cx/ffmpeg/getrelease/zip", "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"]
export const FFMPEG_SOURCES = {
  "darwin-arm64": [riedl("arm64", "release"), riedl("arm64", "snapshot"), riedl("amd64", "release"), riedl("amd64", "snapshot"), EVERMEET],
  "darwin-x64": [riedl("amd64", "release"), riedl("amd64", "snapshot"), EVERMEET],
  "win32-x64": [["https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"]],
}

/** Apps "This computer" runs with ffmpeg alone, no pack. */
export const FFMPEG_APPS = new Set(["smooth"])

export const packById = (id) => PACKS.find((p) => p.id === id)
export const packForApp = (appId) => PACKS.find((p) => p.apps.includes(appId))

/** Every file a pack needs, as [{key, name, url, gb}]. */
export const packFiles = (pack) => Object.entries(pack.files).map(([key, f]) => ({ key, ...f }))

// ---------------------------------------------------------------------------
// Requests: what each app sends to sd-server's native API (/sdcpp/v1), from the
// values Kino resolved for the job. `prompt` is the prompt as the app's own
// mapping writes it for the model (style and camera words included), `images`
// are data URLs of the job's input files, `size` the photo's {width, height}.

const snap = (n, m) => Math.max(m, Math.round(n / m) * m)

/** A width and height near `megapixels` with the aspect's shape, on a grid of `multiple`. */
export function sizeForAspect(w, h, megapixels, multiple) {
  const scale = Math.sqrt((megapixels * 1024 * 1024) / (w * h))
  return { width: snap(w * scale, multiple), height: snap(h * scale, multiple) }
}

const ASPECT_SHAPES = { "1:1": [1, 1], "9:16": [9, 16], "16:9": [16, 9], "4:5": [4, 5], "3:4": [3, 4], "4:3": [4, 3], "2:3": [2, 3], "3:2": [3, 2], "21:9": [21, 9] }
const shapeOf = (aspect) => ASPECT_SHAPES[aspect] ?? [1, 1]

/** Wan's sizes for each shape at 480p, the size it is quick enough at on a home GPU. */
const WAN_SIZES = { "16:9": [832, 480], "9:16": [480, 832], "1:1": [640, 640] }

export const RECIPES = {
  "image-fast": ({ values, prompt }) => {
    const [w, h] = shapeOf(values.aspect)
    return {
      kind: "img_gen",
      body: {
        prompt,
        ...sizeForAspect(w, h, 1, 64),
        seed: values.seed,
        batch_count: 1,
        sample_params: { sample_method: "euler", sample_steps: values.detail === "high" ? 12 : 8, guidance: { txt_cfg: 1.0 } },
        output_format: "png",
      },
    }
  },
  "image-pro": ({ values, prompt }) => {
    const [w, h] = shapeOf(values.aspect)
    return {
      kind: "img_gen",
      body: {
        prompt,
        ...sizeForAspect(w, h, values.resolution === "2mp" ? 2 : 1, 32),
        seed: values.seed,
        batch_count: 1,
        sample_params: { sample_method: "euler", sample_steps: 8, custom_sigmas: QWEN_TURBO_SIGMAS, guidance: { txt_cfg: 1.0 } },
        output_format: "png",
      },
    }
  },
  edit: ({ values, prompt, images, size }) => ({
    kind: "img_gen",
    body: {
      prompt,
      ...editSize(size),
      seed: values.seed,
      batch_count: 1,
      ref_images: [images.image, images.image2].filter(Boolean),
      sample_params: { sample_method: "euler", sample_steps: 8, custom_sigmas: QWEN_TURBO_SIGMAS, guidance: { txt_cfg: 1.0 } },
      output_format: "png",
    },
  }),
  // Qwen Image 2.1 decides on transparency from the prompt, in this wording.
  cutout: ({ values, images, size }) => ({
    kind: "img_gen",
    body: {
      prompt:
        "This is an RGBA image with transparency. Keep the main subject of the picture exactly as it is, with every detail, label and colour unchanged, and remove everything else. The image has alpha channel and the background is transparent.",
      ...editSize(size),
      seed: values.seed,
      batch_count: 1,
      ref_images: [images.image],
      sample_params: { sample_method: "euler", sample_steps: 8, custom_sigmas: QWEN_TURBO_SIGMAS, guidance: { txt_cfg: 1.0 } },
      output_format: "png",
    },
  }),
  "video-draft": ({ values, prompt, images }) => {
    const [width, height] = WAN_SIZES[values.aspect] ?? WAN_SIZES["16:9"]
    return {
      kind: "vid_gen",
      body: {
        prompt,
        negative_prompt: WAN_NEGATIVE,
        width,
        height,
        seed: values.seed,
        // Wan 2.2 5B runs at 24 fps; frame counts sit on a 4n+1 grid.
        video_frames: Math.round((Number(values.duration) * 24) / 4) * 4 + 1,
        fps: 24,
        ...(images.image ? { init_image: images.image } : {}),
        sample_params: { sample_method: "euler", sample_steps: 20, flow_shift: 3.0, guidance: { txt_cfg: 6.0 } },
        output_format: "webm",
      },
    }
  },
}

/** Edits keep the photo's shape at about one megapixel, on Qwen's 32-pixel grid. */
function editSize(size) {
  if (!size?.width || !size?.height) return { width: 1024, height: 1024 }
  return sizeForAspect(size.width, size.height, 1, 32)
}

// ---------------------------------------------------------------------------
// The engine program for this machine, from an upstream release's assets.

/**
 * Which upstream zip(s) to install. `build` is "auto", "cpu", "vulkan" or
 * "cuda". Returns {main, extra?} asset names, or null when upstream ships
 * nothing for this machine. Upstream names look like
 * sd-master-b13a482-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip.
 */
export function pickAssets(names, { platform, arch, build = "auto" }) {
  const find = (re) => names.find((n) => re.test(n))
  if (platform === "darwin") {
    // One universal build (arm64 and x86_64) for every Mac.
    const main = find(/-bin-Darwin-macOS-[\d.]+-(arm64|x86_64)\.zip$/)
    return main ? { main } : null
  }
  if (platform === "win32" && arch === "x64") {
    const wanted = build === "auto" ? "vulkan" : build
    if (wanted === "cuda") {
      const main = find(/-bin-win-cuda12-x64\.zip$/)
      const extra = find(/^cudart-sd-bin-win-cu12-x64\.zip$/)
      if (main) return extra ? { main, extra } : { main }
    }
    if (wanted === "vulkan") {
      const main = find(/-bin-win-vulkan-x64\.zip$/)
      if (main) return { main }
    }
    const main = find(/-bin-win-cpu-x64\.zip$/) ?? find(/-bin-win-avx2-x64\.zip$/) ?? find(/-bin-win-avx-x64\.zip$/)
    return main ? { main } : null
  }
  if (platform === "linux" && arch === "x64") {
    const wanted = build === "cpu" ? "cpu" : "vulkan" // upstream has no Linux CUDA zip
    if (wanted === "vulkan") {
      const main = find(/-bin-Linux-Ubuntu-[\d.]+-x86_64-vulkan\.zip$/)
      if (main) return { main }
    }
    const main = find(/-bin-Linux-Ubuntu-[\d.]+-x86_64\.zip$/)
    return main ? { main } : null
  }
  return null
}

export const binaryName = (tool, platform = process.platform) => (platform === "win32" ? `${tool}.exe` : tool)
