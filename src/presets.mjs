// The vocabulary of the studio: aspect ratios, camera moves, looks and sound.
// One preset feeds three places, so they never drift apart:
//   phrase  -> appended to the prompt for the AI video models
//   preview -> CSS keyframes the picker cards loop (no video files to ship)
//   draft   -> the ffmpeg camera move the instant, GPU-free mode renders

// ResolutionSelector's own strings (comfy_extras/nodes_resolution.py); passed to
// that node verbatim, and mirrored by sizeFor() for models that take width/height.
export const ASPECTS = [
  { id: "9:16", label: "9:16", hint: "TikTok · Reels", w: 9, h: 16, selector: "9:16 (Portrait Widescreen)" },
  { id: "1:1", label: "1:1", hint: "Feed", w: 1, h: 1, selector: "1:1 (Square)" },
  { id: "4:5", label: "4:5", hint: "Meta feed", w: 4, h: 5, selector: "3:4 (Portrait Standard)" },
  { id: "16:9", label: "16:9", hint: "YouTube", w: 16, h: 9, selector: "16:9 (Widescreen)" },
  { id: "3:4", label: "3:4", hint: "Portrait", w: 3, h: 4, selector: "3:4 (Portrait Standard)" },
  { id: "4:3", label: "4:3", hint: "Classic", w: 4, h: 3, selector: "4:3 (Standard)" },
  { id: "2:3", label: "2:3", hint: "Poster", w: 2, h: 3, selector: "2:3 (Portrait Photo)" },
  { id: "3:2", label: "3:2", hint: "Photo", w: 3, h: 2, selector: "3:2 (Photo)" },
  { id: "21:9", label: "21:9", hint: "Cinema", w: 21, h: 9, selector: "21:9 (Ultrawide)" },
]

export const aspectById = (id) => ASPECTS.find((a) => a.id === id) ?? ASPECTS[0]

/** Same arithmetic as ResolutionSelector: target megapixels, snapped to a multiple. */
export function sizeFor(aspectId, megapixels = 1, multiple = 64) {
  const a = aspectById(aspectId)
  const scale = Math.sqrt((megapixels * 1024 * 1024) / (a.w * a.h))
  return {
    width: Math.max(multiple, Math.round((a.w * scale) / multiple) * multiple),
    height: Math.max(multiple, Math.round((a.h * scale) / multiple) * multiple),
  }
}

