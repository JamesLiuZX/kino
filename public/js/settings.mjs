// Settings: where the models run (demo, your ComfyUI, RunPod Serverless), the
// optional Claude key, and a connection test that says what's actually ready.

import { h, icon, api, toast, fail, replace } from "./ui.mjs"
import { state, on, emit, isWeb, fullStudioUrl } from "./state.mjs"

const BACKENDS = [
  { id: "mock", label: "Demo", icon: "sparkles", blurb: "No GPU. Placeholder results made on this computer, for trying every tool and the Ad Studio." },
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
  root.append(el)

  const field = (key, label, { type = "text", placeholder, help, secret } = {}) => {
    const cur = s()[key]
    const input = h("input.input", { type, placeholder: secret && cur?.set ? `Saved (${cur.hint}). Type to replace.` : placeholder, value: secret ? "" : cur?.value ?? "", disabled: cur?.locked, autocomplete: "off", spellcheck: "false" })
    input.dataset.key = key
    input.dataset.secret = secret ? "1" : ""
    return h("label.field", {}, h("span", {}, label, cur?.locked ? h("small.muted", {}, " (set by environment)") : null), input, help ? h("small.muted", {}, help) : null)
  }

  function collect() {
    const out = { provider }
    for (const input of el.querySelectorAll("input[data-key]")) {
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
                h(`li.${r.ready ? "ok" : "bad"}`, {}, icon(r.ready ? "check" : "alert"), h("strong", {}, state.boot.apps.find((a) => a.id === id)?.label ?? id), r.ready ? " ready" : ` needs ${r.missing.map((m) => m.name).join(", ")}`),
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
        h("h2", {}, "Ads and captions"),
        h("div.fields", {}, field("captionFont", "Chinese caption font", { help: "Any font installed on this machine. WenQuanYi Zen Hei and Noto Sans CJK SC both work." })),
        h("p.muted.small", {}, state.boot.ffmpeg ? "ffmpeg found: instant camera moves and ad editing are on." : "ffmpeg isn't installed: install it to enable instant camera moves and the Ad Studio's editor."),
      ),
      h("p.muted.small.center", {}, `Kino ${state.boot.version} · your files stay on this machine, in the data folder next to the app.`),
    )
  }

  const offs = [on("boot", render)]
  render()
  return () => offs.forEach((off) => off())
}

/** The web demo has nothing to connect: say what runs here and where the full studio is. */
function mountWebSettings(root) {
  const repo = fullStudioUrl()
  root.append(
    h(
      "div.page.settings",
      {},
      h("header.page-head", {}, h("div", {}, h("h1", {}, "Settings"), h("p.muted", {}, "This is Kino's web demo: the real interface, running entirely in your browser."))),
      h(
        "section.card",
        {},
        h("h2", {}, "What runs here"),
        h(
          "ul.readiness",
          {},
          h("li.ok", {}, icon("check"), h("strong", {}, "Real: "), "camera moves, the ad script, the compliance check, and the edit with captions, end card and music."),
          h("li.ok", {}, icon("check"), h("strong", {}, "Private: "), "photos and recordings you add stay in this tab. Nothing is uploaded, and nothing is saved: reload to start fresh."),
          h("li.bad", {}, icon("info"), h("strong", {}, "Stand-ins: "), "images, AI video, photo edits and talking photos. Those need the models on a GPU."),
        ),
        h(
          "div.row",
          {},
          h("a.btn.primary", { href: repo, target: "_blank", rel: "noopener" }, icon("download"), "Get Kino on GitHub"),
          h("a.btn", { href: `${repo}/runpod`, target: "_blank", rel: "noopener" }, icon("cpu"), "Connect a GPU (RunPod guide)"),
        ),
      ),
      h("p.muted.small.center", {}, "Made by ", h("a.link", { href: "https://jamesliuzx.com/projects/kino", target: "_blank", rel: "noopener" }, "James Liu"), " · read the case study"),
    ),
  )
  return () => {}
}

