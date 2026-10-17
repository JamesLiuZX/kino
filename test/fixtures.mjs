// A small UI-format workflow (what ComfyUI's editor saves) exercising the
// conversion edge cases: a seed widget with its "randomize" token, a reroute, a
// primitive driving a converted widget, a bypassed node, and a note.

export function txt2imgUi() {
  return {
    last_node_id: 12,
    nodes: [
      { id: 1, type: "CheckpointLoaderSimple", mode: 0, inputs: [], outputs: [{ name: "MODEL", type: "MODEL", links: [1] }, { name: "CLIP", type: "CLIP", links: [2, 3] }, { name: "VAE", type: "VAE", links: [8] }], widgets_values: ["sd_xl_base_1.0.safetensors"] },
      { id: 2, type: "CLIPTextEncode", mode: 0, title: "Positive", inputs: [{ name: "clip", type: "CLIP", link: 2 }], outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: [4] }], widgets_values: ["a red fox in fresh snow"] },
      { id: 3, type: "CLIPTextEncode", mode: 0, title: "Negative", inputs: [{ name: "clip", type: "CLIP", link: 3 }], outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: [5] }], widgets_values: ["blurry, watermark"] },
      { id: 4, type: "EmptyLatentImage", mode: 0, inputs: [], outputs: [{ name: "LATENT", type: "LATENT", links: [12] }], widgets_values: [1216, 832, 1] },
      {
        id: 5,
        type: "KSampler",
        mode: 0,
        inputs: [
          { name: "model", type: "MODEL", link: 1 },
          { name: "positive", type: "CONDITIONING", link: 4 },
          { name: "negative", type: "CONDITIONING", link: 5 },
          { name: "latent_image", type: "LATENT", link: 6 },
          { name: "seed", type: "INT", widget: { name: "seed" }, link: 11 },
        ],
        outputs: [{ name: "LATENT", type: "LATENT", links: [7] }],
        widgets_values: [123, "randomize", 20, 7, "euler", "normal", 1],
      },
      { id: 6, type: "VAEDecode", mode: 0, inputs: [{ name: "samples", type: "LATENT", link: 7 }, { name: "vae", type: "VAE", link: 9 }], outputs: [{ name: "IMAGE", type: "IMAGE", links: [10] }] },
      { id: 7, type: "SaveImage", mode: 0, inputs: [{ name: "images", type: "IMAGE", link: 10 }], widgets_values: ["Kino"] },
      { id: 8, type: "Reroute", mode: 0, inputs: [{ name: "", type: "*", link: 8 }], outputs: [{ name: "", type: "VAE", links: [9] }] },
      { id: 9, type: "PrimitiveNode", mode: 0, outputs: [{ name: "INT", type: "INT", links: [11], widget: { name: "seed" } }], widgets_values: [777, "fixed"] },
      { id: 10, type: "Note", mode: 0, widgets_values: ["Remember to pick a checkpoint"] },
      { id: 12, type: "LatentUpscale", mode: 4, inputs: [{ name: "samples", type: "LATENT", link: 12 }], outputs: [{ name: "LATENT", type: "LATENT", links: [6] }], widgets_values: ["nearest-exact", 1536, 1024, "disabled"] },
    ],
    links: [
      [1, 1, 0, 5, 0, "MODEL"],
      [2, 1, 1, 2, 0, "CLIP"],
      [3, 1, 1, 3, 0, "CLIP"],
      [4, 2, 0, 5, 1, "CONDITIONING"],
      [5, 3, 0, 5, 2, "CONDITIONING"],
      [6, 12, 0, 5, 3, "LATENT"],
      [7, 5, 0, 6, 0, "LATENT"],
      [8, 1, 2, 8, 0, "VAE"],
      [9, 8, 0, 6, 1, "VAE"],
      [10, 6, 0, 7, 0, "IMAGE"],
      [11, 9, 0, 5, 4, "INT"],
      [12, 4, 0, 12, 0, "LATENT"],
    ],
    version: 0.4,
  }
}

/** The same graph in API format, as ComfyUI's "Export (API)" writes it. */
export function txt2imgApi() {
  return {
    1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" }, _meta: { title: "Load Checkpoint" } },
    2: { class_type: "CLIPTextEncode", inputs: { text: "a red fox in fresh snow", clip: ["1", 1] }, _meta: { title: "Positive" } },
    3: { class_type: "CLIPTextEncode", inputs: { text: "blurry, watermark", clip: ["1", 1] }, _meta: { title: "Negative" } },
    4: { class_type: "EmptyLatentImage", inputs: { width: 1216, height: 832, batch_size: 1 } },
    5: { class_type: "KSampler", inputs: { seed: 777, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
    6: { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    7: { class_type: "SaveImage", inputs: { filename_prefix: "Kino", images: ["6", 0] } },
    8: { class_type: "LoadImage", inputs: { image: "example.png" }, _meta: { title: "Reference" } },
    9: { class_type: "PreviewImage", inputs: { images: ["8", 0] } },
  }
}