// Camera moves. `draft` drives src/media/motion.mjs:
//   z: [start zoom, end zoom]  x/y: [start, end] pan position, 0..1 of the free margin
//   rot: [start°, end°]  shake: handheld amplitude  ease: in | out | inout | linear
export const CAMERA = [
  { id: "static", label: "Static", group: "Classic", phrase: "the camera is locked off on a tripod, completely still",
    preview: [{ transform: "scale(1.04)" }, { transform: "scale(1.04)" }], draft: { z: [1.04, 1.04], x: [0.5, 0.5], y: [0.5, 0.5] } },
  { id: "push-in", label: "Push in", group: "Classic", phrase: "the camera executes a slow, deliberate push-in toward the subject",
    preview: [{ transform: "scale(1)" }, { transform: "scale(1.28)" }], draft: { z: [1, 1.3], x: [0.5, 0.5], y: [0.5, 0.5], ease: "inout" } },
  { id: "pull-out", label: "Pull out", group: "Classic", phrase: "the camera slowly pulls back to reveal the wider scene",
    preview: [{ transform: "scale(1.3)" }, { transform: "scale(1)" }], draft: { z: [1.3, 1], x: [0.5, 0.5], y: [0.5, 0.5], ease: "inout" } },
  { id: "pan-left", label: "Pan left", group: "Classic", phrase: "the camera pans smoothly to the left",
    preview: [{ transform: "scale(1.2) translateX(7%)" }, { transform: "scale(1.2) translateX(-7%)" }], draft: { z: [1.2, 1.2], x: [0.85, 0.15], y: [0.5, 0.5] } },
  { id: "pan-right", label: "Pan right", group: "Classic", phrase: "the camera pans smoothly to the right",
    preview: [{ transform: "scale(1.2) translateX(-7%)" }, { transform: "scale(1.2) translateX(7%)" }], draft: { z: [1.2, 1.2], x: [0.15, 0.85], y: [0.5, 0.5] } },
  { id: "tilt-up", label: "Tilt up", group: "Classic", phrase: "the camera tilts upward, rising to reveal what is above",
    preview: [{ transform: "scale(1.2) translateY(-7%)" }, { transform: "scale(1.2) translateY(7%)" }], draft: { z: [1.2, 1.2], x: [0.5, 0.5], y: [0.85, 0.15] } },
  { id: "tilt-down", label: "Tilt down", group: "Classic", phrase: "the camera tilts downward",
    preview: [{ transform: "scale(1.2) translateY(7%)" }, { transform: "scale(1.2) translateY(-7%)" }], draft: { z: [1.2, 1.2], x: [0.5, 0.5], y: [0.15, 0.85] } },
  { id: "orbit", label: "Orbit", group: "Dynamic", phrase: "the camera arcs around the subject in a smooth orbit, keeping it centered",
    preview: [{ transform: "perspective(700px) rotateY(-14deg) scale(1.22)" }, { transform: "perspective(700px) rotateY(14deg) scale(1.22)" }],
    draft: { z: [1.25, 1.25], x: [0.2, 0.8], y: [0.5, 0.5], rot: [-2, 2], ease: "inout" } },
  { id: "crash-zoom", label: "Crash zoom", group: "Dynamic", phrase: "a sudden, fast crash zoom slams into the subject",
    preview: [{ transform: "scale(1)", offset: 0 }, { transform: "scale(1)", offset: 0.55 }, { transform: "scale(1.9)", offset: 1 }],
    draft: { z: [1, 1.9], x: [0.5, 0.5], y: [0.45, 0.45], ease: "in" } },
  { id: "dolly-zoom", label: "Dolly zoom", group: "Dynamic", phrase: "a vertigo dolly zoom: the camera moves in while the lens zooms out, warping the background",
    preview: [{ transform: "scale(1.35) perspective(500px) translateZ(0)" }, { transform: "scale(1.05) perspective(500px) translateZ(40px)" }],
    draft: { z: [1.35, 1.05], x: [0.5, 0.5], y: [0.5, 0.5], ease: "inout" } },
  { id: "whip-pan", label: "Whip pan", group: "Dynamic", phrase: "a fast whip pan with motion blur",
    preview: [{ transform: "scale(1.2) translateX(8%)", filter: "blur(0)", offset: 0 }, { transform: "scale(1.2) translateX(0)", filter: "blur(4px)", offset: 0.5 }, { transform: "scale(1.2) translateX(-8%)", filter: "blur(0)", offset: 1 }],
    draft: { z: [1.2, 1.2], x: [0.95, 0.05], y: [0.5, 0.5], ease: "inout", blur: true } },
  { id: "handheld", label: "Handheld", group: "Dynamic", phrase: "handheld camera with natural, subtle shake, documentary feel",
    preview: [{ transform: "scale(1.15) translate(0,0) rotate(0)" }, { transform: "scale(1.15) translate(1%,-1%) rotate(0.6deg)" }, { transform: "scale(1.15) translate(-1%,1%) rotate(-0.5deg)" }, { transform: "scale(1.15) translate(0,0) rotate(0)" }],
    draft: { z: [1.15, 1.18], x: [0.5, 0.5], y: [0.5, 0.5], shake: 0.012 } },
  { id: "spiral", label: "Spiral in", group: "Dynamic", phrase: "the camera spirals in toward the subject, rotating as it approaches",
    preview: [{ transform: "scale(1.15) rotate(-8deg)" }, { transform: "scale(1.45) rotate(8deg)" }], draft: { z: [1.3, 1.6], x: [0.5, 0.5], y: [0.5, 0.5], rot: [-8, 8], ease: "inout" } },
  { id: "crane-up", label: "Crane up", group: "Drone", phrase: "a crane shot rising smoothly upward and away",
    preview: [{ transform: "scale(1.3) translateY(-6%)" }, { transform: "scale(1.1) translateY(6%)" }], draft: { z: [1.3, 1.1], x: [0.5, 0.5], y: [0.8, 0.2], ease: "inout" } },
  { id: "fpv-dive", label: "FPV dive", group: "Drone", phrase: "an FPV drone dives fast toward the subject, banking as it flies",
    preview: [{ transform: "scale(1) rotate(-4deg) translateY(-6%)" }, { transform: "scale(1.7) rotate(5deg) translateY(4%)" }], draft: { z: [1.05, 1.75], x: [0.45, 0.55], y: [0.2, 0.6], rot: [-4, 5], ease: "in" } },
  { id: "flyover", label: "Fly-over", group: "Drone", phrase: "an aerial drone glides forward over the scene",
    preview: [{ transform: "perspective(600px) rotateX(18deg) scale(1.3) translateY(8%)" }, { transform: "perspective(600px) rotateX(18deg) scale(1.3) translateY(-8%)" }],
    draft: { z: [1.3, 1.4], x: [0.5, 0.5], y: [0.9, 0.1] } },
  { id: "bullet-time", label: "Bullet time", group: "FX", phrase: "bullet time: the action freezes while the camera sweeps around it",
    preview: [{ transform: "perspective(600px) rotateY(-24deg) scale(1.25)" }, { transform: "perspective(600px) rotateY(24deg) scale(1.25)" }],
    draft: { z: [1.3, 1.3], x: [0.1, 0.9], y: [0.5, 0.5], rot: [-3, 3], ease: "linear" } },
  { id: "rack-focus", label: "Rack focus", group: "FX", phrase: "the focus racks from the foreground to the subject",
    preview: [{ transform: "scale(1.08)", filter: "blur(3px)" }, { transform: "scale(1.12)", filter: "blur(0)" }], draft: { z: [1.08, 1.14], x: [0.5, 0.5], y: [0.5, 0.5], focus: true } },
  { id: "product-spin", label: "Product spin", group: "Commerce", phrase: "the product turns slowly on a turntable, studio lighting gliding across its surface",
    preview: [{ transform: "perspective(600px) rotateY(-20deg) scale(1.1)" }, { transform: "perspective(600px) rotateY(20deg) scale(1.1)" }],
    draft: { z: [1.12, 1.12], x: [0.35, 0.65], y: [0.5, 0.5], rot: [-1.5, 1.5], ease: "inout" } },
  { id: "hero-reveal", label: "Hero reveal", group: "Commerce", phrase: "a slow hero reveal: light sweeps in and the camera rises to the product",
    preview: [{ transform: "scale(1.35) translateY(8%)", filter: "brightness(0.6)" }, { transform: "scale(1.08) translateY(0)", filter: "brightness(1)" }],
    draft: { z: [1.35, 1.08], x: [0.5, 0.5], y: [0.85, 0.5], ease: "out", fadeIn: true } },
]

