#!/usr/bin/env node
"use strict";
// Renders a 1080x1350 PNG for the /trend skill with the pre-installed headless Chromium.
// Usage: node scripts/trend-card.js spec.json out.png
//   spec (card):  { kicker, term, volume, teaser, series, date }
//   spec (slide): { layout: "slide", image, index, headline, sub, brand, foot, kicker,
//                   primary?, accent?, font? ("oswald" | "anton"), headWeight?, headSize?, zone? ("auto" | "top" | "bottom") }
//     @wealth-style carousel slide: photoreal background + dark gradient + condensed headline.
//     *stressed words* in headline take the accent colour (aim for 20% of the words).
//     zone "auto" finds the image's focus and puts the text where it covers at most 60% of it.
// playwright-core is NOT a repo dependency (Railway doesn't need it). Install it once per session:
//   npm i --no-save --prefix "$SCRATCH/pw" playwright-core && export NODE_PATH="$SCRATCH/pw/node_modules"
const fs = require("fs");
const path = require("path");
const os = require("os");

let chromium;
try { ({ chromium } = require("playwright-core")); }
catch { console.error("playwright-core not found — see the install line at the top of scripts/trend-card.js"); process.exit(2); }

const [specPath, out] = process.argv.slice(2);
if (!specPath || !out) { console.error("usage: node scripts/trend-card.js spec.json out.png"); process.exit(2); }
const d = JSON.parse(fs.readFileSync(specPath, "utf8"));
const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const font = f => "file://" + path.join(__dirname, "..", "public", "fonts", f);
const headline = esc(d.headline).replace(/\*([^*]+)\*/g, '<span class="acc">$1</span>');
const headSize = Number(d.headSize) || 116;

const slideHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Head";src:url("${font(d.font === "anton" ? "anton.ttf" : "oswald.ttf")}") format("truetype");font-weight:200 700}
@font-face{font-family:"CardText";src:url("${font("inter.woff2")}") format("woff2")}
@font-face{font-family:"CardThai";src:url("${font("notothai-th.woff2")}") format("woff2")}
:root{--primary:${esc(d.primary || "#F4EFE6")};--accent:${esc(d.accent || "#FFB92E")}}
html,body{margin:0;padding:0}
body{width:1080px;height:1350px;position:relative;overflow:hidden;background:#0b1220;color:var(--primary);font-family:"CardText","CardThai","Noto Color Emoji",sans-serif}
.bg{position:absolute;inset:0;background:${d.image ? `url("file://${d.image}") center/cover no-repeat` : "radial-gradient(120% 80% at 30% 20%, #24344f 0%, #0b1220 70%)"}}
.shade{position:absolute;inset:0;background:linear-gradient(180deg, rgba(5,8,15,.50) 0%, rgba(5,8,15,.06) 30%, rgba(5,8,15,.40) 56%, rgba(5,8,15,.95) 100%)}
body.zone-top .shade{background:linear-gradient(0deg, rgba(5,8,15,.50) 0%, rgba(5,8,15,.06) 30%, rgba(5,8,15,.45) 56%, rgba(5,8,15,.95) 100%)}
body.shade-light .shade{background:linear-gradient(180deg, rgba(5,8,15,.22) 0%, rgba(5,8,15,0) 28%, rgba(5,8,15,.18) 58%, rgba(5,8,15,.86) 100%)}
body.shade-light.zone-top .shade{background:linear-gradient(0deg, rgba(5,8,15,.22) 0%, rgba(5,8,15,0) 28%, rgba(5,8,15,.18) 58%, rgba(5,8,15,.86) 100%)}
.top{position:absolute;left:72px;right:72px;top:72px;display:flex;justify-content:space-between;align-items:center;font-size:30px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--primary);opacity:.92}
.top .k{background:var(--accent);color:#0b1220;padding:10px 18px;border-radius:6px;letter-spacing:.14em}
.text{position:absolute;left:72px;right:72px;bottom:176px}
.text::before{content:"";position:absolute;left:-72px;right:-72px;top:-140px;bottom:-150px;z-index:-1;background:linear-gradient(180deg, rgba(5,8,15,0) 0%, rgba(5,8,15,.72) 24%, rgba(5,8,15,.72) 76%, rgba(5,8,15,0) 100%)}
.text{z-index:1}
body.zone-top .text{bottom:auto;top:200px}
h1{margin:0;font-family:"Head","CardThai",sans-serif;font-weight:${Number(d.headWeight) || 600};font-size:${headSize}px;line-height:${Number(d.lineHeight) || 0.9};letter-spacing:${d.letterSpacing || "-0.008em"};text-transform:uppercase;text-wrap:balance;overflow-wrap:anywhere;text-shadow:0 4px 26px rgba(0,0,0,.55)}
h1 .acc{color:var(--accent)}
body.compact h1{font-size:${Math.round(headSize * 0.8)}px}
.sub{margin-top:14px;font-size:38px;line-height:1.14;letter-spacing:-.005em;color:var(--primary);opacity:.9;font-weight:500;text-wrap:pretty;max-width:900px}
body.compact .sub{font-size:32px}
.foot{position:absolute;left:72px;right:72px;bottom:64px;display:flex;justify-content:space-between;align-items:center;gap:40px;font-size:26px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--primary);opacity:.8;white-space:nowrap}
.foot span:first-child{overflow:hidden;text-overflow:ellipsis;min-width:0}
.foot::before{content:"";position:absolute;left:-72px;right:-72px;top:-90px;bottom:-64px;z-index:-1;background:linear-gradient(180deg, rgba(5,8,15,0) 0%, rgba(5,8,15,.7) 45%, rgba(5,8,15,.85) 100%)}
.foot{z-index:1}
.foot .swipe{color:var(--accent);flex:none}
</style></head><body>
<div class="bg"></div><div class="shade"></div>
<div class="top"><span class="k">${esc(d.kicker || "No Cap Daily")}</span><span>${esc(d.index || "")}</span></div>
<div class="text"><h1 id="h">${headline}</h1>${d.sub ? `<div class="sub" id="s">${esc(d.sub)}</div>` : ""}</div>
<div class="foot"><span>${esc(d.brand || "")}</span><span class="swipe">${esc(d.foot || "")}</span></div>
<script>
(async function(){
  const body=document.body, want=${JSON.stringify(d.zone || "auto")}, src=${d.image ? JSON.stringify("file://" + d.image) : "null"};
  let zone = want === "top" ? "top" : "bottom", compact = false, covered = null;
  if (src && want === "auto") {
    try {
      // Focus map: edge energy + contrast against the mean + saturation, on a 54x68 grid.
      const im = new Image(); im.src = src; await im.decode();
      const W = 54, H = 68, c = document.createElement("canvas"); c.width = W; c.height = H;
      const g = c.getContext("2d"); g.drawImage(im, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data, lum = new Float32Array(W * H), sat = new Float32Array(W * H);
      let mean = 0;
      for (let i = 0; i < W * H; i++) { const r = px[i*4], gg = px[i*4+1], b = px[i*4+2]; const l = (0.299*r + 0.587*gg + 0.114*b) / 255; lum[i] = l; mean += l; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); sat[i] = mx ? (mx - mn) / mx : 0; }
      mean /= W * H;
      const e = new Float32Array(W * H); let es = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y*W + x; e[i] = Math.abs(lum[i+1] - lum[i-1]) + Math.abs(lum[i+W] - lum[i-W]) + 0.6*Math.abs(lum[i] - mean) + 0.3*sat[i]; es += e[i]; }
      const emean = es / ((W-2) * (H-2)); let v = 0; for (let i = 0; i < W * H; i++) v += (e[i] - emean) ** 2; const sd = Math.sqrt(v / (W * H));
      const th = emean + 0.8 * sd, rows = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (e[y*W + x] > th) rows.push(y);
      const total = rows.length || 1, frac = (a, b) => rows.filter(y => y >= a*H && y < b*H).length / total;
      window.__lum = Math.round(mean * 100); let bo = frac(0.50, 0.90), to = frac(0.14, 0.54);
      zone = to < bo - 0.05 ? "top" : "bottom"; covered = Math.min(bo, to);
      if (covered > 0.6) { compact = true; bo = frac(0.60, 0.90); to = frac(0.14, 0.44); zone = to < bo - 0.05 ? "top" : "bottom"; covered = Math.min(bo, to); }
    } catch (err) { window.__focusError = String(err); }
  }
  body.classList.add("zone-" + zone); if (compact) body.classList.add("compact"); if (${JSON.stringify(d.shade || "")} === "light") body.classList.add("shade-light");
  const h = document.getElementById("h"), box = document.querySelector(".text");
  let hs = parseFloat(getComputedStyle(h).fontSize), limit = 1350 - 176 - 260;
  for (let i = 0; i < 60 && box.offsetHeight > limit && hs > 60; i++) { hs -= 4; h.style.fontSize = hs + "px"; }
  window.__focus = { zone, compact, covered: covered === null ? null : Math.round(covered * 100), lum: window.__lum === undefined ? null : window.__lum };
  window.__ready = true;
})();
</script></body></html>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Card";src:url("${font("outfit.woff2")}") format("woff2")}
@font-face{font-family:"CardThai";src:url("${font("notothai-th.woff2")}") format("woff2")}
@font-face{font-family:"CardText";src:url("${font("inter.woff2")}") format("woff2")}
@font-face{font-family:"CardTextThai";src:url("${font("plexthai-th.woff2")}") format("woff2")}
html,body{margin:0;padding:0}
body{width:1080px;height:1350px;box-sizing:border-box;padding:96px 80px 84px;background:#0f1a2b;color:#fff;
  font-family:"Card","CardThai","Noto Color Emoji",sans-serif;display:flex;flex-direction:column;position:relative;overflow:hidden}
