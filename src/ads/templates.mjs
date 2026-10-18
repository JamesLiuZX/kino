// Template storyboards, built only from the brand's own approved words, so
// every template ad is compliant by construction. Pure: the server's writer
// uses it when there's no Claude key, and the web demo runs it in the browser.

import { ANGLES, normalizeBrief } from "./schema.mjs"

const PEOPLE = {
  grandma: "a cheerful Singaporean Chinese grandmother in her sixties",
  couple: "an elderly Singaporean Chinese couple",
  daughter: "a Singaporean woman in her thirties",
  uncle: "a Singaporean Chinese man in his sixties",
}

const T = (zh, en) => ({ zh, en })

function templates(brand) {
  const L = (field) => (lang) => brand[field]?.[lang] ?? ""
  const claim = (i) => (lang) => brand.claims.approved[lang][i] ?? ""
  const offerLine = (lang) => `${brand.offer.price} · ${brand.offer.bundle[lang]}`
  const moment = (i) => (lang) => brand.moments?.[lang]?.[i] ?? ""
  const product = (lang) => brand.product.short?.[lang] ?? brand.product.name[lang]

  return {
    ritual: [
      { role: "hook", seconds: 2.5, source: "product-photo", camera: "hero-reveal", visual: "warm evening light slowly sweeps across the product on a wooden side table, soft steam from a cup of tea in the background", caption: T("忙了一天，给自己一点温暖", "After a long day, a little warmth") },
      { role: "moment", seconds: 3, source: "generate", camera: "push-in", visual: `${PEOPLE.grandma} sitting on a sofa in a cosy HDB flat in the evening, gently rolling her shoulders and smiling, warm lamp light`, caption: (lang) => (lang === "zh" ? `${moment(5)(lang)}，喷一喷` : `${cap(moment(5)(lang))}, a quick spray`) },
      { role: "how", seconds: 3, source: "generate", camera: "static", visual: "close-up of a hand pressing gently on a shoulder over a soft cotton shirt, warm golden light, calm and relaxed", caption: claim(0) },
      { role: "product", seconds: 3, source: "product-photo", camera: "product-spin", visual: "studio light glides across the bottle and box, soft shadows, clean cream background", caption: claim(2) },
      { role: "offer", seconds: 2.5, source: "product-photo", camera: "push-in", visual: "the product in soft daylight, gentle push toward the label", caption: offerLine },
    ],
    gift: [
      { role: "hook", seconds: 2.5, source: "generate", camera: "push-in", visual: `${PEOPLE.daughter} handing a small wrapped gift to her smiling elderly father in a bright HDB living room, warm afternoon light`, caption: T("给爸妈的一份温暖", "A warm gift for Mum and Dad") },
      { role: "product", seconds: 3, source: "product-photo", camera: "hero-reveal", visual: "warm light rises over the bottle and box like a gift being unwrapped", caption: product },
      { role: "moment", seconds: 3, source: "generate", camera: "pan-right", visual: `${PEOPLE.couple} laughing together on a park bench in Singapore in the morning after tai chi, relaxed, soft sunlight through trees`, caption: (lang) => cap(moment(0)(lang)) },
      { role: "claim", seconds: 3, source: "product-photo", camera: "product-spin", visual: "slow turn of the product, light gliding over the glass", caption: claim(1) },
      { role: "offer", seconds: 2.5, source: "product-photo", camera: "push-in", visual: "the product and box in soft daylight", caption: offerLine },
    ],
    tradition: [
      { role: "hook", seconds: 3, source: "generate", camera: "push-in", visual: "macro shot of golden myrrh and frankincense resin pieces on an old wooden table, soft window light, rich warm tones, gentle dust in the air", caption: T("两千年的传统香料", "A 2,000-year-old tradition") },
      { role: "moment", seconds: 3, source: "generate", camera: "flyover", visual: "silhouettes of an ancient spice caravan crossing desert dunes at sunset, warm haze, cinematic", caption: T("没药与乳香", "Myrrh and frankincense") },
      { role: "product", seconds: 3, source: "product-photo", camera: "hero-reveal", visual: "warm light reveals the product on a wooden surface", caption: T("现在做成了方便的喷雾", "Now in an easy spray") },
      { role: "how", seconds: 3, source: "generate", camera: "static", visual: "close-up of a hand pressing gently on a forearm, warm golden light, calm", caption: claim(0) },
      { role: "offer", seconds: 2.5, source: "product-photo", camera: "push-in", visual: "the product and box in soft daylight", caption: offerLine },
    ],
    howto: [
      { role: "hook", seconds: 2, source: "product-photo", camera: "crash-zoom", visual: "bright clean light on the product", caption: T("三步，10秒", "3 steps, 10 seconds") },
      { role: "how", seconds: 3, source: "product-photo", camera: "push-in", visual: "the product in soft daylight, slow push toward the spray nozzle", caption: (lang) => brand.product.usage[lang][0] },
      { role: "how", seconds: 3, source: "generate", camera: "static", visual: "close-up of a palm pressing gently on a shoulder, warm light, relaxed", caption: (lang) => brand.product.usage[lang][2] },
      { role: "moment", seconds: 3, source: "generate", camera: "push-in", visual: `${PEOPLE.grandma} smiling by a sunny window, stretching her arms gently, relaxed`, caption: (lang) => brand.product.usage[lang][3] },
      { role: "offer", seconds: 2.5, source: "product-photo", camera: "push-in", visual: "the product and box in soft daylight", caption: offerLine },
    ],
    offer: [
      { role: "hook", seconds: 2, source: "product-photo", camera: "crash-zoom", visual: "bright clean light on the product and box", caption: T("买3送1", "Buy 3, get 1 free") },
      { role: "product", seconds: 3, source: "product-photo", camera: "product-spin", visual: "slow turn of the product, studio light gliding over the glass", caption: (lang) => (lang === "zh" ? `原价${brand.offer.originalPrice}，现在${brand.offer.price}` : `Was ${brand.offer.originalPrice}, now ${brand.offer.price}`) },
      { role: "claim", seconds: 2.5, source: "product-photo", camera: "push-in", visual: "the product in soft daylight", caption: claim(1) },
      { role: "moment", seconds: 3, source: "generate", camera: "pan-left", visual: `${PEOPLE.couple} opening a delivery parcel at the door of their HDB flat, smiling, bright corridor light`, caption: T("免费送货到家", "Free delivery to your door") },
      { role: "offer", seconds: 2.5, source: "product-photo", camera: "static", visual: "the product and box, calm and steady", caption: (lang) => brand.offer.guarantee[lang] },
    ],
    community: [
      { role: "hook", seconds: 2.5, source: "generate", camera: "handheld", visual: "a group of cheerful Singaporean seniors chatting at a void deck in the morning, natural light, documentary feel", caption: T("新加坡家庭的温暖习惯", "A warm habit in Singapore homes") },
      { role: "moment", seconds: 3, source: "generate", camera: "pan-right", visual: `${PEOPLE.uncle} doing tai chi in a quiet park at sunrise, soft mist, peaceful`, caption: (lang) => cap(moment(0)(lang)) },
      { role: "product", seconds: 3, source: "product-photo", camera: "hero-reveal", visual: "morning light reveals the product on a wooden table", caption: claim(0) },
      { role: "claim", seconds: 3, source: "product-photo", camera: "product-spin", visual: "slow turn of the product", caption: claim(1) },
      { role: "offer", seconds: 2.5, source: "product-photo", camera: "push-in", visual: "the product and box in soft daylight", caption: offerLine },
    ],
  }
}

