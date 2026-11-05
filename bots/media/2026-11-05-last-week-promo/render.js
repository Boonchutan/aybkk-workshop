// node render.js [outdir]  ->  aybkk-last-week-<en|th>-<feed|story>.jpg
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const FONTS = process.env.FONTS || '/home/user/aybkk-workshop/public/fonts';
const PHOTO = process.env.PHOTO || '/home/user/aybkk-workshop/public/img/aybkk-hero-1600.jpg';
const LOGO = path.join(__dirname, '../../tools/timetable-poster/logo-white.png');
const out = process.argv[2] || __dirname;
const b64 = (f, t) => `data:${t};base64,` + fs.readFileSync(f).toString('base64');
const html = fs.readFileSync(path.join(__dirname, 'poster.html'), 'utf8')
  .replace('__WORKSANS__', b64(path.join(FONTS, 'worksans.woff2'), 'font/woff2'))
  .replace('__PLEXTHAI__', b64(path.join(FONTS, 'plexthai-th.woff2'), 'font/woff2'))
  .replace('__LOGO__', b64(LOGO, 'image/png')).replace('__PHOTO__', b64(PHOTO, 'image/jpeg'));
const tmp = path.join(out, '.poster-built.html');
fs.writeFileSync(tmp, html);
(async () => {
  const b = await chromium.launch();
  for (const lang of ['en', 'th']) for (const [size, H] of [['feed', 1350], ['story', 1920]]) {
    const p = await b.newPage({ viewport: { width: 1080, height: H } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + tmp + `?lang=${lang}&size=${size}`);
    await p.evaluate(() => document.fonts.ready);
    const chk = await p.evaluate(() => {
      const over = [...document.querySelectorAll('h1,.sub,.offer p,.when,.cta,.kick')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className || e.tagName);
      const pic = document.querySelector('.pic').getBoundingClientRect();
      const lines = ['#o1','#o2','#w','#s','#kick'].map(id => { const e = document.querySelector(id); return Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight || 40)); });
      return { over, lines, picH: Math.round(pic.height), fonts: [...document.fonts].filter(f => f.status === 'loaded').length };
    });
    const f = path.join(out, `aybkk-last-week-${lang}-${size}.jpg`);
    await p.screenshot({ path: f, type: 'jpeg', quality: 92 });
    console.log(path.basename(f), JSON.stringify(chk), errs.join(' '));
    await p.close();
  }
  await b.close(); fs.unlinkSync(tmp);
})();
