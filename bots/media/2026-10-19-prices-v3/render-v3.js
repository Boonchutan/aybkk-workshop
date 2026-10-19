// Two-section price poster: Unlimited membership + Package membership + member notes.
// node render-v3.js copy.json [outPrefix]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const F = 'file:///home/user/aybkk-workshop/public';
const OUT = __dirname;
const C = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const PREFIX = process.argv[3] || 'AYBKK-prices-12Nov-v3';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NOWRAP = ['LINE @aybkk', 'ปัญหาดวงตา', 'หรือตั้งครรภ์และคลอดบุตร', 'ก่อนเริ่มพักทุกครั้ง', 'คุยกับเราได้', 'ใบรับรองแพทย์', '30%', 'ไม่เกิน 2 เดือน', 'ยังไม่เกิน 70%', 'กรณีกระดูกหัก', 'กรุงเทพฯ', '฿1,500', 'วันหมดอายุเดิม'];
const keep = s => NOWRAP.reduce((t, w) => t.split(w).join(`<span style="white-space:nowrap">${w}</span>`), esc(s));

const SIZES = {
  post: { w: 1080, h: 1350, head: 178, rowH: 92, packH: 68, gap: 9, title: 70, pad: 52, polFs: 19, safeB: 30, photoY: '46%', secFs: 20, noteFs: 19, prFs: 46 },
  story: { w: 1080, h: 1920, head: 262, rowH: 108, packH: 82, gap: 13, title: 96, pad: 60, polFs: 23, safeB: 262, photoY: '20%', secFs: 22, noteFs: 21, prFs: 50 },
};

const page = (t, s, lang) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
@font-face{font-family:'Work Sans';src:url('${F}/fonts/worksans.woff2') format('woff2');font-weight:100 900}
@font-face{font-family:'ThaiV';src:url('${F}/fonts/notothai-th.woff2') format('woff2');unicode-range:U+0E01-0E5B;font-weight:100 900}
@font-face{font-family:'Cormorant';src:url('${F}/fonts/cormorant.woff2') format('woff2');font-weight:300 700;font-style:normal italic}
*{box-sizing:border-box;margin:0;padding:0}
body{width:${s.w}px;height:${s.h}px;background:#3E1442;color:#FBF5F9;font-family:'Work Sans','ThaiV',sans-serif;overflow:hidden;
  display:flex;flex-direction:column;font-variant-numeric:tabular-nums lining-nums}
