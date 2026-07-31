#!/usr/bin/env node
// render-cards-hefei.js — print-ready sticker cards for the Hefei WS. PORTRAIT.
// Theme: tee purple, white print, hand-ink type (LXGW WenKai) matching the artwork.
//
// Usage:
//   node render-cards-hefei.js art.png [--badge badge.png] [--all]
//
// Output: hefei-cards-print/  (300 dpi PNGs, 3mm bleed, ID-1 card 54×85.6mm portrait)

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const roster = require('./public/rosters/hefei.json');

GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'LXGWWenKai-Regular.ttf'), 'LXGW WenKai');
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'LXGWWenKai-Medium.ttf'), 'LXGW WenKai Medium');
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'ShantellSans-ExtraBold.ttf'), 'Shantell XB');

// ── theme ────────────────────────────────────────────────────────────────────
const PURPLE = '#582C83';   // card background (tee purple)
const INK    = '#241243';   // QR modules (near-black purple, scan-safe)
const WHITE  = '#FFFFFF';

// ── geometry: PORTRAIT (300 dpi) ─────────────────────────────────────────────
const DPI = 300, mm = v => Math.round(v / 25.4 * DPI);
const W = mm(60), H = mm(91.6);          // artboard with 3mm bleed
const BX = mm(3), BY = mm(3);            // bleed offset → trim origin
const TW = mm(54), TH = mm(85.6);        // trim size
const CX = W / 2;                        // card center x
const HOLE_CY = BY + mm(5), HOLE_R = mm(2.5);   // 5mm punch, top-center

const OUT = path.join(__dirname, 'hefei-cards-print');
fs.mkdirSync(OUT, { recursive: true });

const ART_PATH = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const bi = process.argv.indexOf('--badge');
const BADGE_PATH = bi > -1 ? process.argv[bi + 1] : null;
const ALL = process.argv.includes('--all');

const F  = px => `${px}px "LXGW WenKai"`;
const FM = px => `${px}px "LXGW WenKai Medium"`;
const FX = px => `${px}px "Shantell XB"`;                 // the fat marker voice

// one line, several voices — bold anchors beside light whispers
function drawMixed(ctx, segs, cx, y, maxW) {
  const widths = () => segs.map(g => { ctx.font = g.font(g.px); return ctx.measureText(g.text).width; });
  let w = widths(), total = w.reduce((a, b) => a + b, 0);
  if (total > maxW) {
    const k = maxW / total;
    segs.forEach(g => g.px = Math.floor(g.px * k));
    w = widths(); total = w.reduce((a, b) => a + b, 0);
  }
  let x = cx - total / 2;
  ctx.save(); ctx.textAlign = 'left';
  for (let i = 0; i < segs.length; i++) {
    ctx.font = segs[i].font(segs[i].px);
    ctx.globalAlpha = segs[i].alpha ?? 1;
    ctx.fillText(segs[i].text, x, y + (segs[i].dy || 0));
    x += w[i];
  }
  ctx.restore(); ctx.globalAlpha = 1;
}

function fit(ctx, text, maxW, startPx, minPx, medium = true) {
  let px = startPx;
  while (px > minPx) {
    ctx.font = medium ? FM(px) : F(px);
    if (ctx.measureText(text).width <= maxW) break;
    px -= 2;
  }
  return px;
}

// Stamp logo (dark ink on white JPG) → recolored, transparent background.
async function loadLogoTinted(hex) {
  const hires = path.join(__dirname, 'aybkk-logo-hires.png');
  const img = await loadImage(fs.existsSync(hires) ? hires : path.join(__dirname, 'public', 'aybkk-logo.jpg'));
  const c = createCanvas(img.width, img.height), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = (d.data[i] * .299 + d.data[i + 1] * .587 + d.data[i + 2] * .114) / 255;
    d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b;
    // two-point curve: paper noise (light) → fully clear, ink (dark) → fully solid
    const a = Math.max(0, Math.min(1, (0.80 - lum) / 0.45));
    d.data[i + 3] = Math.round(a * 255);
  }
  x.putImageData(d, 0, 0);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function base(ctx) {
  ctx.fillStyle = PURPLE; ctx.fillRect(0, 0, W, H);
  // delicate inset frame — gives the card its "credential" formality
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3;
  roundRect(ctx, BX + mm(2.2), BY + mm(2.2), TW - mm(4.4), TH - mm(4.4), mm(2.5));
  ctx.stroke();
  // punch is NOT printed — position lives in README-PRINTER.md; the top strip
  // simply stays free of content so the 5mm punch lands on clean purple.
}

