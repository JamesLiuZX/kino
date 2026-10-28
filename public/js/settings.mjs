// Settings: where the models run (this computer, demo, your ComfyUI, RunPod
// Serverless), the optional Claude key, and a connection test that says what's
// actually ready. "This computer" also installs its engine and model packs here,
// with live progress.

import { h, icon, api, toast, fail, replace } from "./ui.mjs"
import { state, on, emit, isWeb, fullStudioUrl, toolById } from "./state.mjs"

const BACKENDS = [
  { id: "local", label: "This computer", icon: "laptop", blurb: "Open models running right here with stable-diffusion.cpp. No account, no key: one download per model pack." },
  { id: "mock", label: "Demo", icon: "sparkles", blurb: "No models. Placeholder results, for trying every tool and the Ad Studio first." },
  { id: "comfy", label: "ComfyUI server", icon: "cpu", blurb: "A RunPod GPU pod, a cloud GPU or your own PC running ComfyUI 0.41+. Fastest to set up; billed while the pod is on." },
  { id: "runpod", label: "RunPod Serverless", icon: "zap", blurb: "Pay per second of GPU and scale to zero when idle. Uses the worker image in runpod/." },
]

export function mountSettings(root) {
  if (isWeb()) return mountWebSettings(root)
  const s = () => state.boot.settings
  let provider = s().provider.value
  let testing = false
  let result = null
  const el = h("div.page.settings")
  // Re-rendered on its own from engine events, so typing elsewhere isn't lost.
  const engineEl = h("div.engine")
  root.append(el)

  const field = (key, label, { type = "text", placeholder, help, secret } = {}) => {
    const cur = s()[key]
    const input = h("input.input", { type, placeholder: secret && cur?.set ? `Saved (${cur.hint}). Type to replace.` : placeholder, value: secret ? "" : cur?.value ?? "", disabled: cur?.locked, autocomplete: "off", spellcheck: "false" })
    input.dataset.key = key
    input.dataset.secret = secret ? "1" : ""
    return h("label.field", {}, h("span", {}, label, cur?.locked ? h("small.muted", {}, " (set by environment)") : null), input, help ? h("small.muted", {}, help) : null)
  }

  const select = (key, label, options, { help } = {}) => {
    const cur = s()[key]
    const input = h("select.input", { disabled: cur?.locked }, ...Object.entries(options).map(([v, text]) => h("option", { value: v, selected: v === cur?.value }, text)))
    input.dataset.key = key
    return h("label.field", {}, h("span", {}, label, cur?.locked ? h("small.muted", {}, " (set by environment)") : null), input, help ? h("small.muted", {}, help) : null)
  }

  function collect() {
    const out = { provider }
    for (const input of el.querySelectorAll("[data-key]")) {
      if (input.disabled) continue
      if (input.dataset.secret && !input.value) continue
      out[input.dataset.key] = input.value
    }
    return out
  }

  async function saveAndTest() {
    testing = true
    result = null
    render()
    try {
      state.boot.settings = await api("/api/settings", { method: "PUT", body: collect() })
      const boot = await api("/api/bootstrap")
      state.boot = boot
      emit("boot", boot)
      result = await api("/api/status")
      state.status = result
      toast(result.ok ? "Connected." : "Saved, but the connection test failed.", { kind: result.ok ? "ok" : "error" })
    } catch (e) {
      fail(e)
    } finally {
      testing = false
      render()
    }
  }

  function render() {
    const claude = state.boot.claude
    replace(
      el,
      h("header.page-head", {}, h("div", {}, h("h1", {}, "Settings"), h("p.muted", {}, "Where your models run, and the optional Claude key for writing help."))),
      h(
        "section.card",
        {},
        h("h2", {}, "Where models run"),
        h(
          "div.backends",
          {},
          ...BACKENDS.map((b) =>
            h(
              `button.backend${b.id === provider ? ".active" : ""}`,
              { type: "button", disabled: s().provider.locked, onclick: () => ((provider = b.id), render()) },
              icon(b.icon),
              h("strong", {}, b.label),
              h("small", {}, b.blurb),
            ),
          ),
        ),
        provider === "local" ? engineEl : null,
        provider === "local"
          ? h(
              "details.engine-advanced",
              {},
              h("summary", {}, "Advanced"),
              h(
                "div.fields",
                {},
                select("engineBuild", "Engine build", { auto: "Automatic: Metal on Apple Silicon, Vulkan on PCs", vulkan: "Vulkan (any recent graphics card)", cuda: "CUDA (NVIDIA on Windows)", cpu: "Processor only" }, { help: "Used the next time you install or reinstall the engine." }),
                field("engineBinary", "Use my own build", { placeholder: "/path/to/stable-diffusion.cpp/build/bin", help: "A folder with sd-server and sd-cli, if you built stable-diffusion.cpp yourself (e.g. for ROCm or Linux on ARM)." }),
                field("engineIdleMinutes", "Free the memory after (minutes without a job)", { type: "number" }),
                field("engineRelease", "Pin an engine release", { placeholder: "Newest (e.g. master-1234-abcdef0)", help: "Leave empty to install the newest upstream release." }),
                field("modelMirror", "Download models from a mirror", { placeholder: "https://huggingface.co", help: "The same files from a Hugging Face mirror, for places where Hugging Face is slow or blocked (e.g. https://hf-mirror.com). Also read from HF_ENDPOINT." }),
              ),
            )
          : null,
        provider === "comfy"
          ? h(
              "div.fields",
              {},
              field("comfyUrl", "ComfyUI address", { placeholder: "https://abc123xyz-8188.proxy.runpod.net", help: "On RunPod: your pod → Connect → HTTP 8188, copy the link. Locally: http://127.0.0.1:8188" }),
              field("comfyToken", "Access token (optional)", { type: "password", secret: true, help: "Only if your server sits behind an auth proxy." }),
            )
          : null,
        provider === "runpod"
          ? h(
              "div.fields",
              {},
              field("runpodEndpoint", "Endpoint ID", { placeholder: "e.g. 4h3k9xyzabcd", help: "RunPod → Serverless → your endpoint. Set it up with the files in runpod/ (see its README)." }),
              field("runpodKey", "API key", { type: "password", secret: true, placeholder: "rpa_…", help: "RunPod → Settings → API Keys. Stored on this machine only." }),
              field("runpodConcurrency", "Jobs at once", { type: "number", help: "How many generations to send in parallel (your endpoint's max workers)." }),
            )
          : null,
        h(
          "div.row",
          {},
          h(`button.btn.primary${testing ? ".busy" : ""}`, { type: "button", disabled: testing, onclick: saveAndTest }, testing ? "Testing…" : "Save and test"),
          result ? h(`span.status-inline.${result.ok ? "ok" : "bad"}`, {}, icon(result.ok ? "check" : "alert"), result.label) : null,
        ),
        result?.apps && Object.keys(result.apps).length
          ? h(
              "ul.readiness",
              {},
              ...Object.entries(result.apps).map(([id, r]) =>
                h(`li.${r.ready ? "ok" : "bad"}`, {}, icon(r.ready ? "check" : "alert"), h("strong", {}, state.boot.apps.find((a) => a.id === id)?.label ?? id), r.ready ? " ready" : r.reason ? ` ${r.reason}` : ` needs ${r.missing.map((m) => m.name).join(", ")}`),
              ),
            )
          : null,
      ),
      h(
        "section.card",
        {},
        h("h2", {}, "Writing help (Claude)"),
        h("p.muted", {}, "Improves prompts and writes ad scripts from your brand profile. Optional: without it Kino uses built-in rules and templates."),
        h("p", {}, h(`span.status-inline.${claude.available ? "ok" : "warn"}`, {}, icon(claude.available ? "check" : "info"), claude.available ? `On · ${claude.model}` : claude.reason)),
        h("div.fields", {}, field("anthropicKey", "Claude API key", { type: "password", secret: true, placeholder: "sk-ant-…", help: "From platform.claude.com. Stored on this machine only." }), field("anthropicModel", "Model", { placeholder: "claude-opus-5-5" })),
        h("div.row", {}, h(`button.btn${testing ? ".busy" : ""}`, { type: "button", disabled: testing, onclick: saveAndTest }, "Save")),
      ),
      h(
        "section.card",
        {},
        h("h2", {}, "Posting"),
        h(
          "p.muted",
          {},
          "When a scheduled post is due, Kino sends it here: the words, the hashtags and the files. A Zapier, Make or n8n webhook (or Buffer through them) takes it on to Instagram, TikTok, Facebook and the rest. Without one, Kino reminds you to post by hand. ",
          h("a.link", { href: "https://github.com/JamesLiuZX/kino/blob/main/docs/posting.md", target: "_blank", rel: "noopener" }, "How to set it up"),
        ),
        h(
          "div.fields",
          {},
          field("postWebhook", "Webhook", { type: "password", secret: true, placeholder: "https://hooks.zapier.com/hooks/catch/…", help: "Kept like a password: for most services the address is the key." }),
          field("postSecret", "Signing secret (optional)", { type: "password", secret: true, help: "Kino signs what it sends with it (X-Kino-Signature), so your workflow can check it came from you." }),
        ),
        h(
          "div.row",
          {},
          h(`button.btn${testing ? ".busy" : ""}`, { type: "button", disabled: testing, onclick: saveAndTest }, "Save"),
          state.boot.posting?.webhook ? h("button.btn.ghost", { type: "button", onclick: testWebhook }, icon("send"), "Send a test") : null,
        ),
      ),
      h(
        "section.card",
        {},
        h("h2", {}, "Ads and captions"),
        h("div.fields", {}, field("captionFont", "Chinese caption font", { help: "Any font installed on this machine. WenQuanYi Zen Hei and Noto Sans CJK SC both work." })),
        h(
          "p.muted.small",
          {},
          state.boot.ffmpeg
            ? "ffmpeg found: instant camera moves and ad editing are on."
            : "ffmpeg isn't installed, so instant camera moves and the Ad Studio's editor are off. Installing This computer's engine fetches it on Mac and Windows; or install it yourself (brew install ffmpeg, winget install ffmpeg, sudo apt install ffmpeg) and restart Kino.",
        ),
      ),
      h("p.muted.small.center", {}, `Kino ${state.boot.version} · your files stay on this machine, in the data folder next to the app.`),
    )
    renderEngine()
  }

  async function testWebhook(e) {
    const btn = e.currentTarget
    btn.classList.add("busy")
    try {
      const r = await api("/api/posts/test", { method: "POST" })
      toast(r.ok ? `It arrived: the webhook answered ${r.status}. Nothing was posted.` : (r.error ?? `The webhook answered ${r.status}.`), { kind: r.ok ? "ok" : "error", timeout: 7000 })
    } catch (err) {
      fail(err)
    } finally {
      btn.classList.remove("busy")
    }
  }

  // ---------------------------------------------------------- this computer

  const gb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`)
  const appLabel = (id) => {
    const app = state.boot.apps.find((a) => a.id === id)
    const tool = app && toolById(app.tool)?.label
    return !app ? id : !tool || app.label.startsWith(tool) ? app.label : `${tool} · ${app.label}`
  }

  async function act(path, { method = "POST", body } = {}) {
    try {
      state.engine = await api(path, { method, body })
      renderEngine()
    } catch (e) {
      fail(e)
    }
  }

  function progress(task) {
    const pct = task.total ? Math.min(100, (task.received / task.total) * 100) : null
    return h(
      "div.engine-progress",
      {},
      h("div.bar", {}, h("i", { style: { width: `${pct ?? 3}%` } })),
      h("small.mono", {}, task.phase, pct !== null ? ` · ${gb(task.received)} of ${gb(task.total)}` : ""),
    )
  }

  function packCard(p, st) {
    const partial = p.files.some((f) => f.partial > 0)
    const busy = p.download && !p.download.error
    return h(
      `div.pack${p.ready ? ".ready" : ""}`,
      {},
      h("div.pack-head", {}, h("strong", {}, p.label), h("small.mono.muted", {}, p.model)),
      h("p.small", {}, p.blurb),
      h("small.muted", {}, "Makes: ", p.apps.map(appLabel).join(" · ")),
      h(
        "div.pack-meta",
        {},
        h("span.mono", {}, p.bytes ? gb(p.bytes) : "size shown when it starts"),
        h(`span.mono.${p.fits ? "ok" : "warn"}`, { title: p.fits ? "" : `This computer has ${st.memoryGb} GB` }, `${p.fits ? "" : "needs "}${p.memoryGb} GB+ memory`),
      ),
      busy ? progress(p.download) : null,
      p.download?.error ? h("small.engine-error", {}, p.download.error) : null,
      h(
        "div.row",
        {},
        p.ready
          ? [h("span.status-inline.ok", {}, icon("check"), "Ready"), h("button.btn.small.ghost", { type: "button", onclick: () => remove(p) }, icon("trash"), "Remove")]
          : busy
            ? h("button.btn.small", { type: "button", onclick: () => act(`/api/engine/packs/${p.id}/cancel`) }, "Pause")
            : h("button.btn.small.accent", { type: "button", onclick: () => act(`/api/engine/packs/${p.id}/download`) }, icon("download"), partial ? "Resume" : "Download"),
      ),
    )
  }

  function remove(p) {
    if (!confirm(`Remove the ${p.label} pack? Its model files${p.bytes ? ` (${gb(p.bytes)})` : ""} are deleted from this computer; you can download them again any time.`)) return
    act(`/api/engine/packs/${p.id}`, { method: "DELETE" })
  }

  function renderEngine() {
    const st = state.engine
    if (!st) return replace(engineEl, h("p.muted.small", {}, "Checking this computer…"))
    const task = st.install
    const busy = task && !task.error
    const build = () => el.querySelector('[data-key="engineBuild"]')?.value
    replace(
      engineEl,
      h(
        "div.engine-head",
        {},
        h(
          "div",
          {},
          h("strong", {}, "Engine"),
          h(
            "small.muted",
            {},
            st.installed ? ` stable-diffusion.cpp · ${st.custom ? "your own build" : [st.release, st.build].filter(Boolean).join(" · ")}` : " stable-diffusion.cpp, one small program (tens of MB)",
          ),
        ),
        h(
          "div.row",
          {},
          st.running ? h("button.btn.small.ghost", { type: "button", title: "Unload the model now", onclick: () => act("/api/engine/stop") }, "Free memory") : null,
          busy
            ? h("button.btn.small", { type: "button", onclick: () => act("/api/engine/install/cancel") }, "Cancel")
            : st.custom
              ? null
              : h(`button.btn.small${st.installed ? "" : ".accent"}`, { type: "button", onclick: () => act("/api/engine/install", { body: { build: build() } }) }, icon(st.installed ? "refresh" : "download"), st.installed ? "Reinstall" : "Install the engine"),
        ),
      ),
      busy ? progress(task) : null,
      task?.error ? h("small.engine-error", {}, task.error) : null,
      st.ffmpegError ? h("small.engine-error", {}, st.ffmpegError) : null,
      h(
        "p.muted.small",
        {},
        `This computer has ${st.memoryGb} GB of memory${st.freeGb !== null ? ` and ${st.freeGb} GB free disk` : ""}. Model packs download once and stay in ${st.dir}.`,
        st.installed && st.packs.some((p) => p.ready) ? null : [" New to this? ", h("a.link", { href: "#/welcome" }, "Set it all up in one go")],
      ),
      h("div.packs", {}, ...st.packs.map((p) => packCard(p, st))),
    )
  }

  if (!state.engine) api("/api/engine").then((st) => ((state.engine = st), renderEngine()), () => {})
  const offs = [on("boot", render), on("engine", renderEngine)]
  render()
  return () => offs.forEach((off) => off())
}

/** The web demo has nothing to connect: say what runs here and where the full studio is. */
function mountWebSettings(root) {
  const repo = fullStudioUrl()
  const cloud = !!state.boot.web?.cloud
  const deviceEl = h("span", {}, "in your browser")
  window.kinoDemo
    ?.device?.()
    .then((d) => (deviceEl.textContent = d === "webgpu" ? "on your graphics chip (WebGPU)" : "on your processor (WebAssembly)"))
    .catch(() => {})
  const keyInput = h("input.input", { type: "password", placeholder: cloud ? "Saved in this browser. Paste a new key to replace it." : "Paste your fal.ai key", autocomplete: "off", spellcheck: "false" })
  // The engine reads the key when the page loads, so a reload switches it over.
  const setKey = (key) => (window.kinoDemo.cloud.set(key), location.reload())
  const saveKey = () => {
    const key = keyInput.value.trim()
    if (!key) return toast("Paste a key first.", { kind: "error" })
    setKey(key)
  }
  root.append(
    h(
      "div.page.settings",
      {},
      h("header.page-head", {}, h("div", {}, h("h1", {}, "Settings"), h("p.muted", {}, cloud ? "Kino on the web, with the AI apps running on fal.ai through your own key." : "Kino on the web: the real interface, in your browser. Add a fal.ai key to make everything for real."))),
      h(
        "section.card",
        {},
        h("h2", {}, "Make it for real with fal.ai"),
        h("p.muted", {}, "The AI apps run on fal.ai with the same open models as the desktop studio: Z-Image and Qwen Image for pictures, Qwen Image Edit, LTX-2 and Wan 2.2 for video, InfiniteTalk for talking photos, SeedVR2 for upscaling. fal.ai bills your account per result; Kino adds nothing on top."),
        h(
          "label.field",
          {},
          h("span", {}, "fal.ai key", cloud ? h("small.muted", {}, " (saved)") : null),
          keyInput,
          h("small.muted", {}, "Kept in this browser and sent only to fal.ai. A key made just for Kino is easy to revoke later. ", h("a.link", { href: "https://fal.ai/dashboard/keys", target: "_blank", rel: "noopener" }, "Get a key"), "."),
        ),
        h(
          "div.row",
          {},
          h("button.btn.primary", { type: "button", onclick: saveKey }, icon("check"), cloud ? "Replace the key" : "Save the key"),
          cloud ? h("button.btn.ghost", { type: "button", onclick: () => setKey("") }, "Forget the key") : null,
        ),
      ),
      h(
        "section.card",
        {},
        h("h2", {}, "What runs here"),
        h(
          "ul.readiness",
          {},
          cloud
            ? h("li.ok", {}, icon("check"), h("strong", {}, "Real AI, on fal.ai: "), "images, photo edits, cut-outs, video with sound, talking photos, upscaling and smoother motion, with your key.")
            : h("li.ok", {}, icon("check"), h("strong", {}, "Real AI, on this device: "), "background removal (IS-Net) and photo upscaling (Real-ESRGAN), run ", deviceEl, ". Each model downloads once, the first time you use it."),
          h("li.ok", {}, icon("check"), h("strong", {}, "Real, in your browser: "), "camera moves, reframing for each platform, the ad script, the compliance check, and the edit with captions, end card and music."),
          h("li.ok", {}, icon("check"), h("strong", {}, "Kept: "), "your library, recipes and runs stay in this browser between visits. Nothing goes to Kino's site. Clearing the site's data clears them, so download what you want to keep."),
          cloud ? null : h("li.bad", {}, icon("info"), h("strong", {}, "Stand-ins: "), "generated images, AI video, photo edits, talking photos and video upscaling, until you add a fal.ai key above."),
        ),
        h(
          "div.row",
          {},
          h("a.btn", { href: repo, target: "_blank", rel: "noopener" }, icon("download"), "Get the desktop app"),
          h("a.btn.ghost", { href: `${repo}/runpod`, target: "_blank", rel: "noopener" }, icon("cpu"), "Run it on your own GPU"),
        ),
      ),
      h("p.muted.small.center", {}, "Made by ", h("a.link", { href: "https://jamesliuzx.com/projects/kino", target: "_blank", rel: "noopener" }, "James Liu"), " · read the case study"),
    ),
  )
  return () => {}
}