.head{height:${s.head}px;flex:none;display:flex;flex-direction:column;justify-content:flex-end;padding:0 ${s.pad + 11}px 6px;
  background:linear-gradient(180deg,rgba(62,20,66,.05) 15%,rgba(62,20,66,.98) 96%),#3E1442 url('${F}/img/aybkk-hero-1600.jpg') center ${s.photoY}/cover no-repeat}
.brand{font-weight:900;font-size:26px;letter-spacing:.16em;color:#F2D98A}
h1{font-weight:900;font-size:${s.title}px;line-height:1;letter-spacing:-.02em;margin-top:6px;text-shadow:0 3px 16px rgba(0,0,0,.35)}
.sub{padding:10px ${s.pad + 11}px 0;font-size:22px;font-weight:600;color:#E6D3E7}
.sub b{color:#F2D98A;font-weight:800}
.sec{display:flex;align-items:baseline;gap:14px;padding:${s.gap + 8}px ${s.pad + 11}px 0}
.sec h2{font-size:${s.secFs}px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#F2D98A;white-space:nowrap}
.sec span{font-size:${s.secFs - 1}px;font-weight:600;color:#C9AFCB;white-space:nowrap}
.sec:after{content:'';flex:1;height:1.5px;background:rgba(242,217,138,.35);align-self:center}
.rows{padding:${s.gap - 2}px ${s.pad - 14}px 0;display:flex;flex-direction:column;gap:${s.gap}px}
.row{height:${s.rowH}px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-radius:18px;
  background:rgba(251,245,249,.06);border:1.5px solid rgba(251,245,249,.14)}
.row.pack{height:${s.packH}px}
.row.pick{background:#F2C94C;color:#3E1442;border-color:#F2C94C;box-shadow:0 10px 30px rgba(0,0,0,.28)}
.l{display:flex;flex-direction:column;gap:7px;min-width:0}
.nm{font-size:36px;font-weight:800;line-height:1;letter-spacing:-.01em;display:flex;align-items:baseline;gap:12px;white-space:nowrap}
.pack .nm{font-size:30px}
.nm small{font-size:19px;font-weight:700;color:#F2D98A;letter-spacing:.02em}
.badge{font-size:16px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;background:#3E1442;color:#F2C94C;padding:6px 11px;border-radius:99px;align-self:center}
.note{font-size:${s.noteFs}px;font-weight:500;color:#D9C3DB;white-space:nowrap}
.pick .note{color:#5a2a5e;font-weight:600}
.r{text-align:right;flex:none}
.pr{font-size:${s.prFs}px;font-weight:900;line-height:1;letter-spacing:-.02em}
.pack .pr{font-size:${s.prFs - 8}px}
.pr small{font-size:17px;font-weight:700;letter-spacing:0;margin-left:5px;opacity:.75;vertical-align:4px}
.pr i{font-style:normal;font-size:28px;font-weight:700;margin-right:4px;vertical-align:6px}
.per{font-size:${s.noteFs}px;font-weight:600;color:#C9AFCB;margin-top:6px}
.pick .per{color:#3E1442;font-size:${s.noteFs + 2}px;font-weight:800}
.vat{padding:${s.gap}px ${s.pad + 11}px 0;font-size:${s.noteFs}px;font-weight:600;color:#E6D3E7}
.pol{margin:${s.gap + 4}px ${s.pad - 14}px 0;padding:16px 24px 18px;border-radius:18px;border:1.5px solid rgba(242,217,138,.45)}
.pol h3{font-size:18px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#F2D98A;margin-bottom:8px}
.pol p{font-size:${s.polFs}px;line-height:1.36;color:#EDE1EE;margin-top:5px;text-wrap:pretty}
.pol p b{color:#FBF5F9;font-weight:800}
.foot{margin-top:auto;padding:0 ${s.pad + 11}px ${s.safeB}px;display:flex;align-items:flex-end;justify-content:space-between}
.bye{font-family:${lang === 'th' ? "'ThaiV'" : "'Cormorant'"},serif;font-style:${lang === 'th' ? 'normal' : 'italic'};font-weight:${lang === 'th' ? 700 : 600};font-size:${lang === 'th' ? 38 : 46}px;color:#F2D98A;line-height:1}
.url{font-size:20px;font-weight:700;color:#E6D3E7;margin-top:10px}
.logo{width:88px;height:88px;border-radius:50%;object-fit:cover;border:3px solid #F2D98A}
${lang === 'th' ? '.sec h2,.pol h3,.badge{letter-spacing:0;text-transform:none}.sec h2{font-size:' + (s.secFs + 4) + 'px}.pol h3{font-size:21px}.badge{font-size:20px;padding:4px 12px}' : ''}
</style></head><body>
<div class="head"><div class="brand">AYBKK</div><h1>${esc(t.title)}</h1></div>
<p class="sub"><b>${esc(t.date)}</b></p>
<div class="sec"><h2>${esc(t.sec1)}</h2><span>${esc(t.sec1note)}</span></div>
<div class="rows">${t.rows.map(r => `<div class="row${r.pick ? ' pick' : ''}">
  <div class="l"><div class="nm">${esc(r.name)}${r.tag ? `<small>${esc(r.tag)}</small>` : ''}${r.badge ? `<span class="badge">${esc(r.badge)}</span>` : ''}</div><div class="note">${esc(r.note)}</div></div>
  <div class="r"><div class="pr"><i>฿</i>${r.price}${t.vatTag ? `<small>${esc(t.vatTag)}</small>` : ''}</div>${r.per ? `<div class="per">${esc(r.per)}</div>` : ''}</div></div>`).join('')}</div>
<div class="sec"><h2>${esc(t.sec2)}</h2><span>${esc(t.sec2note || '')}</span></div>
<div class="rows">${t.packs.map(r => `<div class="row pack">
  <div class="l"><div class="nm">${esc(r.name)}</div>${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}</div>
  <div class="r"><div class="pr"><i>฿</i>${r.price}${t.vatTag ? `<small>${esc(t.vatTag)}</small>` : ''}</div></div></div>`).join('')}</div>
<p class="vat">${esc(t.vat)}</p>
<div class="pol"><h3>${esc(t.polH)}</h3>${t.pol.map(([b, rest]) => `<p><b>${keep(b)}</b>${keep(rest || '')}</p>`).join('')}</div>
<div class="foot"><div><div class="bye">${esc(t.bye)}</div><div class="url">aybkk.net · LINE @aybkk</div></div><img class="logo" src="${F}/img/aybkk-logo-240.jpg"></div>
</body></html>`;

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const report = [];
  for (const lang of Object.keys(C)) for (const [size, s] of Object.entries(SIZES)) {
    const file = `${OUT}/${PREFIX}-${lang.toUpperCase()}-${size}.html`;
    fs.writeFileSync(file, page(C[lang], s, lang));
    const pg = await br.newPage({ viewport: { width: s.w, height: s.h } });
    await pg.goto('file://' + file); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(400);
    const fit = await pg.evaluate(() => {
      const over = [...document.querySelectorAll('.note,.nm,.sec,.pol p,.sub,.vat')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className + ':' + e.textContent.slice(0, 30));
      const foot = document.querySelector('.foot').getBoundingClientRect(), pol = document.querySelector('.pol').getBoundingClientRect();
      return { over, gap: Math.round(foot.top - pol.bottom) };
    });
    await pg.screenshot({ path: file.replace('.html', '.jpg'), type: 'jpeg', quality: 92 });
    report.push(`${PREFIX}-${lang.toUpperCase()}-${size}.jpg over=${JSON.stringify(fit.over)} gap=${fit.gap}`);
    await pg.close();
  }
  await br.close();
  console.log(report.join('\n'));
})();
