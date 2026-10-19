const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const F = 'file:///home/user/aybkk-workshop/public';
const OUT = __dirname;

const C = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NOWRAP = ['LINE @aybkk', 'ปัญหาดวงตา', 'หรือตั้งครรภ์และคลอดบุตร', 'ก่อนเริ่มพักทุกครั้ง', '(หรือตามใบรับรองแพทย์)', 'คุยกับเราได้', 'โอนหรือแบ่งกันใช้ไม่ได้', 'ฝึกกันยาว ๆ', 'กระดูกหัก'];
const keep = s => NOWRAP.reduce((t, w) => t.split(w).join(`<span style="white-space:nowrap">${w}</span>`), esc(s));
const build = (c, base) => ({
  brand: 'AYBKK', title: base.title, sub: `<b>${esc(base.date)}</b> · ${esc(c.sub)}`,
  rows: [
    { name: base.n[0], tag: esc(c.tag12), note: esc(c.note12), price: '59,900', per: base.per[0] },
    { name: base.n[1], badge: esc(c.badge6), note: esc(c.note6), price: '32,000', per: base.per[1], pick: true },
    { name: base.n[2], note: esc(c.note3), price: '22,000', per: base.per[2] },
    { name: base.n[3], note: esc(c.note1), price: '9,600', per: base.per[3] },
  ],
  extras: [c.extras.split(' · ').map(esc)],
  vat: esc(c.vat), polH: esc(c.box_heading),
  pol: [c.refund, c.freeze, c.one_person].map(p => { const m = p.match(/^(.+?[.:!?]|[^ ]+ [^ ]+ [^ ]+)(\s.*)?$/s); return [keep(m ? m[1] : p), m && m[2] ? keep(m[2]) : '']; }),
  bye: esc(c.footer), url: 'aybkk.net · LINE @aybkk',
});
const T = {
  en: build(C.en, { title: 'Membership', date: 'New prices from 12 Nov 2026', n: ['12 months', '6 months', '3 months', '1 month'], per: ['about 4,600 / month', 'about 5,300 / month', 'about 7,300 / month', '9,600 / month'] }),
  th: build(C.th, { title: 'แพ็กเกจสมาชิก', date: 'ราคาใหม่ เริ่ม 12 พ.ย. 2569', n: ['12 เดือน', '6 เดือน', '3 เดือน', '1 เดือน'], per: ['ตกเดือนละราว 4,600', 'ตกเดือนละราว 5,300', 'ตกเดือนละราว 7,300', 'เดือนละ 9,600'] }),
};
if (C.en.pol_bold) T.en.pol = C.en.pol_bold.map(([b, r]) => [keep(b), keep(r)]);
if (C.th.pol_bold) T.th.pol = C.th.pol_bold.map(([b, r]) => [keep(b), keep(r)]);

