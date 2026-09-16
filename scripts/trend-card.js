#!/usr/bin/env node
"use strict";
// Renders a 1080x1350 "trend card" PNG for the /trend skill with the pre-installed headless Chromium.
// Usage: node scripts/trend-card.js spec.json out.png
//   spec (card):  { kicker, term, volume, teaser, series, date }
//   spec (slide): { layout: "slide", image, index, headline, sub, brand, kicker } — @wealth-style carousel slide:
//                 photoreal background + dark gradient + Anton headline. image = absolute path of the background.
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

const slideHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Anton";src:url("${font("anton.ttf")}") format("truetype")}
@font-face{font-family:"CardText";src:url("${font("inter.woff2")}") format("woff2")}
@font-face{font-family:"CardThai";src:url("${font("notothai-th.woff2")}") format("woff2")}
html,body{margin:0;padding:0}
body{width:1080px;height:1350px;position:relative;overflow:hidden;background:#0b1220;color:#fff;font-family:"CardText","CardThai","Noto Color Emoji",sans-serif}
.bg{position:absolute;inset:0;background:${d.image ? `url("file://${d.image}") center/cover no-repeat` : "radial-gradient(120% 80% at 30% 20%, #24344f 0%, #0b1220 70%)"}}
.shade{position:absolute;inset:0;background:linear-gradient(180deg, rgba(5,8,15,.55) 0%, rgba(5,8,15,.10) 35%, rgba(5,8,15,.55) 62%, rgba(5,8,15,.96) 100%)}
.top{position:absolute;left:72px;right:72px;top:72px;display:flex;justify-content:space-between;align-items:center;font-size:30px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#fff;opacity:.92}
.top .k{background:#f2c94c;color:#0b1220;padding:10px 18px;border-radius:6px;letter-spacing:.14em}
.text{position:absolute;left:72px;right:72px;bottom:176px}
h1{margin:0;font-family:"Anton","CardThai",sans-serif;font-weight:400;font-size:${Number(d.headSize) || 118}px;line-height:.98;letter-spacing:.005em;text-transform:uppercase;text-wrap:balance;overflow-wrap:anywhere;text-shadow:0 4px 24px rgba(0,0,0,.45)}
.sub{margin-top:34px;font-size:40px;line-height:1.3;color:#e6ecf5;font-weight:500;text-wrap:pretty;max-width:900px}
.foot{position:absolute;left:72px;right:72px;bottom:64px;display:flex;justify-content:space-between;align-items:center;gap:40px;font-size:26px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#c9d4e3;white-space:nowrap}
.foot span:first-child{overflow:hidden;text-overflow:ellipsis;min-width:0}
.foot .swipe{flex:none}
.foot .swipe{color:#f2c94c}
</style></head><body>
<div class="bg"></div><div class="shade"></div>
<div class="top"><span class="k">${esc(d.kicker || "Talk of the Town")}</span><span>${esc(d.index || "")}</span></div>
<div class="text"><h1 id="h">${esc(d.headline)}</h1>${d.sub ? `<div class="sub" id="s">${esc(d.sub)}</div>` : ""}</div>
<div class="foot"><span>${esc(d.brand || "")}</span><span class="swipe">${esc(d.foot || "")}</span></div>
<script>
(function fit(){
  const h=document.getElementById("h"), s=document.getElementById("s"), box=document.querySelector(".text");
  let hs=parseFloat(getComputedStyle(h).fontSize);
  const limit=1350-176-260; // top area reserved for the image to breathe
  for (let i=0;i<60 && box.offsetHeight>limit && hs>60;i++){ hs-=4; h.style.fontSize=hs+"px"; }
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
})();
</script></body></html>`;

(async () => {
  const tmp = path.join(os.tmpdir(), "trend-card-" + process.pid + ".html");
  fs.writeFileSync(tmp, d.layout === "slide" ? slideHtml : html);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto("file://" + tmp, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: out, type: "png" });
  await browser.close();
  fs.unlinkSync(tmp);
  console.log("wrote " + out + " (" + fs.statSync(out).size + " bytes)");
})().catch(e => { console.error("RENDER FAILED: " + e.message); process.exit(1); });
