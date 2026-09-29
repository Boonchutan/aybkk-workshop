#!/usr/bin/env node
// Image step for No Cap Daily carousels (replaces Kling when a key is set): the Google Gemini API, or
// Cloudflare Workers AI (FLUX) when only the Cloudflare variables exist.
// Usage: node scripts/trend-image.js <dir> [--provider gemini|cloudflare] [--only 1,4] [--model gemini-3.1-flash-image]
//        [--size 1K|2K] [--cf-model flux-2-klein-4b] [--cover-candidates 2] [--concurrency 3] [--dry-run] [--list-models]
//        node scripts/trend-image.js <dir> --photo 1 --commons "File:Name.jpg" [--pos "56% 0%"]
// Reads <dir>/slides.json, writes <dir>/bg/slideN.img (cover candidate b → <dir>/bg/cover-b.img).
// --photo puts a real person's photo from Wikimedia Commons (free licenses only) on slide N and writes its
// photo, credit (and bgPos) into slides.json; the normal run skips slides that have a photo.
// Gemini needs env GEMINI_API_KEY (aistudio.google.com). Cloudflare needs env CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_API_TOKEN (a token with Workers AI permission). Calls go through curl so the agent proxy and CA bundle apply.
// Google Flow (labs.google/flow) has no API; this uses the same Nano Banana models through the Gemini API.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const has = name => args.includes(name);
const VALUED = ["--provider", "--only", "--model", "--size", "--cf-model", "--cover-candidates", "--concurrency", "--photo", "--commons", "--pos"];
const dir = path.resolve(args.find((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1])) || ".");
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
const cf = { acct: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN };
const provider = flag("--provider", key || !(cf.acct && cf.token) ? "gemini" : "cloudflare");
const cfModel = flag("--cf-model", "flux-2-klein-4b");
const CF_API = "https://api.cloudflare.com/client/v4";
const CF_W = 1024, CF_H = 1280; // 4:5 in 2x3 billed 512-px tiles (1088x1360 bills 3x3); the renderer scales to 1080x1350
const tiles = (w, h) => Math.ceil(w / 512) * Math.ceil(h / 512);
const CF = { // neurons per image, developers.cloudflare.com/workers-ai/platform/pricing (Sept 2026)
  "flux-2-klein-4b": { form: true, neurons: tiles(CF_W, CF_H) * 26.05 },
  "flux-2-klein-9b": { form: true, neurons: 1363.64 + (CF_W * CF_H / 1048576 - 1) * 181.82 },
  "flux-2-dev": { form: true, steps: 25, neurons: tiles(CF_W, CF_H) * 25 * 37.5 },
  "flux-1-schnell": { form: false, steps: 8, neurons: 4 * 4.8 + 8 * 9.6 }, // 1024 square only
};

function curl(method, url, { headers, json, form } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "img-"));
  const hdr = path.join(tmp, "h"), out = path.join(tmp, "o"), data = path.join(tmp, "d");
  fs.writeFileSync(hdr, headers, { mode: 0o600 });
  const a = ["-sS", "-X", method, "-H", `@${hdr}`, "-o", out, "-w", "%{http_code}", "--max-time", "180", url];
  if (json) { fs.writeFileSync(data, JSON.stringify(json)); a.push("--data-binary", `@${data}`); }
  for (const [k, v] of Object.entries(form || {})) a.push("--form-string", `${k}=${v}`);
  let code = "000", buf = Buffer.alloc(0);
  try { code = execFileSync("curl", a, { encoding: "utf8" }).trim(); } catch {}
  try { if (fs.existsSync(out)) buf = fs.readFileSync(out); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const text = buf.toString("utf8");
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { code: Number(code), json: parsed, text, buf };
}
const geminiHeaders = () => `x-goog-api-key: ${key}\nContent-Type: application/json\n`;
const cfHeaders = jsonBody => `Authorization: Bearer ${cf.token}\n${jsonBody ? "Content-Type: application/json\n" : ""}`;
const cfError = r => (r.json && Array.isArray(r.json.errors) && r.json.errors.map(e => e.message).join("; ")) || r.text.slice(0, 200) || "no response";
const isImage = b => b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || b.toString("latin1", 8, 12) === "WEBP");
const UA = "User-Agent: NoCapDaily-trend-image/1.0 (https://github.com/Boonchutan/aybkk-workshop)\n";
const FREE = /^(CC0|Public domain|PD\b|CC BY(-SA)? \d)/i;