// story: Instagram covers about the top and bottom 250px, so the footer sits above safeB.
const SIZES = {
  post: { w: 1080, h: 1350, head: 250, rowH: 118, gap: 12, title: 84, pad: 52, polFs: 22, safeB: 42, photoY: '46%' },
  story: { w: 1080, h: 1920, head: 420, rowH: 140, gap: 18, title: 104, pad: 60, polFs: 26, safeB: 270, photoY: '20%' },
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
.sub{padding:12px ${s.pad + 11}px 0;font-size:23px;font-weight:600;color:#E6D3E7}
.sub b{color:#F2D98A;font-weight:800}
.rows{padding:${s.gap + 10}px ${s.pad - 14}px 0;display:flex;flex-direction:column;gap:${s.gap}px}
.row{height:${s.rowH}px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-radius:18px;
  background:rgba(251,245,249,.06);border:1.5px solid rgba(251,245,249,.14);position:relative}
.row.pick{background:#F2C94C;color:#3E1442;border-color:#F2C94C;box-shadow:0 10px 30px rgba(0,0,0,.28)}
.l{display:flex;flex-direction:column;gap:8px;min-width:0}
.nm{font-size:38px;font-weight:800;line-height:1;letter-spacing:-.01em;display:flex;align-items:baseline;gap:12px;white-space:nowrap}
.nm small{font-size:20px;font-weight:700;color:#F2D98A;letter-spacing:.02em}
.badge{font-size:17px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;background:#3E1442;color:#F2C94C;padding:6px 11px;border-radius:99px;align-self:center}
.note{font-size:21px;font-weight:500;color:#D9C3DB;white-space:nowrap}
.pick .note{color:#5a2a5e;font-weight:600}
.r{text-align:right;flex:none}
.pr{font-size:52px;font-weight:900;line-height:1;letter-spacing:-.02em}
.pr i{font-style:normal;font-size:30px;font-weight:700;margin-right:4px;vertical-align:6px}
.per{font-size:21px;font-weight:600;color:#C9AFCB;margin-top:7px}
.pick .per{color:#3E1442;font-size:24px;font-weight:800}
.ex{padding:${s.gap + 6}px ${s.pad + 11}px 0;display:flex;flex-direction:column;gap:6px;font-size:21px;font-weight:600;color:#E6D3E7}
.ex em{font-style:normal;color:#8f6f93;margin:0 12px}
.vat{padding:10px ${s.pad + 11}px 0;font-size:21px;font-weight:600;color:#E6D3E7}
.pol{margin:${s.gap + 8}px ${s.pad - 14}px 0;padding:18px 24px 20px;border-radius:18px;border:1.5px solid rgba(242,217,138,.45)}
.pol h2{font-size:18px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#F2D98A;margin-bottom:10px}
.pol p{font-size:${s.polFs}px;line-height:1.38;color:#EDE1EE;margin-top:6px;text-wrap:pretty}
.pol p b{color:#FBF5F9;font-weight:800}
.foot{margin-top:auto;padding:0 ${s.pad + 11}px ${s.safeB}px;display:flex;align-items:flex-end;justify-content:space-between}
.bye{font-family:${lang === 'th' ? "'ThaiV'" : "'Cormorant'"},serif;font-style:${lang === 'th' ? 'normal' : 'italic'};font-weight:${lang === 'th' ? 700 : 600};font-size:${lang === 'th' ? 40 : 48}px;color:#F2D98A;line-height:1}
.url{font-size:20px;font-weight:700;color:#E6D3E7;margin-top:10px}
.logo{width:96px;height:96px;border-radius:50%;object-fit:cover;border:3px solid #F2D98A}
${lang === 'th' ? '.pol h2,.badge{letter-spacing:0;text-transform:none}.pol h2{font-size:21px}.badge{font-size:21px;padding:4px 12px}' : ''}
</style></head><body>
<div class="head"><div class="brand">${t.brand}</div><h1>${t.title}</h1></div>
<p class="sub">${t.sub}</p>
<div class="rows">${t.rows.map(r => `<div class="row${r.pick ? ' pick' : ''}">
  <div class="l"><div class="nm">${r.name}${r.tag ? `<small>${r.tag}</small>` : ''}${r.badge ? `<span class="badge">${r.badge}</span>` : ''}</div><div class="note">${r.note}</div></div>
  <div class="r"><div class="pr"><i>฿</i>${r.price}</div><div class="per">${r.per}</div></div></div>`).join('')}</div>
<div class="ex">${t.extras.map(line => `<span>${line.join('<em>·</em>')}</span>`).join('')}</div>
<p class="vat">${t.vat}</p>
<div class="pol"><h2>${t.polH}</h2>${t.pol.map(([b, rest]) => `<p><b>${b}</b>${rest}</p>`).join('')}</div>
<div class="foot"><div><div class="bye">${t.bye}</div><div class="url">${t.url}</div></div><img class="logo" src="${F}/img/aybkk-logo-240.jpg"></div>
</body></html>`;

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const report = [];
  for (const lang of Object.keys(T)) for (const [size, s] of Object.entries(SIZES)) {
    const html = page(T[lang], s, lang);
    const file = `${OUT}/AYBKK-prices-12Nov-kind-${lang.toUpperCase()}-${size}.html`;
    fs.writeFileSync(file, html);
    const pg = await br.newPage({ viewport: { width: s.w, height: s.h } });
    await pg.goto('file://' + file); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(400);
    const fit = await pg.evaluate(() => {
      const over = [...document.querySelectorAll('.note,.nm,.ex,.pol p,.sub,.vat')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className + ':' + e.textContent.slice(0, 30));
      const foot = document.querySelector('.foot').getBoundingClientRect(), pol = document.querySelector('.pol').getBoundingClientRect();
      const fonts = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family);
      return { over, gap: Math.round(foot.top - pol.bottom), bottom: Math.round(foot.bottom), fonts: [...new Set(fonts)] };
    });
    const jpg = file.replace('.html', '.jpg');
    await pg.screenshot({ path: jpg, type: 'jpeg', quality: 92 });
    report.push({ jpg: jpg.split('/').pop(), ...fit });
    await pg.close();
  }
  await br.close();
  console.log(JSON.stringify(report, null, 1));
})();