.bar{position:absolute;left:0;top:0;width:100%;height:14px;background:#f2c94c}
.head{display:flex;justify-content:space-between;align-items:baseline;font-size:30px;font-weight:700;letter-spacing:.2em;text-transform:uppercase}
.head .k{color:#f2c94c}.head .d{color:#8fa3bf;letter-spacing:.12em}
h1{margin:110px 0 0;font-size:${Number(d.termSize) || 120}px;line-height:1.04;font-weight:800;letter-spacing:-.02em;text-wrap:balance;overflow-wrap:anywhere}
.vol{margin-top:38px;font-size:44px;font-weight:700;color:#f2c94c;letter-spacing:.01em}
.spacer{flex:1}
.teaser{font-family:"CardText","CardTextThai","Noto Color Emoji",sans-serif;font-size:46px;line-height:1.35;color:#c9d4e3;text-wrap:pretty}
.foot{margin-top:64px;display:flex;justify-content:space-between;align-items:center;font-size:32px;font-weight:600;color:#8fa3bf;letter-spacing:.04em}
.dot{width:34px;height:34px;border-radius:50%;background:#f2c94c}
</style></head><body>
<div class="bar"></div>
<div class="head"><span class="k">${esc(d.kicker)}</span><span class="d">${esc(d.date)}</span></div>
<h1 id="h">${esc(d.term)}</h1>
<div class="vol">${esc(d.volume)}</div>
<div class="spacer"></div>
<div class="teaser" id="t">${esc(d.teaser)}</div>
<div class="foot"><span>${esc(d.series)}</span><span class="dot"></span></div>
<script>
// Shrink the headline, then the teaser, until everything fits inside the 1350px frame.
(function fit(){
  const h=document.getElementById("h"), t=document.getElementById("t");
  let hs=parseFloat(getComputedStyle(h).fontSize), ts=parseFloat(getComputedStyle(t).fontSize);
  for (let i=0;i<60 && document.body.scrollHeight>1350;i++){
    if (hs>64){hs-=4;h.style.fontSize=hs+"px";} else if (ts>32){ts-=2;t.style.fontSize=ts+"px";} else break;
  }
  window.__ready=true;
})();
</script></body></html>`;

(async () => {
  const tmp = path.join(os.tmpdir(), "trend-card-" + process.pid + ".html");
  fs.writeFileSync(tmp, d.layout === "slide" ? slideHtml : html);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto("file://" + tmp, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const focus = await page.evaluate(() => window.__focus || null);
  const focusErr = await page.evaluate(() => window.__focusError || null);
  await page.screenshot({ path: out, type: "png" });
  await browser.close();
  fs.unlinkSync(tmp);
  console.log("wrote " + out + " (" + fs.statSync(out).size + " bytes)" + (focus ? " focus: zone=" + focus.zone + (focus.covered === null ? "" : " covered=" + focus.covered + "%") + (focus.compact ? " compact" : "") + (focus.lum === null || focus.lum === undefined ? "" : " lum=" + focus.lum + "%" + (focus.lum < 22 && /^0?1\b/.test(String(d.index || "").trim()) ? " DARK-COVER" : "")) : "") + (focusErr ? " focusError=" + focusErr : ""));
})().catch(e => { console.error("RENDER FAILED: " + e.message); process.exit(1); });
