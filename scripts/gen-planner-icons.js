/**
 * Generates the AYBKK Year Planner home-screen icons.
 * Beech-wood tile, serif "A" carved into the grain (carved-clay
 * light/shadow), a quiet baseline rule for the timeline signal.
 * Editorial / lineage register — never a generic calendar glyph.
 */
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

GlobalFonts.registerFromPath(
  path.join(__dirname, '..', 'fonts', 'PlayfairDisplay-Bold.ttf'),
  'Playfair Display'
);

// inset = maskable safe-zone fraction (0 = full bleed for apple-touch)
function draw(size, inset = 0) {
  const cv = createCanvas(size, size);
  const x = cv.getContext('2d');
  const m = size * inset;            // safe-zone margin
  const s = size - m * 2;            // drawable tile size
  const cx = size / 2;

  // --- beech field: warm radial, walnut toward the edges ---
  const g = x.createRadialGradient(cx, size * 0.42, s * 0.08, cx, cx, s * 0.78);
  g.addColorStop(0, '#e3cb9e');
  g.addColorStop(0.55, '#d2b487');
  g.addColorStop(1, '#a9885c');
  x.fillStyle = '#b8956a';
  x.fillRect(0, 0, size, size);
  x.fillStyle = g;
  x.fillRect(m, m, s, s);

  // --- faint vertical grain ---
  x.save();
  x.beginPath(); x.rect(m, m, s, s); x.clip();
  x.lineWidth = Math.max(1, size / 360);
  for (let i = 0; i < 14; i++) {
    const gx = m + (s / 13) * i + Math.sin(i * 1.7) * s * 0.012;
    x.strokeStyle = i % 2 ? 'rgba(120,92,58,0.05)' : 'rgba(255,244,224,0.05)';
    x.beginPath(); x.moveTo(gx, m); x.lineTo(gx, m + s); x.stroke();
  }
  x.restore();

  // --- carved serif "A" ---
  const fs1 = s * 0.62;
  x.font = `${fs1}px "Playfair Display"`;
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  const ay = cx + fs1 * 0.30;        // optical centering for the cap

  // light edge (upper-left), then shadow (lower-right), then face
  x.fillStyle = 'rgba(253,247,232,0.85)';
  x.fillText('A', cx - size * 0.006, ay - size * 0.006);
  x.fillStyle = 'rgba(58,42,22,0.55)';
  x.fillText('A', cx + size * 0.011, ay + size * 0.011);
  x.fillStyle = '#6a5132';
  x.fillText('A', cx, ay);

  // --- baseline rule = the timeline ---
  const ry = m + s * 0.80;
  const rx0 = m + s * 0.20, rx1 = m + s * 0.80;
  x.strokeStyle = 'rgba(58,42,22,0.42)';
  x.lineWidth = Math.max(2, size / 150);
  x.beginPath(); x.moveTo(rx0, ry); x.lineTo(rx1, ry); x.stroke();
  x.strokeStyle = 'rgba(253,247,232,0.5)';
  x.beginPath(); x.moveTo(rx0, ry + x.lineWidth); x.lineTo(rx1, ry + x.lineWidth); x.stroke();
  // four quiet ticks (quarters of the year)
  x.fillStyle = 'rgba(58,42,22,0.5)';
  for (let i = 0; i < 4; i++) {
    const tx = rx0 + ((rx1 - rx0) / 3) * i;
    x.fillRect(tx - x.lineWidth / 2, ry - s * 0.022, x.lineWidth, s * 0.044);
  }

  return cv.toBuffer('image/png');
}

const out = path.join(__dirname, '..', 'public');
const jobs = [
  ['planner-icon-180.png', 180, 0],     // apple-touch (iOS masks it)
  ['planner-icon-192.png', 192, 0],
  ['planner-icon-512.png', 512, 0],
  ['planner-icon-512-maskable.png', 512, 0.11],
];
for (const [name, size, inset] of jobs) {
  fs.writeFileSync(path.join(out, name), draw(size, inset));
  console.log('wrote', name, `${size}x${size}`);
}
