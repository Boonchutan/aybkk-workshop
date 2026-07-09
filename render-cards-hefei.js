#!/usr/bin/env node
// render-cards-hefei.js — print-ready sticker cards for the Hefei WS.
// Theme: purple card, white print (matches the 2026 Hefei tee).
//
// Usage:
//   node render-cards-hefei.js                      → proof only (HEFEI-001, placeholder art)
//   node render-cards-hefei.js path/to/art.png      → proof with real artwork
//   node render-cards-hefei.js path/to/art.png --all → all 48 cards, front + back
//
// Output: hefei-cards-print/  (300 dpi PNGs with 3mm bleed, ID-1 card 85.6×54mm)

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const roster = require('./public/rosters/hefei.json');

// ── theme ────────────────────────────────────────────────────────────────────
const PURPLE = '#582C83';   // card background (tee purple)
const INK    = '#241243';   // QR modules / logo ink (near-black purple, scan-safe)
const WHITE  = '#FFFFFF';

// ── geometry (300 dpi) ───────────────────────────────────────────────────────
const DPI = 300, mm = v => Math.round(v / 25.4 * DPI);
const W = mm(91.6), H = mm(60);          // artboard with 3mm bleed
const BX = mm(3), BY = mm(3);            // bleed offset → trim origin
const TW = mm(85.6), TH = mm(54);        // trim size
const SAFE = mm(4);                      // safe inset from trim
const HOLE_CX = W / 2, HOLE_R = mm(2.5); // 5mm lanyard hole, top-center clear zone

const OUT = path.join(__dirname, 'hefei-cards-print');
fs.mkdirSync(OUT, { recursive: true });

const ART_PATH = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const ALL = process.argv.includes('--all');

const cjk = s => /[㐀-鿿豈-﫿]/.test(s);
const fontFor = (s, px, bold = true) =>
  `${bold ? 'bold ' : ''}${px}px ${cjk(s) ? '"Hiragino Sans GB"' : '"Chalkboard SE"'}, "Hiragino Sans GB", sans-serif`;

function fitText(ctx, text, maxW, startPx, minPx = 30) {
  let px = startPx;
  while (px > minPx) {
    ctx.font = fontFor(text, px);
    if (ctx.measureText(text).width <= maxW) break;
    px -= 4;
  }
  return px;
}

