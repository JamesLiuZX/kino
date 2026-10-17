// Minimal PNG encoder (8-bit RGB) and a procedural image generator, so the mock
// provider can return real image files with no image library installed.

import { crc32, deflateSync } from "node:zlib"

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed) >>> 0)
  return Buffer.concat([len, typed, crc])
}

export function encodePng(width, height, rgb) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(8, 8) // bit depth
  header.writeUInt8(2, 9) // colour type: truecolour
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0 // filter: none
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/** mulberry32: small, fast, seeded. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261)

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/**
 * A soft, seeded "placeholder render": a gradient sky, a few glowing blobs and
 * film grain, palette chosen from the prompt so different prompts look
 * different. Clearly not a photo, which is the point of a mock.
 */
export function proceduralImage({ width, height, seed = 1, prompt = "" }) {
  const rand = rng((seed ^ hash(prompt)) >>> 0)
  const baseHue = rand() * 360
  const top = hsl(baseHue, 0.55, 0.62)
  const bottom = hsl((baseHue + 40 + rand() * 80) % 360, 0.6, 0.18)
  const blobs = Array.from({ length: 4 + Math.floor(rand() * 4) }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: (0.12 + rand() * 0.35) * Math.max(width, height),
    c: hsl((baseHue + rand() * 160) % 360, 0.75, 0.55 + rand() * 0.2),
    a: 0.25 + rand() * 0.35,
  }))
  const px = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1)
    for (let x = 0; x < width; x++) {
      let r = top[0] * (1 - t) + bottom[0] * t
      let g = top[1] * (1 - t) + bottom[1] * t
      let b = top[2] * (1 - t) + bottom[2] * t
      for (const bl of blobs) {
        const d = Math.hypot(x - bl.x, y - bl.y) / bl.r
        if (d < 1) {
          const w = (1 - d * d) * bl.a
          r += (bl.c[0] - r) * w
          g += (bl.c[1] - g) * w
          b += (bl.c[2] - b) * w
        }
      }
      const grain = (rand() - 0.5) * 10
      const i = (y * width + x) * 3
      px[i] = Math.max(0, Math.min(255, r + grain))
      px[i + 1] = Math.max(0, Math.min(255, g + grain))
      px[i + 2] = Math.max(0, Math.min(255, b + grain))
    }
  }
  return encodePng(width, height, px)
}
