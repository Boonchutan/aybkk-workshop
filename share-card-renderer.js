/**
 * AYBKK Share Card Renderer (server-side, mirrors student.html canvas output)
 *
 * Generates a 640×720 PNG matching the "Share to WeChat" canvas card design
 * from public/student.html (line ~1599). Light day-color pastel gradient,
 * photo at 0.7 opacity over it, day-color tinted overlay, white text.
 *
 * Inputs:
 *   {
 *     name: 'Boonchu Tanti',
 *     subtitle: 'AYBKK RUSSIA WS 2026',
 *     dateInfo: 'Mon, May 1 • Practice Journal saved ✅',
 *     quote: 'Atha Yoganushasanam',
 *     uplift: '',                         // optional larger phrase below quote
 *     photoUrl: 'https://...jpg',        // optional
 *     dayIndex: 0..6,                    // override day-of-week (Mon=0..Sun=6)
 *   }
 *
 * Returns: Buffer (PNG bytes)
 */

const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// Register Playfair Display (vintage, high-contrast serif). Bundled in /fonts.
// Registering once at module load is OK — GlobalFonts dedupes.
try {
  GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'PlayfairDisplay-Bold.ttf'), 'Playfair Display');
  GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'PlayfairDisplay-BoldItalic.ttf'), 'Playfair Display Italic');
} catch (e) {
  console.warn('[share-card] Playfair font register failed:', e.message);
}

// Day-of-week pastel palette — matches DAY_COLORS in public/student.html
const DAY_COLORS = [
  { accent: '#7BAF7A', light: '#F0F7F0', hover: '#6A9E6A' }, // Monday   — Sage Green
  { accent: '#D4836A', light: '#FBF0ED', hover: '#C4725A' }, // Tuesday  — Soft Terracotta
  { accent: '#D4A574', light: '#F5EDE4', hover: '#C49564' }, // Wednesday— Warm Gold
  { accent: '#D9A066', light: '#F8F0E4', hover: '#C99055' }, // Thursday — Pastel Orange
  { accent: '#7AABBF', light: '#EDF4F7', hover: '#699AAE' }, // Friday   — Dusty Blue
  { accent: '#A085B8', light: '#F2EDF6', hover: '#8F74A7' }, // Saturday — Soft Lavender
  { accent: '#A3ADA8', light: '#F3F4F3', hover: '#929C97' }, // Sunday   — Mist Gray
];

const W = 640;
const H = 720;