// fireflies — tiny drifting lights from the tee's firefly line (fixed, edition-wide)
function fireflies(ctx, spots) {
  for (const [fx, fy, r, a] of spots) {
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath(); ctx.arc(BX + TW * fx, BY + TH * fy, r, 0, Math.PI * 2); ctx.fill();
  }
}

// ── FRONT: white logo, big artwork, title, firefly line ─────────────────────
async function renderFront(art, logoWhite) {
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  base(ctx);
  ctx.fillStyle = WHITE; ctx.textAlign = 'center';

  // ── measured 4-section grid ──────────────────────────────────────────────
  // S1 title+seal+makers · S2 firefly couplet · S3 artwork · S4 event lockup
  // Equal GAP between sections; top and bottom margins equal to that GAP.
  // The artwork is placed by its INK bounds (measured), not its transparent box.
  const ART_INK  = { top: 0.040, bottom: 0.903, left: 0.061, right: 0.893 };
  const SEAL_INK = { top: 0.016, bottom: 0.952, left: 0.040, right: 0.938 };
  const zoneTop = BY + mm(2.2), zoneBot = BY + TH - mm(2.2);   // frame line
  const GAP = mm(3.2);

  const ink = (text, font) => { ctx.font = font; const t = ctx.measureText(text);
    return { a: t.actualBoundingBoxAscent, d: t.actualBoundingBoxDescent }; };

  const wsName = 'AYBKK Hefei Workshop';
  const wsPx = fit(ctx, wsName, TW - mm(16), 46, 30);
  const tT = ink(wsName, FX(wsPx));
  const byText = 'by Boonchu & Jamsai Tanti';
  const tB = ink(byText, F(25));
  const q1 = '“A firefly does not force its light.', q2 = '萤火虫不强求它的光”';
  const tQ1 = ink(q1, FM(26)), tQ2 = ink(q2, F(26));
  const sealInk = mm(15);                                   // the seal's INK height
  const sealBox = sealInk / (SEAL_INK.bottom - SEAL_INK.top);
  const IN1 = mm(1.4), IN2 = mm(2.2), LEAD = mm(3.0);
  const tL = ink('HEFEI 2026', FX(54));

  const h1 = tT.a + tT.d + IN1 + sealInk + IN2 + tB.a + tB.d;
  const h2 = tQ1.a + LEAD + tQ2.d;
  const h4 = tL.a + tL.d;
  const artInkH = (zoneBot - zoneTop) - 5 * GAP - h1 - h2 - h4;
  const artBox = artInkH / (ART_INK.bottom - ART_INK.top);

  let y = zoneTop + GAP;
  // S1
  ctx.font = FX(wsPx); ctx.fillText(wsName, CX, y + tT.a);
  y += tT.a + tT.d + IN1;
  ctx.drawImage(logoWhite,
    CX - sealBox * (SEAL_INK.left + SEAL_INK.right) / 2,
    y - sealBox * SEAL_INK.top, sealBox, sealBox);
  y += sealInk + IN2;
  ctx.font = F(25); ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillText(byText, CX, y + tB.a);
  y += tB.a + tB.d + GAP;
  // S2 — English a touch bolder than the Chinese
  ctx.font = FM(26); ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillText(q1, CX, y + tQ1.a);
  ctx.font = F(26); ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.fillText(q2, CX, y + tQ1.a + LEAD);
  y += h2 + GAP;
  // S3 — the artwork, placed and centered by ink
  if (art) {
    const ax = CX - artBox * (ART_INK.left + ART_INK.right) / 2;
    ctx.drawImage(art, ax, y - artBox * ART_INK.top, artBox, artBox);
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.setLineDash([14, 10]); ctx.lineWidth = 4;
    roundRect(ctx, CX - artInkH / 2, y, artInkH, artInkH, mm(2)); ctx.stroke(); ctx.setLineDash([]);
  }
  y += artInkH + GAP;
  // S4
  ctx.fillStyle = WHITE;
  drawMixed(ctx, [
    { text: 'HEFEI ',       px: 54, font: FX },
    { text: '合肥',          px: 50, font: FM },
    { text: ' 2026',        px: 54, font: FX },
    { text: '  JULY 16–20', px: 32, font: F, alpha: .85 },
  ], CX, y + tL.a, TW - mm(13));
  return c;
}

