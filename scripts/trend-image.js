#!/usr/bin/env node
// Google Gemini API image step for No Cap Daily carousels (replaces Kling when GEMINI_API_KEY is set).
// Usage: node scripts/trend-image.js <dir> [--only 1,4] [--model gemini-3.1-flash-image] [--size 1K|2K]
//        [--cover-candidates 2] [--concurrency 3] [--dry-run] [--list-models]
// Reads <dir>/slides.json, writes <dir>/bg/slideN.img (cover candidate b → <dir>/bg/cover-b.img).
// Needs env GEMINI_API_KEY (aistudio.google.com). Calls go through curl so the agent proxy and CA bundle apply.
// Google Flow (labs.google/flow) has no API; this uses the same Nano Banana models through the Gemini API.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const has = name => args.includes(name);
const dir = path.resolve(args.find(a => !a.startsWith("--") && !/^\d+(,\d+)*$/.test(a) && !["1K","2K","4K","0.5K"].includes(a) && !/^gemini-/.test(a)) || ".");
const model = flag("--model", "gemini-3.1-flash-image");
const size = flag("--size", "1K");
const only = flag("--only", null) ? flag("--only").split(",").map(Number) : null;
const coverCandidates = Number(flag("--cover-candidates", 2));
const concurrency = Number(flag("--concurrency", 3));
const dryRun = has("--dry-run");
const API = "https://generativelanguage.googleapis.com/v1beta";
const PRICE = { // USD per image, ai.google.dev/gemini-api/docs/pricing (Sept 2026)
  "gemini-3.1-flash-lite-image": { "1K": 0.0336 },
  "gemini-3.1-flash-image": { "0.5K": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 },
  "gemini-3-pro-image": { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
  "gemini-2.5-flash-image": { "1K": 0.039 },
};
const key = process.env.GEMINI_API_KEY;

function curl(method, url, body) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-"));
  const hdr = path.join(tmp, "h"), out = path.join(tmp, "o"), data = path.join(tmp, "d");
  fs.writeFileSync(hdr, `x-goog-api-key: ${key}\nContent-Type: application/json\n`, { mode: 0o600 });
  const a = ["-sS", "-X", method, "-H", `@${hdr}`, "-o", out, "-w", "%{http_code}", "--max-time", "180", url];
  if (body) { fs.writeFileSync(data, JSON.stringify(body)); a.push("--data-binary", `@${data}`); }
  let code = "000", text = "";
  try { code = execFileSync("curl", a, { encoding: "utf8" }).trim(); text = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : ""; }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  let json = null; try { json = JSON.parse(text); } catch {}
  return { code: Number(code), json, text };
}

function listModels() {
  const r = curl("GET", `${API}/models?pageSize=200`);
  if (r.code !== 200) { console.error(`models: HTTP ${r.code} ${(r.json && r.json.error && r.json.error.message) || ""}`); process.exit(1); }
  for (const m of r.json.models || []) if (/image/i.test(m.name)) console.log(m.name.replace(/^models\//, ""), "|", (m.supportedGenerationMethods || []).join(","));
}

async function generate(prompt, file) {
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5", imageSize: size } } };
  const waits = [5000, 10000, 20000, 40000];
  for (let attempt = 0; ; attempt++) {
    const r = curl("POST", `${API}/models/${model}:generateContent`, body);
    if (r.code === 200 && r.json) {
      const parts = (((r.json.candidates || [])[0] || {}).content || {}).parts || [];
      const img = parts.find(p => p.inlineData && /^image\//.test(p.inlineData.mimeType || ""));
      if (img) { fs.writeFileSync(file, Buffer.from(img.inlineData.data, "base64")); return { ok: true, bytes: fs.statSync(file).size }; }
      const why = (r.json.promptFeedback && r.json.promptFeedback.blockReason) || (((r.json.candidates || [])[0] || {}).finishReason) || "no image in response";
      return { ok: false, why };
    }
    const msg = (r.json && r.json.error && r.json.error.message) || r.text.slice(0, 200) || "no response";
    if ((r.code === 429 || r.code >= 500 || r.code === 0) && attempt < waits.length) { await new Promise(res => setTimeout(res, waits[attempt])); continue; }
    return { ok: false, why: `HTTP ${r.code} ${msg}` };
  }
}

(async () => {
  if (has("--list-models")) { if (!key) { console.error("GEMINI_API_KEY is not set"); process.exit(2); } listModels(); return; }
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "slides.json"), "utf8"));
  const bg = path.join(dir, "bg"); fs.mkdirSync(bg, { recursive: true });
  const jobs = [];
  for (const s of spec.slides) {
    if (only && !only.includes(s.n)) continue;
    if (!s.image) continue;
    jobs.push({ n: s.n, prompt: s.image, file: path.join(bg, `slide${s.n}.img`) });
    if (s.n === 1) for (let c = 1; c < coverCandidates; c++) jobs.push({ n: 1, prompt: s.image, file: path.join(bg, c === 1 ? "cover-b.img" : `cover-${String.fromCharCode(97 + c)}.img`) });
  }
  const price = (PRICE[model] || {})[size];
  const cost = price ? `$${(price * jobs.length).toFixed(2)} (${jobs.length} × $${price})` : `${jobs.length} images, price unknown for ${model} ${size}`;
  console.log(`${path.basename(dir)}: ${jobs.length} images, model ${model}, ${size}, 4:5, est. ${cost}`);
  if (dryRun) { for (const j of jobs) console.log(`  ${path.basename(j.file)} ← ${j.prompt.slice(0, 90)}…`); return; }
  if (!key) { console.error("GEMINI_API_KEY is not set: add it to the environment variables (claude.ai/code → environment) and rerun. Rendering falls back to the gradient."); process.exit(2); }
  let i = 0, ok = 0; const failed = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (i < jobs.length) { const j = jobs[i++]; const r = await generate(j.prompt, j.file);
      if (r.ok) { ok++; console.log(`  ok  ${path.basename(j.file)} (${r.bytes} bytes)`); } else { failed.push(j); console.log(`  FAILED ${path.basename(j.file)}: ${r.why}`); } }
  }));
  console.log(`done: ${ok}/${jobs.length} images${failed.length ? `, ${failed.length} failed → those slides render on the gradient` : ""}`);
})().catch(e => { console.error(e.message); process.exit(1); });