// Commons hosts only free files, but the license is still checked: a screenshot or a news/agency photo is someone's copy.
function commonsPhoto(spec, n) {
  const slide = spec.slides.find(s => s.n === n);
  let name = String(flag("--commons", "")); try { name = decodeURIComponent(name); } catch {}
  name = name.replace(/^.*?File:/i, "").replace(/_/g, " ").trim();
  if (!slide || !name) { console.error('--photo N needs a slide N in slides.json and --commons "File:<name>"'); process.exit(2); }
  const r = curl("GET", "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=2400&titles="
    + encodeURIComponent("File:" + name), { headers: UA });
  const page = r.json && r.json.query && Object.values(r.json.query.pages || {})[0];
  const info = page && page.imageinfo && page.imageinfo[0];
  if (r.code !== 200) { console.error(`Commons API: HTTP ${r.code}${r.code === 429 ? " (too many requests: wait a minute, then retry once)" : ""}`); process.exit(1); }
  if (!info) { console.error(`Commons: "File:${name}" not found`); process.exit(1); }
  const meta = k => String(((info.extmetadata || {})[k] || {}).value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const license = meta("LicenseShortName"), artist = meta("Artist") || meta("Credit");
  if (!FREE.test(license) || /\b(NC|ND)\b/.test(license)) { console.error(`Commons: license "${license || "unknown"}" is not free to reuse; pick another photo`); process.exit(2); }
  if (!artist) { console.error("Commons: the file names no author, and the license needs one for the credit; pick another photo"); process.exit(2); }
  const img = curl("GET", info.thumburl || info.url, { headers: UA });
  if (img.code !== 200 || !isImage(img.buf)) { console.error(`Commons: download failed (HTTP ${img.code})`); process.exit(1); }
  fs.mkdirSync(path.join(dir, "bg"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bg", `slide${n}.img`), img.buf);
  slide.photo = info.descriptionurl;
  slide.credit = `Photo: ${artist}, Wikimedia Commons, ${license} (edited)`;
  if (flag("--pos", null)) slide.bgPos = flag("--pos");
  fs.writeFileSync(path.join(dir, "slides.json"), JSON.stringify(spec, null, 1) + "\n");
  console.log(`slide ${n}: ${name} (${info.width}x${info.height}), ${license}, by ${artist}`);
  console.log(`  ${meta("ImageDescription").slice(0, 200)} [${meta("DateTimeOriginal")}]`);
  console.log(`  credit on the slide: ${slide.credit}`);
  if (/personality/i.test(meta("Restrictions"))) console.log("  personality rights: fine for a news post, never for an ad");
}

function listModels() {
  if (provider === "cloudflare") {
    const r = curl("GET", `${CF_API}/accounts/${cf.acct}/ai/models/search?task=Text-to-Image&per_page=100`, { headers: cfHeaders(false) });
    if (r.code !== 200) { console.error(`models: HTTP ${r.code} ${cfError(r)}`); process.exit(1); }
    for (const m of (r.json && r.json.result) || []) console.log(m.name, CF[m.name.split("/").pop()] ? "(supported here)" : "");
    return;
  }
  const r = curl("GET", `${API}/models?pageSize=200`, { headers: geminiHeaders() });
  if (r.code !== 200) { console.error(`models: HTTP ${r.code} ${(r.json && r.json.error && r.json.error.message) || ""}`); process.exit(1); }
  for (const m of r.json.models || []) if (/image/i.test(m.name)) console.log(m.name.replace(/^models\//, ""), "|", (m.supportedGenerationMethods || []).join(","));
}

async function withRetries(call) {
  const waits = [5000, 10000, 20000, 40000];
  for (let attempt = 0; ; attempt++) {
    const r = call();
    if (r.retry && attempt < waits.length) { await new Promise(res => setTimeout(res, waits[attempt])); continue; }
    return r;
  }
}

const generateGemini = (prompt, file) => withRetries(() => {
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5", imageSize: size } } };
  const r = curl("POST", `${API}/models/${model}:generateContent`, { headers: geminiHeaders(), json: body });
  if (r.code === 200 && r.json) {
    const parts = (((r.json.candidates || [])[0] || {}).content || {}).parts || [];
    const img = parts.find(p => p.inlineData && /^image\//.test(p.inlineData.mimeType || ""));
    if (img) { fs.writeFileSync(file, Buffer.from(img.inlineData.data, "base64")); return { ok: true, bytes: fs.statSync(file).size }; }
    const why = (r.json.promptFeedback && r.json.promptFeedback.blockReason) || (((r.json.candidates || [])[0] || {}).finishReason) || "no image in response";
    return { ok: false, why };
  }
  const msg = (r.json && r.json.error && r.json.error.message) || r.text.slice(0, 200) || "no response";
  return { ok: false, retry: r.code === 429 || r.code >= 500 || r.code === 0, why: `HTTP ${r.code} ${msg}` };
});

// FLUX.2 models take multipart form data (even for a prompt alone); FLUX.1 schnell takes JSON.
const generateCloudflare = (prompt, file, seed) => withRetries(() => {
  const m = CF[cfModel];
  const url = `${CF_API}/accounts/${cf.acct}/ai/run/@cf/black-forest-labs/${cfModel}`;
  const req = m.form
    ? { headers: cfHeaders(false), form: { prompt, width: CF_W, height: CF_H, ...(m.steps ? { steps: m.steps } : {}), ...(seed ? { seed } : {}) } }
    : { headers: cfHeaders(true), json: { prompt, steps: m.steps } };
  const r = curl("POST", url, req);
  if (r.code === 200) {
    const b64 = r.json && r.json.result && r.json.result.image;
    const bytes = b64 ? Buffer.from(b64, "base64") : isImage(r.buf) ? r.buf : null;
    if (bytes) { fs.writeFileSync(file, bytes); return { ok: true, bytes: bytes.length }; }
    return { ok: false, why: "no image in response" };
  }
  return { ok: false, retry: r.code === 429 || r.code >= 500 || r.code === 0, why: `HTTP ${r.code} ${cfError(r)}` };
});

(async () => {
  if (!["gemini", "cloudflare"].includes(provider)) { console.error(`unknown --provider ${provider} (gemini or cloudflare)`); process.exit(2); }
  if (provider === "cloudflare" && !CF[cfModel]) { console.error(`unknown --cf-model ${cfModel} (${Object.keys(CF).join(", ")})`); process.exit(2); }
  const missing = provider === "gemini" ? (key ? "" : "GEMINI_API_KEY is not set")
    : cf.acct && cf.token ? "" : "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not both set";
  if (has("--list-models")) { if (missing) { console.error(missing); process.exit(2); } listModels(); return; }
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "slides.json"), "utf8"));
  if (flag("--photo", null)) { commonsPhoto(spec, Number(flag("--photo"))); return; }
  const bg = path.join(dir, "bg"); fs.mkdirSync(bg, { recursive: true });
  const jobs = [];
  for (const s of spec.slides) {
    if (only && !only.includes(s.n)) continue;
    if (!s.image || s.photo) continue;
    jobs.push({ n: s.n, prompt: s.image, file: path.join(bg, `slide${s.n}.img`) });
    if (s.n === 1) for (let c = 1; c < coverCandidates; c++) jobs.push({ n: 1, prompt: s.image, seed: 1000 + c, file: path.join(bg, c === 1 ? "cover-b.img" : `cover-${String.fromCharCode(97 + c)}.img`) });
  }
  if (provider === "cloudflare") {
    const n = Math.round(CF[cfModel].neurons * jobs.length);
    console.log(`${path.basename(dir)}: ${jobs.length} images, Cloudflare ${cfModel}, ${CF[cfModel].form ? `${CF_W}x${CF_H}` : "1024x1024"}, est. ${n} neurons (10,000 free a day, then $${(n * 0.011 / 1000).toFixed(3)})`);
  } else {
    const price = (PRICE[model] || {})[size];
    const cost = price ? `$${(price * jobs.length).toFixed(2)} (${jobs.length} × $${price})` : `${jobs.length} images, price unknown for ${model} ${size}`;
    console.log(`${path.basename(dir)}: ${jobs.length} images, model ${model}, ${size}, 4:5, est. ${cost}`);
  }
  if (dryRun) { for (const j of jobs) console.log(`  ${path.basename(j.file)} ← ${j.prompt.slice(0, 90)}…`); return; }
  if (missing) { console.error(`${missing}: add ${provider === "cloudflare" ? "them" : "it"} to the environment variables (claude.ai/code → environment) and start a new session. Rendering falls back to the gradient.`); process.exit(2); }
  const generate = provider === "cloudflare" ? generateCloudflare : generateGemini;
  let i = 0, ok = 0; const failed = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (i < jobs.length) { const j = jobs[i++]; const r = await generate(j.prompt, j.file, j.seed);
      if (r.ok) { ok++; console.log(`  ok  ${path.basename(j.file)} (${r.bytes} bytes)`); } else { failed.push(j); console.log(`  FAILED ${path.basename(j.file)}: ${r.why}`); } }
  }));
  console.log(`done: ${ok}/${jobs.length} images${failed.length ? `, ${failed.length} failed → those slides render on the gradient` : ""}`);
})().catch(e => { console.error(e.message); process.exit(1); });
