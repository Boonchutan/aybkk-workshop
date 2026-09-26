#!/usr/bin/env node
"use strict";
// Renders a 10-slide Talk of the Town carousel from a slides.json (see .claude/commands/trend.md, Step 5).
// Usage: node scripts/trend-carousel.js <dir> [n,n,...]
//   <dir>/slides.json  { topic, slug, brand, caption[], slides:[{ n, headline, sub, foot, image }] }
//   <dir>/bg/slideN.img  background photo per slide (optional; a dark gradient is used when missing)
//   writes <dir>/out/NN.png (1080x1350) via scripts/trend-card.js in slide layout
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const dir = path.resolve(process.argv[2] || ".");
const only = process.argv[3] ? process.argv[3].split(",").map(Number) : null;
const d = JSON.parse(fs.readFileSync(path.join(dir, "slides.json"), "utf8"));
fs.mkdirSync(path.join(dir, "out"), { recursive: true });
for (const s of d.slides) {
  if (only && !only.includes(s.n)) continue;
  const img = path.join(dir, "bg", "slide" + s.n + ".img");
  const spec = { layout: "slide", index: String(s.n).padStart(2, "0") + " / " + d.slides.length, kicker: d.kicker || "No Cap Daily",
    headline: s.headline, sub: s.sub, brand: d.brand, foot: s.foot, image: fs.existsSync(img) ? img : "",
    shade: s.shade || (s.n === 1 ? "light" : "") };
  const specPath = path.join(dir, "out", "spec" + s.n + ".json");
  fs.writeFileSync(specPath, JSON.stringify(spec));
  execFileSync("node", [path.join(__dirname, "trend-card.js"), specPath, path.join(dir, "out", String(s.n).padStart(2, "0") + ".png")], { stdio: "inherit" });
}
