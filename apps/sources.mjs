// Which official ComfyUI template each GPU app is built from. scripts/build-workflows.mjs
// converts these into workflows/<id>.json; apps/catalog.mjs gives them a face.
// Picked by October 2026 template usage and fit: every one runs on core nodes only,
// so the RunPod side needs ComfyUI and model files, no custom nodes.

export const TEMPLATES_VERSION = "0.11.87" // pinned by ComfyUI 0.41.0's requirements.txt

export const SOURCES = {
  "z-image": { template: "image_z_image_turbo" },
  "qwen-image": { template: "image_qwen_image_2_1_turbo_t2i" },
  "qwen-edit": { template: "image_qwen_image_2_1_turbo_image_edit" },
  "qwen-cutout": { template: "image_qwen_image_2_1_background_removal" },
  "seedvr2-image": { template: "utility_seedvr2_7b_int8_upscale_image" },
  "h3-i2v": { template: "video_fastvideo_fasth3_i2v" },
  "h3-t2v": { template: "video_fastvideo_fasth3_t2v" },
  "wan-ti2v": { template: "video_wan2_2_5B_ti2v" },
  "ltx-talk": { template: "video_ltx2_3_ia2v" },
  "seedvr2-video": { template: "utility_seedvr2_3b_int8_upscale_video" },
  "interpolate": { template: "utility_video_frame_interpolation" },
}