const HOOKS = {
  ritual: T("忙了一天，给自己一点温暖", "After a long day, a little warmth"),
  gift: T("给爸妈的一份温暖", "A warm gift for Mum and Dad"),
  tradition: T("两千年的传统香料", "A 2,000-year-old tradition"),
  howto: T("三步，10秒", "3 steps, 10 seconds"),
  offer: T("买3送1", "Buy 3, get 1 free"),
  community: T("新加坡家庭的温暖习惯", "A warm habit in Singapore homes"),
}

const HEADLINES = {
  ritual: T("试试没药的温热", "Try the warmth of myrrh"),
  gift: T("送爸妈一份温暖", "Give Mum and Dad some warmth"),
  tradition: T("古老香料，每天好用", "An ancient comfort, made easy"),
  howto: T("10秒感受温热", "Warmth in 10 seconds"),
  offer: T("限时买3送1", "Buy 3 Get 1 Free, for now"),
  community: T("试试没药的温热", "Try the warmth of myrrh"),
}

export function templateBrief({ brand, platform = "tiktok", language = "zh", angle = "ritual" }) {
  const lang = language === "en" ? "en" : "zh"
  const pick = (v) => (typeof v === "function" ? v(lang) : v && typeof v === "object" ? v[lang] : v)
  const shots = (templates(brand)[angle] ?? templates(brand).ritual).map((s) => ({ ...s, caption: pick(s.caption), voiceover: "" }))
  const tags = lang === "zh" ? ["没药喷雾", "新加坡", "HerbalBath", "孝顺", "天然"] : ["MyrrhSpray", "Singapore", "HerbalBath", "GiftForParents", "Natural"]
  return normalizeBrief(
    {
      title: `${ANGLES[angle]?.label ?? angle} · template`,
      angle,
      hook: pick(HOOKS[angle] ?? HOOKS.ritual),
      shots,
      endCard: { headline: pick(HEADLINES[angle] ?? HEADLINES.ritual), offer: `${brand.offer.price} · ${brand.offer.bundle[lang]}`, cta: brand.cta[lang] },
      music: "calm",
      postCopy: {
        primaryText:
          lang === "zh"
            ? `${brand.claims.approved.zh[0]}，${brand.claims.approved.zh[1]}。${brand.offer.bundle.zh}，${brand.offer.guarantee.zh}。${brand.cta.zh}`
            : `${brand.claims.approved.en[0]}. ${brand.claims.approved.en[1]}. ${brand.offer.bundle.en}, ${brand.offer.guarantee.en}. ${brand.cta.en}.`,
        headline: lang === "zh" ? `${brand.product.short.zh} ${brand.offer.price}` : `${brand.product.short.en} · ${brand.offer.price}`,
        hashtags: tags,
      },
      notes: "Written from the brand's approved wording; nothing here goes beyond what the website already says.",
    },
    { platform, language: lang, brandId: brand.id },
  )
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
