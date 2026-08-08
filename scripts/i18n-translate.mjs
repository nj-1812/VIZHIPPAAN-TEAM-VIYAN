/**
 * Generates src/i18n/translations/<code>.json from scripts/out/strings.json
 * using the Lovable AI Gateway. Idempotent: keeps existing translations and
 * only requests strings that are missing.
 * Run: node scripts/i18n-translate.mjs [lang ...]
 */
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.LOVABLE_API_KEY;
const URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const OUT = "src/i18n/translations";

const LANGS = {
  ta: "Tamil (தமிழ்)",
  hi: "Hindi (हिन्दी)",
  te: "Telugu (తెలుగు)",
  kn: "Kannada (ಕನ್ನಡ)",
  ml: "Malayalam (മലയാളം)",
  bn: "Bengali (বাংলা)",
  mr: "Marathi (मराठी)",
  gu: "Gujarati (ગુજરાતી)",
  pa: "Punjabi / Gurmukhi (ਪੰਜਾਬੀ)",
  or: "Odia (ଓଡ଼ିଆ)",
  as: "Assamese (অসমীয়া)",
  ur: "Urdu (اردو)",
};

const strings = JSON.parse(fs.readFileSync("scripts/out/strings.json", "utf8"));
fs.mkdirSync(OUT, { recursive: true });

const sys = (lang) =>
  `You are a professional localisation expert translating a government-grade child education risk-intelligence dashboard (analytics, machine learning, school administration) from English into ${lang}.
Rules:
- Return ONLY a JSON object mapping each English source string to its translation. No prose, no markdown fences.
- Use natural, professional administrative terminology; never literal word-for-word machine translation.
- Preserve placeholders like {n}, numbers, symbols (%, ₹, ·, —), and trailing/leading punctuation exactly.
- Keep proper nouns, product names (VIZHIPPAAN), model names (CatBoost, SHAP, XAI, AI, API, CSV, PDF, ROI) and identifiers untranslated, transliterating only when it is standard practice.
- Keep translations concise so they fit dashboard UI chips, buttons and table headers.`;

async function translateBatch(langName, batch) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: sys(langName) },
        { role: "user", content: JSON.stringify(batch) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content.replace(/^```json\s*|```$/g, ""));
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LANGS);

for (const code of targets) {
  const file = path.join(OUT, `${code}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const missing = strings.filter((s) => !existing[s]);
  if (!missing.length) {
    console.log(`${code}: complete (${Object.keys(existing).length})`);
    continue;
  }
  const size = 60;
  for (let i = 0; i < missing.length; i += size) {
    const batch = missing.slice(i, i + size);
    let attempt = 0;
    while (attempt < 3) {
      try {
        const map = await translateBatch(LANGS[code], batch);
        for (const [k, v] of Object.entries(map)) if (typeof v === "string" && v.trim()) existing[k] = v.trim();
        break;
      } catch (e) {
        attempt++;
        console.warn(`${code} batch ${i} attempt ${attempt}: ${String(e).slice(0, 120)}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
    console.log(`${code}: ${Object.keys(existing).length}/${strings.length}`);
  }
}