export const cameraById = (id) => CAMERA.find((c) => c.id === id)

export const STYLES = [
  { id: "none", label: "No style", suffix: "" },
  { id: "cinematic", label: "Cinematic", suffix: "cinematic film still, anamorphic lens, soft volumetric light, rich color grade" },
  { id: "product", label: "Product studio", suffix: "professional product photography, seamless studio backdrop, softbox lighting, crisp detail, commercial" },
  { id: "ugc", label: "Phone UGC", suffix: "shot on a smartphone, natural window light, authentic and candid, slight grain" },
  { id: "editorial", label: "Editorial", suffix: "editorial fashion photography, magazine cover quality, sharp, dramatic lighting" },
  { id: "warm-home", label: "Warm home", suffix: "cozy Singapore home interior, warm afternoon light, lived-in and inviting" },
  { id: "ink", label: "Chinese ink", suffix: "traditional Chinese ink wash painting, xuan paper texture, elegant brushwork" },
  { id: "anime", label: "Anime", suffix: "anime key visual, clean line art, vibrant cel shading" },
  { id: "3d", label: "3D render", suffix: "high-end 3D render, octane, soft global illumination, clay and glass materials" },
  { id: "watercolor", label: "Watercolor", suffix: "loose watercolor illustration, soft bleeding pigments, paper texture" },
  { id: "noir", label: "Neon noir", suffix: "neon noir, wet streets, magenta and cyan rim light, moody" },
  { id: "flat", label: "Flat graphic", suffix: "flat vector illustration, bold shapes, limited palette, poster design" },
  { id: "vintage", label: "Vintage film", suffix: "35mm film photograph, Kodak Portra colors, gentle halation and grain" },
]

export const styleById = (id) => STYLES.find((s) => s.id === id) ?? STYLES[0]

// Sound for models that generate native audio (MiniMax H3).
export const AUDIO = [
  { id: "ambient", label: "Natural ambience", phrase: "natural ambient room tone and soft, realistic sound effects that match the action" },
  { id: "upbeat", label: "Upbeat music", phrase: "a bright, upbeat modern pop instrumental with a clean beat" },
  { id: "cinematic", label: "Cinematic score", phrase: "a swelling cinematic orchestral score with deep low strings" },
  { id: "asmr", label: "ASMR close-up", phrase: "intimate close-up ASMR sounds, gentle textures, no music" },
  { id: "warm-zh", label: "Warm Mandarin voice", phrase: "a warm, friendly female voice speaking softly in Mandarin, with gentle acoustic music underneath" },
  { id: "warm-en", label: "Warm English voice", phrase: "a warm, friendly voice speaking clearly in English, with light acoustic music underneath" },
  { id: "silent", label: "Silent", phrase: "near silence", strip: true },
]

export const audioById = (id) => AUDIO.find((a) => a.id === id) ?? AUDIO[0]
