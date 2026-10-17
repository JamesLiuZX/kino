// Where ads run, at what size, and which parts of the frame the app's own UI
// covers (username, caption, buttons). Text kept out of those bands stays
// readable. Margins are fractions of the frame, rounded from TikTok's and
// Meta's published ad safe-zone guides; they move a little between app
// versions, so keep a few percent to spare.

export const PLATFORMS = {
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    aspect: "9:16",
    size: [1080, 1920],
    safe: { top: 0.08, bottom: 0.26, left: 0.06, right: 0.14 },
    seconds: [9, 30],
    tip: "Hook in the first second, sound on. 9–21 s performs best.",
  },
  reels: {
    id: "reels",
    label: "Facebook & Instagram Reels",
    aspect: "9:16",
    size: [1080, 1920],
    safe: { top: 0.14, bottom: 0.35, left: 0.06, right: 0.12 },
    seconds: [9, 30],
    tip: "Keep text in the middle band: Reels covers the bottom third.",
  },
  feed: {
    id: "feed",
    label: "Facebook & Instagram feed",
    aspect: "4:5",
    size: [1080, 1350],
    safe: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 },
    seconds: [6, 20],
    tip: "Most feed viewers watch muted: let the captions tell the story.",
  },
  square: {
    id: "square",
    label: "Square (feed and marketplace)",
    aspect: "1:1",
    size: [1080, 1080],
    safe: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 },
    seconds: [6, 20],
    tip: "Works almost everywhere, including WhatsApp status.",
  },
}

export const platformById = (id) => PLATFORMS[id] ?? PLATFORMS.tiktok
