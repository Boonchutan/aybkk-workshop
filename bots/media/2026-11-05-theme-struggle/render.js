// node render.js [outdir] -> aybkk-2026-11-theme-<en|th>-<1..7>.jpg (Instagram/Facebook carousel, 1080x1350)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const REPO = process.env.REPO || '/home/user/aybkk-workshop';
const FONTS = path.join(REPO, 'public/fonts');
const LOGO = path.join(__dirname, '../../tools/timetable-poster/logo-white.png');
const out = process.argv[2] || __dirname;
const b64 = (f, t) => `data:${t};base64,` + fs.readFileSync(f).toString('base64');
const theme = fs.readFileSync(path.join(REPO, 'public/themes/2026-11.json'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'slides.html'), 'utf8')
  .replace('__WORKSANS__', b64(path.join(FONTS, 'worksans.woff2'), 'font/woff2'))
  .replace('__PLEXTHAI__', b64(path.join(FONTS, 'plexthai-th.woff2'), 'font/woff2'))
  .replace('__CORMORANT__', b64(path.join(FONTS, 'cormorant.woff2'), 'font/woff2'))
  .replace('__LOGO__', b64(LOGO, 'image/png')).replace('__THEME__', () => theme);
const tmp = path.join(out, '.slides-built.html');
fs.writeFileSync(tmp, html);
(async () => {
  const b = await chromium.launch();
  for (const lang of ['en', 'th']) for (let s = 1; s <= 7; s++) {
    const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + tmp + `?lang=${lang}&slide=${s}`);
    await p.evaluate(() => document.fonts.ready);
    const chk = await p.evaluate(() => {
      const pg = document.querySelector('.page'), body = document.querySelector('.body');
      const over = [...document.querySelectorAll('h1,h2,p,blockquote,.k')].filter(e => e.scrollWidth > e.clientWidth + 1).length;
      const last = [...body.querySelectorAll('*')].reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
      return { over, overflowY: Math.round(last - document.querySelector('.foot').getBoundingClientRect().top) };
    });
    const f = path.join(out, `aybkk-2026-11-theme-${lang}-${s}.jpg`);
    await p.screenshot({ path: f, type: 'jpeg', quality: 92 });
    console.log(path.basename(f), JSON.stringify(chk), errs.join(' '));
    await p.close();
  }
  // The 5 Nov post: calendar, promo EN, promo TH, then the theme with the languages mixed (Boonchu, 5 Nov).
  const C = path.join(__dirname, '../2026-11-05-carousel'); fs.mkdirSync(C, { recursive: true });
  const MIX = ['en', 'th', 'en', 'th', 'en', 'th', 'en'];
  for (let s = 1; s <= 7; s++) {
    const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
    await p.goto('file://' + tmp + `?lang=${MIX[s - 1]}&slide=${s}&cr=1`);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(C, `${String(s + 3).padStart(2, '0')}-theme-${s}-${MIX[s - 1]}.jpg`), type: 'jpeg', quality: 92 });
    await p.close();
  }
  await b.close(); fs.unlinkSync(tmp);
})();