function todayDayIndex() {
  const d = new Date().getDay();      // Sun=0..Sat=6
  return d === 0 ? 6 : d - 1;          // map → Mon=0..Sun=6
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function tryLoadImage(src) {
  if (!src) return null;
  try {
    if (typeof src === 'string' && /^https?:\/\//.test(src)) {
      // Explicit fetch → buffer → loadImage. More reliable than letting @napi-rs/canvas
      // do the download itself, especially for Cloudinary CDN URLs and HTTPS redirects.
      const res = await fetch(src);
      if (!res.ok) throw new Error(`http ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      console.log('[share-card] fetched image:', buf.length, 'bytes from', src.slice(0, 80));
      return await loadImage(buf);
    }
    return await loadImage(src);
  } catch (e) {
    console.warn('[share-card] image load FAILED:', src, '-', e.message);
    return null;
  }
}

function wrapLines(ctx, text, maxWidth) {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function renderShareCard(opts = {}) {
  const {
    name = 'Student',
    subtitle = 'AYBKK PRACTICE JOURNAL',
    dateInfo = '',
    quote = '',
    uplift = '',
    photoUrl = '',
    logoPath = path.join(__dirname, 'public', 'aybkk-logo.jpg'),
    dayIndex = todayDayIndex(),
  } = opts;

  const dc = DAY_COLORS[Math.max(0, Math.min(6, dayIndex))];

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── 1. Pastel day-color base gradient ──────────────────────────────
  const baseGrad = ctx.createLinearGradient(0, 0, W, H);
  baseGrad.addColorStop(0, dc.accent);
  baseGrad.addColorStop(0.5, dc.hover);
  baseGrad.addColorStop(1, dc.accent);
  ctx.fillStyle = baseGrad;
  roundedRectPath(ctx, 0, 0, W, H, 32);
  ctx.fill();

  // ── 2. Photo at 70% opacity ────────────────────────────────────────
  const photoImg = await tryLoadImage(photoUrl);
  if (photoImg) {
    ctx.save();
    roundedRectPath(ctx, 0, 0, W, H, 32);
    ctx.clip();

    ctx.globalAlpha = 0.92;
    const scale = Math.max(W / photoImg.width, H / photoImg.height);
    const sw = photoImg.width * scale;
    const sh = photoImg.height * scale;
    const sx = (W - sw) / 2;
    const sy = (H - sh) / 2;
    ctx.drawImage(photoImg, sx, sy, sw, sh);
    ctx.globalAlpha = 1;

    // Light day-color tint — just enough so the white text reads,
    // keeps the photo dominant. Stronger at top/bottom (where text sits).
    const overlay = ctx.createLinearGradient(0, 0, 0, H);
    overlay.addColorStop(0, dc.accent + '66');     // ~40% top   (logo + subtitle area)
    overlay.addColorStop(0.25, dc.accent + '1A');  // ~10% upper-mid
    overlay.addColorStop(0.55, 'rgba(0,0,0,0)');   //   0% mid   (face shows through)
    overlay.addColorStop(0.85, dc.hover + '33');   // ~20% lower
    overlay.addColorStop(1, dc.accent + '66');     // ~40% bottom (byline area)
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  // ── 3. Subtle depth highlight + foot shadow ───────────────────────
  const depth = ctx.createLinearGradient(0, 0, 0, H);
  depth.addColorStop(0, 'rgba(255,255,255,0.15)');
  depth.addColorStop(0.5, 'rgba(255,255,255,0)');
  depth.addColorStop(1, 'rgba(0,0,0,0.1)');
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;

  // ── 4. Logo (circular, lower than before — better visual balance) ──
  const logoImg = await tryLoadImage(logoPath);
  const logoR = 38;
  const logoCy = 110;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, logoCy, logoR, 0, Math.PI * 2);
  ctx.clip();
  if (logoImg) {
    ctx.drawImage(logoImg, cx - logoR, logoCy - logoR, logoR * 2, logoR * 2);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - logoR, logoCy - logoR, logoR * 2, logoR * 2);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, logoCy, logoR, 0, Math.PI * 2);
  ctx.stroke();

  // ── 5. Subtitle (uppercase, sans, letter-spaced white) ─────────────
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 14px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(subtitle), cx, logoCy + logoR + 28);

  // ── 6. Decorative thin line ───────────────────────────────────────
  const accentY = logoCy + logoR + 52;
  const accentGrad = ctx.createLinearGradient(cx - 30, accentY, cx + 30, accentY);
  accentGrad.addColorStop(0, 'rgba(255,255,255,0)');
  accentGrad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  accentGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = accentGrad;
  ctx.fillRect(cx - 30, accentY, 60, 1.5);

  // ── 7. Student name — Playfair Display (vintage high-contrast serif) ─
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px "Playfair Display", Georgia, "Times New Roman", serif';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10;
  let displayName = String(name);
  while (ctx.measureText(displayName).width > W - 60 && displayName.length > 0) {
    displayName = displayName.slice(0, -1);
  }
  ctx.fillText(displayName, cx, accentY + 65);
  ctx.shadowBlur = 0;

  // ── 8. Date info ───────────────────────────────────────────────────
  if (dateInfo) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '500 19px Georgia, "Times New Roman", serif';
    ctx.fillText(String(dateInfo), cx, accentY + 105);
  }

  // ── 9. Divider ─────────────────────────────────────────────────────
  const dividerY = accentY + 145;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(110, dividerY);
  ctx.lineTo(W - 110, dividerY);
  ctx.stroke();

  // ── 10. Quote (Playfair italic, wrapped) ───────────────────────────
  let yCursor = dividerY + 50;
  if (quote) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '700 22px "Playfair Display Italic", Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    const lines = wrapLines(ctx, '"' + quote + '"', W - 90);
    for (const line of lines) {
      ctx.fillText(line, cx, yCursor);
      yCursor += 34;
    }
    yCursor += 8;
  }

  // ── 11. Uplift (optional, larger white serif) ──────────────────────
  if (uplift) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(220, yCursor);
    ctx.lineTo(420, yCursor);
    ctx.stroke();
    yCursor += 36;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Georgia, "Times New Roman", serif';
    const uLines = wrapLines(ctx, uplift, W - 70);
    for (const line of uLines) {
      ctx.fillText(line, cx, yCursor);
      yCursor += 32;
    }
  }

  // ── 12. Byline at bottom ───────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'italic 15px Georgia, "Times New Roman", serif';
  ctx.fillText('by Boonchu Tanti & Jamsai Tanti', cx, H - 45);

  return canvas.toBuffer('image/png');
}

module.exports = { renderShareCard, DAY_COLORS };
