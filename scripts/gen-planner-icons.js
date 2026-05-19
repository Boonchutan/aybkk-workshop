/**
 * Jamsai & Boonchu planner app icon.
 * Apple liquid-glass tile: light frosted base with soft Pantone
 * colour blooms, modern SF monogram "JS" over "BT", high contrast.
 * No carved wood, no heavy bevel; flat-glass to match the app.
 */
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

let FF = 'sans-serif';
for (const p of ['/System/Library/Fonts/SFNS.ttf',
                 '/System/Library/Fonts/HelveticaNeue.ttc',
                 '/System/Library/Fonts/Helvetica.ttc']) {
  if (fs.existsSync(p)) { try { GlobalFonts.registerFromPath(p, 'IconSans'); FF = 'IconSans'; break; } catch (e) {} }
}

// faux-bold: stack a few sub-pixel passes so weight is reliable
function heavy(x, text, cx, cy, size, color, spread) {
  x.fillStyle = color;
  x.font = `${size}px "${FF}"`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const s = spread || size * 0.012;
  for (const [dx, dy] of [[-s,0],[s,0],[0,-s],[0,s],[0,0]]) x.fillText(text, cx+dx, cy+dy);
}

function bloom(x, cx, cy, r, color, a) {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color + a);
  g.addColorStop(1, color + '00');
  x.fillStyle = g;
  x.fillRect(0, 0, x.canvas.width, x.canvas.height);
}

function draw(size, inset) {
  const cv = createCanvas(size, size);
  const x = cv.getContext('2d');
  const m = size * (inset || 0);

  // light glass base
  const base = x.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#eef0f5');
  base.addColorStop(1, '#e4e7ef');
  x.fillStyle = base;
  x.fillRect(0, 0, size, size);

  // soft Pantone blooms (the app palette)
  bloom(x, size * 0.20, size * 0.18, size * 0.66, '#E8503A', 'a0');
  bloom(x, size * 0.86, size * 0.26, size * 0.58, '#F0962E', '8c');
  bloom(x, size * 0.82, size * 0.88, size * 0.70, '#3FB3CC', '9a');
  bloom(x, size * 0.16, size * 0.90, size * 0.58, '#5FA463', '7c');

  // frosted veil → milky glass (lighter, lets the colour through)
  x.fillStyle = 'rgba(255,255,255,0.30)';
  x.fillRect(0, 0, size, size);
  // gentle top sheen
  const sheen = x.createLinearGradient(0, m, 0, size * 0.6);
  sheen.addColorStop(0, 'rgba(255,255,255,0.40)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = sheen;
  x.fillRect(0, 0, size, size);

  // monogram: JS over BT, high-contrast ink
  const ink = '#15171a';
  const gs = size * 0.345;
  heavy(x, 'JS', size/2, size * 0.385, gs, ink);
  heavy(x, 'BT', size/2, size * 0.655, gs, ink);

  // thin Pantone divider between the two
  const dw = size * 0.30;
  x.fillStyle = '#2E4A6B';
  const dh = Math.max(2, size * 0.018);
  x.fillRect((size - dw) / 2, size * 0.52 - dh / 2, dw, dh);

  return cv.toBuffer('image/png');
}

const out = path.join(__dirname, '..', 'public');
const jobs = [
  ['planner-icon-180.png', 180, 0],     // apple-touch (iOS masks corners)
  ['planner-icon-192.png', 192, 0],
  ['planner-icon-512.png', 512, 0],
  ['planner-icon-512-maskable.png', 512, 0.10],  // Android safe zone
];
for (const [name, size, inset] of jobs) {
  fs.writeFileSync(path.join(out, name), draw(size, inset));
  console.log('wrote', name, `${size}x${size}`, FF);
}
