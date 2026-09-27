// AYBKK quote/event carousel cards: a photo with a narrow text column in the top-left or top-right corner.
// Usage: NODE_PATH=<scratch>/node_modules node scripts/quote-card.js <cards.json> <outdir> [n,n,...]
// Install once into the scratchpad: npm i --no-save --prefix <scratch> playwright-core @fontsource/inter
//   @fontsource/source-serif-4 @fontsource/noto-serif-sc @fontsource/eb-garamond
// Card: {n, image, kicker, native? + lang ('zh'|'la'), original, source?, kid, crop?, side? ('L'|'R'), col?, scale?, forceBrand?, noBrand?}
// 1080x1350 JPEG. The column is at most W/4 wide, 40px from the edges and aligned to its side: thick yellow serif
// with a dense soft shadow, bold white with a hard black edge (Boonchu's spec, 25 Sep 2026).
const { chromium } = require('playwright-core'); const fs = require('fs'); const path = require('path');
const FS = path.join(path.dirname(require.resolve('@fontsource/inter/package.json')), '..');
const CSS = ['noto-serif-sc/900.css', 'source-serif-4/900.css', 'source-serif-4/700-italic.css', 'inter/800.css', 'eb-garamond/600.css'];
const NAT = { zh: ["'Noto Serif SC'", 900, 38, '.06em'], la: ["'Source Serif 4'", 900, 27, '0'] };
const W = 1080, H = 1350, COL = 270, M = 40;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
(async () => {
  const cards = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const outdir = process.argv[3];
  const only = process.argv[4] ? process.argv[4].split(',').map(Number) : null; fs.mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const report = [];
  for (const c of cards) {
    if (only && !only.includes(c.n)) continue;
    const [nfam, nwt, nsize, nls] = NAT[c.lang || 'la'];
    const html = `<!doctype html><html><head><meta charset="utf-8">${CSS.map(f => `<link rel="stylesheet" href="file://${FS}/${f}">`).join('')}
<style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#17121a}
.photo{position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover;object-position:50% 50%}
.block{position:absolute;top:${M}px;width:${c.col || COL}px}
.block.L{left:${M}px;text-align:left}.block.R{right:${M}px;text-align:right}
.kick{font-family:'Inter',sans-serif;font-weight:800;font-size:var(--k);line-height:1.15;letter-spacing:.02em;word-spacing:.08em;color:#fff;margin-bottom:12px;text-wrap:balance}
.nat{font-family:${nfam},'Noto Serif SC',serif;font-weight:${nwt};font-size:var(--n);line-height:1.22;letter-spacing:${nls};margin-bottom:10px;text-wrap:balance${c.lang === 'zh' ? ';white-space:nowrap' : ''}}
.orig{font-family:'Source Serif 4','Noto Serif SC',serif;font-weight:900;font-size:var(--o);line-height:1.17;text-wrap:pretty}
.src{margin-top:8px;font-family:'Source Serif 4',serif;font-style:italic;font-weight:700;font-size:var(--s)}
.orig,.nat,.src{color:#ffe45c;text-shadow:0 0 1px rgba(0,0,0,.95),0 1px 3px rgba(0,0,0,.9),0 0 8px rgba(0,0,0,.7),0 0 18px rgba(0,0,0,.45)}
.en{margin-top:22px;font-family:'Inter',sans-serif;font-weight:800;font-size:var(--e);line-height:1.2;letter-spacing:.012em;word-spacing:.1em;color:#fff;text-wrap:pretty}
.kick,.en{-webkit-text-stroke:var(--sw) #000;paint-order:stroke fill;text-shadow:0 2px 0 rgba(0,0,0,.55)}
.kick{--sw:3.5px}.en{--sw:4.5px}
.brand{position:absolute;left:50%;transform:translateX(-50%);bottom:34px;font-family:'EB Garamond',serif;font-weight:600;font-size:22px;letter-spacing:.34em;white-space:nowrap}
.brand.w{color:#fff;text-shadow:0 2px 3px rgba(0,0,0,.6),0 0 12px rgba(0,0,0,.5),0 0 28px rgba(0,0,0,.4)}
.brand.k{color:#17121a;text-shadow:0 0 2px rgba(255,255,255,.9),0 0 12px rgba(255,255,255,.75),0 0 28px rgba(255,255,255,.55)}
#veil{position:absolute;top:0;pointer-events:none;-webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 calc(100% - 200px),transparent 100%);mask-image:linear-gradient(to bottom,#000 0%,#000 calc(100% - 200px),transparent 100%)}
</style></head><body>
<img class="photo" id="ph" src="file://${c.image}">
<div id="veil"></div>
<div class="block L" id="block" style="--o:32px;--n:${nsize}px;--e:29px;--s:23px;--k:21px">
<div class="kick" id="k">${esc(c.kicker || '')}</div>
<div class="nat" id="n"${c.native ? '' : ' style="display:none"'}>${esc(c.native || '').replace(/\n/g, '<br>')}</div>
<div class="orig" id="o">${esc(c.original).replace(/\n/g, '<br>')}</div>
<div class="src" id="s"${c.source ? '' : ' style="display:none"'}>${esc(c.source || '')}</div>
<div class="en" id="e">${esc(c.kid).replace(/\n/g, '<br>')}</div>
</div>
<div class="brand" id="brand" style="display:none">AYBKK SHALA BANGKOK</div>
</body></html>`;
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const tmp = path.join(outdir, `_card${c.n}.html`); fs.writeFileSync(tmp, html);
    await page.goto('file://' + tmp); await page.waitForLoadState('load');
    const r = await page.evaluate(async ({ c, nfam, nwt, nsize, W, H, M }) => {
      const COL = c.col || 270;
      const ph = document.getElementById('ph'); await ph.decode(); await document.fonts.ready;
      const loads = { original: (await document.fonts.load(`900 32px 'Source Serif 4'`, c.original)).length, native: c.native ? (await document.fonts.load(`${nwt} ${nsize}px ${nfam}`, c.native)).length : -1, kid: (await document.fonts.load(`800 29px Inter`, c.kid)).length };
      const block = document.getElementById('block');
      // shrink only if a very long text would run past 62% of the height
      let s = c.scale || 1, ns = nsize; const set = k => { block.style.setProperty('--o', 32 * k + 'px'); block.style.setProperty('--n', ns * k + 'px'); block.style.setProperty('--e', Math.max(24, 29 * k) + 'px'); block.style.setProperty('--s', Math.max(20, 23 * k) + 'px'); };
      set(s); const nat = document.getElementById('n'), kick = document.getElementById('k');
      // the section title stays on one line when it can (down to 18.5px), otherwise it wraps into two balanced lines at full size
      kick.style.whiteSpace = 'nowrap'; let ks = 21; while (kick.scrollWidth > COL && ks > 18.5) { ks -= 0.5; block.style.setProperty('--k', ks + 'px'); }
      if (kick.scrollWidth > COL) { kick.style.whiteSpace = ''; block.style.setProperty('--k', '21px'); }
      // a Chinese line never wraps mid-phrase: shrink it until each written line fits the column
      if (c.native && c.lang === 'zh') while (nat.scrollWidth > COL && ns > 24) { ns -= 1; set(s); }
      while (block.getBoundingClientRect().bottom > 0.62 * H && s > 0.8) { s *= 0.98; set(s); }
      const GW = 36, GH = 54, cv = document.createElement('canvas'); cv.width = GW * 4; cv.height = GH * 4;
      const ctx = cv.getContext('2d'); ctx.drawImage(ph, 0, 0, cv.width, cv.height);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data; const E = new Float32Array(GW * GH), LUM = new Float32Array(GW * GH);
      const L = (x, y) => { const i = (y * cv.width + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
      let tot = 0;
      for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
        let skin = 0, grad = 0, lum = 0;
        for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
          const x = gx * 4 + xx, y = gy * 4 + yy, i = (y * cv.width + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
          lum += L(x, y);
          if (R > 95 && G > 40 && B > 20 && R > G && R > B && R - G > 15 && Math.max(R, G, B) - Math.min(R, G, B) > 15) skin++;
          if (x > 0 && y > 0) grad += Math.abs(L(x, y) - L(x - 1, y)) + Math.abs(L(x, y) - L(x, y - 1));
        }
        E[gy * GW + gx] = 0.7 * (skin / 16) + 0.3 * Math.min(1, grad / 16 / 60); LUM[gy * GW + gx] = lum / 16 / 255; tot += E[gy * GW + gx];
      }
      const imgH = ph.naturalHeight * W / ph.naturalWidth, excessPx = Math.max(0, imgH - H);
      const cellSum = (A, fx0, fx1, fy0, fy1, avg) => { let m = 0, a = 0; for (let gy = 0; gy < GH; gy++) { const oy = Math.max(0, Math.min(fy1, (gy + 1) / GH) - Math.max(fy0, gy / GH)); if (!oy) continue; for (let gx = 0; gx < GW; gx++) { const ox = Math.max(0, Math.min(fx1, (gx + 1) / GW) - Math.max(fx0, gx / GW)); if (!ox) continue; const w = ox * oy * GW * GH; m += A[gy * GW + gx] * w; a += w; } } return avg ? (a ? m / a : 0) : m; };
      const toF = (y, cr) => (y + cr * excessPx) / imgH;
      const wc = document.createElement('canvas'); wc.width = W; wc.height = Math.round(imgH); const wx = wc.getContext('2d'); wx.drawImage(ph, 0, 0, wc.width, wc.height);
      const y0w = Math.round(imgH * 0.86), wd = wx.getImageData(0, y0w, W, wc.height - y0w).data; let wmTop = imgH;
      const lumAt = (x, y) => { const i = (y * W + x) * 4; return 0.299 * wd[i] + 0.587 * wd[i + 1] + 0.114 * wd[i + 2]; };
      let run = 0;
      const hit = (x, y) => { const v = lumAt(x, y); return v > 200 && (v - lumAt(x - 3, y) > 45 || v - lumAt(x + 3, y) > 45); };
      for (let y = 0; y < wc.height - y0w; y++) { let n = 0, o = 0; for (let x = Math.round(W * 0.28); x < Math.round(W * 0.72); x++) if (hit(x, y)) n++; for (let x = 4; x < Math.round(W * 0.2); x++) { if (hit(x, y)) o++; if (hit(W - 1 - x, y)) o++; } if (n >= 6 && o * 3 <= n) { if (++run >= 3) { wmTop = y0w + y - 2; break; } } else run = 0; }
      const cr = c.crop != null ? c.crop : 0;
      const b0 = block.getBoundingClientRect(), top = b0.top, bot = b0.bottom;
      const side = { L: [M / W, (M + COL) / W], R: [(W - M - COL) / W, (W - M) / W] };
      const under = k => cellSum(E, side[k][0], side[k][1], toF(top, cr), toF(bot, cr), false) / tot;
      const pick = c.side || (under('L') <= under('R') ? 'L' : 'R');
      block.className = 'block ' + pick; const u = block.getBoundingClientRect();
      ph.style.objectPosition = `50% ${cr * 100}%`;
      const bgLum = cellSum(LUM, u.left / W, u.right / W, toF(u.top, cr), toF(u.bottom, cr), true);
      const va = Math.max(0.10, Math.min(0.45, (bgLum - 0.3) * 0.8));
      const veil = document.getElementById('veil'); const vw = M + COL + 170, vh = Math.min(H, u.bottom + 170);
      Object.assign(veil.style, { width: vw + 'px', height: vh + 'px', [pick === 'L' ? 'left' : 'right']: '0px',
        background: `linear-gradient(to ${pick === 'L' ? 'right' : 'left'},rgba(0,0,0,${va.toFixed(3)}) 0%,rgba(0,0,0,${(va * 0.8).toFixed(3)}) 55%,rgba(0,0,0,0) 100%)` });
      const wmVisible = !c.forceBrand && cr * excessPx + H > wmTop - 6;
      const brand = document.getElementById('brand'); let brandAt = wmVisible ? 'photo-watermark' : 'none';
      if (!wmVisible && !c.noBrand) {
        brand.style.display = 'block'; const b = brand.getBoundingClientRect();
        const busy = cellSum(E, b.left / W, b.right / W, toF(b.top, cr), toF(b.bottom, cr), true);
        if (busy > 0.45) { brand.style.display = 'none'; brandAt = 'omitted-busy'; } else { const bl = cellSum(LUM, b.left / W, b.right / W, toF(b.top, cr), toF(b.bottom, cr), true); brand.className = 'brand ' + (bl > 0.62 ? 'k' : 'w'); brandAt = 'bottom-center/' + (bl > 0.62 ? 'dark' : 'white') + '@' + bl.toFixed(2); }
      }
      const lineW = Math.max(...['k', 'o', 'e', 'n', 's'].map(id => { const el = document.getElementById(id); if (el.style.display === 'none') return 0; const rg = document.createRange(); rg.selectNodeContents(el); return Math.max(...[...rg.getClientRects()].map(q => q.width)); }));
      return { loads, scale: +s.toFixed(3), side: pick, underL: +(under('L') * 100).toFixed(1), underR: +(under('R') * 100).toFixed(1), block: { top: Math.round(u.top), bottom: Math.round(u.bottom), w: Math.round(u.width), maxLine: Math.round(lineW) }, crop: cr, veil: +va.toFixed(2), bgLum: +bgLum.toFixed(2), brand: brandAt };
    }, { c, nfam, nwt, nsize, W, H, M });
    const out = path.join(outdir, String(c.n).padStart(2, '0') + '.jpg');
    await page.screenshot({ path: out, type: 'jpeg', quality: 92 }); await page.close(); fs.unlinkSync(tmp);
    const flag = (!r.loads.original ? ' NO-ORIG-FONT' : '') + (r.loads.native === 0 ? ' NO-NATIVE-FONT' : '') + (r.block.maxLine > (c.col || COL) + 1 ? ' OVERFLOW' : '') + (r.block.bottom > 0.62 * H ? ' TALL' : '');
    console.log(`${String(c.n).padStart(2, '0')} side=${r.side} (under L ${r.underL}% / R ${r.underR}%) y=${r.block.top}-${r.block.bottom} (${(r.block.bottom / H * 100).toFixed(0)}%) maxLine=${r.block.maxLine} scale=${r.scale} crop=${r.crop} veil=${r.veil} bgLum=${r.bgLum} brand=${r.brand}${flag}`);
    report.push({ n: c.n, out, ...r });
  }
  fs.writeFileSync(path.join(outdir, 'report.json'), JSON.stringify(report, null, 1)); await browser.close();
})();
