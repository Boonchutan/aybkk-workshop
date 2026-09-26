#!/usr/bin/env node
"use strict";
// Google Trends fetcher for the /trend skill. Two sources, no browser needed:
//  1. daily RSS  https://trends.google.com/trending/rss?geo=XX  (top ~10 of today, with news links)
//  2. weekly     https://trends.google.com/trending?geo=XX&hours=168  — the page embeds the full
//     "Trending now" table as JSON (AF_initDataCallback ds:0), which is where the top-50-of-the-week lives.
// Usage: node scripts/trends-fetch.js [--geo US,TH] [--hours 168] [--top 100] [--out trends.json]
const fs = require("fs");

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf("--" + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const geos = opt("geo", "US,TH").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const hours = opt("hours", "168");
const top = Number(opt("top", "100"));
const out = opt("out", "");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Category ids observed in the embedded data (17 = Sports is the one the rubric filters on).
const CATEGORY = {
  1: "Autos & Vehicles", 2: "Beauty & Fashion", 3: "Business & Finance", 4: "Entertainment", 5: "Food & Drink",
  6: "Games", 7: "Health", 8: "Hobbies & Leisure", 9: "Jobs & Education", 10: "Law & Government", 11: "Other",
  12: "Pets & Animals", 13: "Climate", 14: "Politics", 15: "Science", 16: "Shopping", 17: "Sports",
  18: "Technology", 19: "Travel & Transportation", 20: "Climate"
};

const decode = s => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .trim();
const tag = (block, name) => { const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">")); return m ? decode(m[1]) : ""; };

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.text();
}

async function daily(geo) {
  const xml = await get("https://trends.google.com/trending/rss?geo=" + geo);
  return Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).map(([, item]) => ({
    title: tag(item, "title"),
    traffic: tag(item, "ht:approx_traffic"),
    pubDate: tag(item, "pubDate"),
    news: Array.from(item.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)).map(([, n]) => ({
      headline: tag(n, "ht:news_item_title"),
      url: tag(n, "ht:news_item_url"),
      source: tag(n, "ht:news_item_source")
    }))
  }));
}

async function weekly(geo) {
  const html = await get("https://trends.google.com/trending?geo=" + geo + "&hours=" + hours + "&hl=en-US");
  const key = "AF_initDataCallback({key: 'ds:0'";
  const i = html.indexOf(key);
  if (i < 0) throw new Error("ds:0 block not found for " + geo + " (page layout changed?)");
  const start = html.indexOf("data:", i) + 5;
  const end = html.indexOf(", sideChannel:", start);
  const data = JSON.parse(html.slice(start, end));
  const list = Array.isArray(data[1]) ? data[1] : [];
  const iso = t => (Array.isArray(t) && t[0]) ? new Date(t[0] * 1000).toISOString() : null;
  return list.map(e => ({
    title: e[0],
    volume: e[6] || 0,
    growthPct: e[8] || 0,
    started: iso(e[3]),
    ended: iso(e[4]),
    active: !iso(e[4]),
    related: Array.isArray(e[9]) ? e[9] : [],
    categories: (Array.isArray(e[10]) ? e[10] : []).map(id => CATEGORY[id] || String(id))
  })).sort((a, b) => b.volume - a.volume).slice(0, top);
}

(async () => {
  const result = { fetchedAt: new Date().toISOString(), hours: Number(hours), geos: {} };
  for (const geo of geos) {
    const [d, w] = await Promise.all([daily(geo).catch(e => ({ error: e.message })), weekly(geo).catch(e => ({ error: e.message }))]);
    result.geos[geo] = { daily: d, weekly: w };
    const n = x => Array.isArray(x) ? x.length : "ERROR " + x.error;
    console.error(geo + ": daily " + n(d) + ", weekly " + n(w));
  }
  const json = JSON.stringify(result, null, 1);
  if (out) { fs.writeFileSync(out, json); console.error("wrote " + out); } else process.stdout.write(json);
})().catch(e => { console.error("FETCH FAILED:", e.message); process.exit(1); });