// ── BACK: QR, name, code — one hand-ink voice ───────────────────────────────
async function renderBack(student, badgeArt) {
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  base(ctx);

  // QR panel — clear of the punch strip
  const panel = mm(44), px = CX - panel / 2, py = BY + mm(5);   // 5mm top = 5mm sides
  ctx.fillStyle = WHITE;
  roundRect(ctx, px, py, panel, panel, mm(2.5)); ctx.fill();

  const url = (roster.baseUrl || 'https://my.aybkk.com') + '/s/' + student.id;
  const qrSize = panel - mm(5);
  const qbuf = await QRCode.toBuffer(url, {
    errorCorrectionLevel: 'H', margin: 0, width: qrSize,
    color: { dark: INK, light: '#FFFFFF' }
  });
  const qimg = await loadImage(qbuf);
  const qx = px + (panel - qrSize) / 2, qy = py + (panel - qrSize) / 2;
  ctx.drawImage(qimg, qx, qy, qrSize, qrSize);

  // center badge — crowned bird in purple on white knockout
  const badge = Math.round(qrSize * 0.20);
  const bxx = qx + (qrSize - badge) / 2, byy = qy + (qrSize - badge) / 2;
  ctx.fillStyle = WHITE;
  roundRect(ctx, bxx, byy, badge, badge, badge * 0.22); ctx.fill();
  if (badgeArt) {
    const t = createCanvas(badge, badge), tx = t.getContext('2d');
    tx.drawImage(badgeArt, 0, 0, badge, badge);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = INK; tx.fillRect(0, 0, badge, badge);
    ctx.drawImage(t, bxx, byy, badge, badge);
  }

  // identity block — centered, hand-ink
  ctx.textAlign = 'center'; ctx.fillStyle = WHITE;
  const maxW = TW - mm(10);
  const namePx = fit(ctx, student.name, maxW, 86, 40);
  ctx.font = FM(namePx);
  ctx.fillText(student.name, CX, BY + mm(58));

  ctx.font = FX(54);
  ctx.fillText(student.id, CX, BY + mm(65));

  const info = student.package + ' · 扫码 · 练习日志 · My Journal';
  const infoPx = fit(ctx, info, maxW, 36, 24, false);
  ctx.font = F(infoPx);
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  ctx.fillText(info, CX, BY + mm(70.3));

  // Gita 2.50 — yoga is skill in action (learning is doing)
  ctx.font = '32px "Arial Unicode MS"';
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fillText('योगः कर्मसु कौशलम्', CX, BY + mm(76));
  const gita = 'Yoga is skill in action · 瑜伽是行动中的功夫';
  const gPx = fit(ctx, gita, TW - mm(12), 24, 17, false);
  ctx.font = F(gPx);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fillText(gita, CX, BY + mm(80.6));
  return c;
}

(async () => {
  const logoWhite = await loadLogoTinted(WHITE);
  const art = ART_PATH ? await loadImage(ART_PATH) : null;
  const badgeArt = BADGE_PATH ? await loadImage(BADGE_PATH) : art;
  console.log('art:', ART_PATH || '(placeholder)', '| base:', roster.baseUrl, '| portrait 54×85.6mm trim');

  const list = ALL ? roster.students : roster.students.slice(0, 1);
  const front = await renderFront(art, logoWhite);
  fs.writeFileSync(path.join(OUT, 'FRONT.png'), front.toBuffer('image/png'));
  for (const s of list) {
    const back = await renderBack(s, badgeArt);
    fs.writeFileSync(path.join(OUT, `${s.id}-B.png`), back.toBuffer('image/png'));
  }
  console.log(`✓ FRONT.png + ${list.length} back(s) — ${W}×${H}px @300dpi, 3mm bleed`);
  if (!ALL) console.log('proof only — run with --all for all 54');
})().catch(e => { console.error(e); process.exit(1); });