// Recolor the stamp logo (dark ink on white JPG) → INK purple with transparency.
async function loadLogoTinted() {
  const img = await loadImage(path.join(__dirname, 'public', 'aybkk-logo.jpg'));
  const c = createCanvas(img.width, img.height), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const [pr, pg, pb] = [0x24, 0x12, 0x43];
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = (d.data[i] * 0.299 + d.data[i + 1] * 0.587 + d.data[i + 2] * 0.114) / 255;
    d.data[i] = pr; d.data[i + 1] = pg; d.data[i + 2] = pb;
    d.data[i + 3] = Math.round((1 - lum) * 255);   // dark ink → opaque, white paper → clear
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

function holeGuide(ctx) {  // faint guide ring for the punch (inside clear zone)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(HOLE_CX, BY + mm(4), HOLE_R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ── FRONT: artwork + logo badge + workshop title ─────────────────────────────
async function renderFront(art, logo) {
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = PURPLE; ctx.fillRect(0, 0, W, H);

  // artwork zone: left ~60% of card
  const artH = mm(44), artW = artH;                    // square art
  const ax = BX + mm(6), ay = BY + (TH - artH) / 2 + mm(2);
  if (art) {
    ctx.drawImage(art, ax, ay, artW, artH);
  } else {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([14, 10]); ctx.lineWidth = 4;
    roundRect(ctx, ax, ay, artW, artH, mm(2)); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = fontFor('ARTWORK', 44);
    ctx.textAlign = 'center';
    ctx.fillText('HEFEI ARTWORK', ax + artW / 2, ay + artH / 2 + 14);
    ctx.restore();
  }

  // right column
  const colX = BX + mm(56), colW = TW - mm(56) - SAFE;
  // logo badge (white circle + purple stamp)
  const bd = mm(15), bx = colX + (colW - bd) / 2, by = BY + mm(6.5);
  ctx.fillStyle = WHITE;
  ctx.beginPath(); ctx.arc(bx + bd / 2, by + bd / 2, bd / 2, 0, Math.PI * 2); ctx.fill();
  const pad = bd * 0.07;
  ctx.save();
  ctx.beginPath(); ctx.arc(bx + bd / 2, by + bd / 2, bd / 2 - pad, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(logo, bx + pad, by + pad, bd - 2 * pad, bd - 2 * pad);
  ctx.restore();

  // title block
  ctx.fillStyle = WHITE; ctx.textAlign = 'center';
  const cx = colX + colW / 2;
  ctx.font = fontFor('HEFEI', 92);
  ctx.fillText('HEFEI', cx, by + bd + mm(9));
  ctx.font = fontFor('合肥', 60);
  ctx.fillText('合肥 2026', cx, by + bd + mm(16.5));
  ctx.font = fontFor('July', 40, false);
  ctx.fillText('July 16–20', cx, by + bd + mm(22.5));

  holeGuide(ctx);
  return c;
}

// ── BACK: QR + name + code ───────────────────────────────────────────────────
async function renderBack(student, art, logo) {
  const c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = PURPLE; ctx.fillRect(0, 0, W, H);

  // QR panel (white, rounded) on the left
  const panel = mm(42), px = BX + mm(6), py = BY + (TH - panel) / 2;
  ctx.fillStyle = WHITE;
  roundRect(ctx, px, py, panel, panel, mm(2.5)); ctx.fill();

  const url = (roster.baseUrl || 'https://aybkk-ashtanga.up.railway.app') + '/s/' + student.id;
  const qrSize = panel - mm(5);
  const qbuf = await QRCode.toBuffer(url, {
    errorCorrectionLevel: 'H', margin: 0, width: qrSize,
    color: { dark: INK, light: '#FFFFFF' }
  });
  const qimg = await loadImage(qbuf);
  const qx = px + (panel - qrSize) / 2, qy = py + (panel - qrSize) / 2;
  ctx.drawImage(qimg, qx, qy, qrSize, qrSize);

  // center badge: white knockout + mini art (or AYBKK mark) ≤20% of QR width
  const badge = Math.round(qrSize * 0.20);
  const bxx = qx + (qrSize - badge) / 2, byy = qy + (qrSize - badge) / 2;
  ctx.fillStyle = WHITE;
  roundRect(ctx, bxx, byy, badge, badge, badge * 0.2); ctx.fill();
  if (art) {
    // tint the white line art to purple for the badge (white-on-white is invisible)
    const t = createCanvas(badge, badge), tx = t.getContext('2d');
    tx.drawImage(art, 0, 0, badge, badge);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = INK; tx.fillRect(0, 0, badge, badge);
    ctx.drawImage(t, bxx, byy, badge, badge);
  } else {
    ctx.fillStyle = INK; ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(badge * 0.30)}px "Chalkboard SE", sans-serif`;
    ctx.fillText('AY', bxx + badge / 2, byy + badge * 0.45);
    ctx.fillText('BKK', bxx + badge / 2, byy + badge * 0.80);
  }

  // right column: name / code / package
  const colX = px + panel + mm(6), colW = (BX + TW) - colX - SAFE;
  ctx.fillStyle = WHITE; ctx.textAlign = 'left';
  const namePx = fitText(ctx, student.name, colW, 78);
  ctx.font = fontFor(student.name, namePx);
  ctx.fillText(student.name, colX, BY + mm(17));

  ctx.font = 'bold 64px Menlo, monospace';
  ctx.fillText(student.id, colX, BY + mm(26));

  const line = (text, y, px, alpha) => {
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    let size = px;
    while (size > 16) {
      ctx.font = fontFor(text, size, false);
      if (ctx.measureText(text).width <= colW) break;
      size -= 2;
    }
    ctx.fillText(text, colX, y);
  };
  line(student.package + ' package', BY + mm(32), 38, 0.85);
  line('扫码 · 练习日志 · My Journal', BY + mm(40), 34, 0.85);
  line('AYBKK · Hefei WS · 2026.07.16–20', BY + mm(48), 32, 0.7);

  holeGuide(ctx);
  return c;
}

(async () => {
  const logo = await loadLogoTinted();
  const art = ART_PATH ? await loadImage(ART_PATH) : null;
  console.log('art:', ART_PATH || '(placeholder)', '| base:', roster.baseUrl, '| out:', OUT);

  const list = ALL ? roster.students : roster.students.slice(0, 1);
  const front = await renderFront(art, logo);           // front is identical for everyone
  fs.writeFileSync(path.join(OUT, 'FRONT.png'), front.toBuffer('image/png'));

  for (const s of list) {
    const back = await renderBack(s, art, logo);
    fs.writeFileSync(path.join(OUT, `${s.id}-B.png`), back.toBuffer('image/png'));
  }
  console.log(`✓ FRONT.png + ${list.length} back(s) rendered at 300dpi (${W}×${H}px, 3mm bleed)`);
  if (!ALL) console.log('proof only — run with --all for all 48');
})().catch(e => { console.error(e); process.exit(1); });
