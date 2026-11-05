// node render-bilingual.js -> ../2026-11-05-carousel-v2/ : calendar, promo EN, promo TH, then 4 bilingual theme pages (Boonchu, 5 Nov)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const REPO = process.env.REPO || '/home/user/aybkk-workshop';
const FONTS = path.join(REPO, 'public/fonts'), MEDIA = path.join(__dirname, '..');
const OUT = path.join(MEDIA, '2026-11-05-carousel-v2'); fs.mkdirSync(OUT, { recursive: true });
const b64 = (f, t) => `data:${t};base64,` + fs.readFileSync(f).toString('base64');
const html = fs.readFileSync(path.join(__dirname, 'bilingual.html'), 'utf8')
  .replace('__WORKSANS__', b64(path.join(FONTS, 'worksans.woff2'), 'font/woff2'))
  .replace('__PLEXTHAI__', b64(path.join(FONTS, 'plexthai-th.woff2'), 'font/woff2'))
  .replace('__LOGO__', b64(path.join(MEDIA, '../tools/timetable-poster/logo-white.png'), 'image/png'))
  .replace('__THEME__', () => fs.readFileSync(path.join(REPO, 'public/themes/2026-11.json'), 'utf8'));
const tmp = path.join(__dirname, '.bilingual-built.html'); fs.writeFileSync(tmp, html);
fs.copyFileSync(path.join(MEDIA, '2026-11-timetable/aybkk-2026-11-en-feed.jpg'), path.join(OUT, '01-calendar-en.jpg'));
fs.copyFileSync(path.join(MEDIA, '2026-11-05-last-week-promo/aybkk-last-week-en-feed.jpg'), path.join(OUT, '02-promo-en.jpg'));
fs.copyFileSync(path.join(MEDIA, '2026-11-05-last-week-promo/aybkk-last-week-th-feed.jpg'), path.join(OUT, '03-promo-th.jpg'));
(async () => {
  const b = await chromium.launch();
  for (let n = 1; n <= 4; n++) {
    const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + tmp + `?page=${n}`);
    await p.evaluate(() => document.fonts.ready);
    const chk = await p.evaluate(() => {
      const over = [...document.querySelectorAll('h1,p,.lab,.btn')].filter(e => e.scrollWidth > e.clientWidth + 1).length;
      const last = [...document.querySelectorAll('.body *')].reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
      return { over, gapToFoot: Math.round(document.querySelector('.foot').getBoundingClientRect().top - last) };
    });
    await p.screenshot({ path: path.join(OUT, `0${n + 3}-theme-${n}.jpg`), type: 'jpeg', quality: 92 });
    console.log(n, JSON.stringify(chk), errs.join(' '));
    await p.close();
  }
  await b.close(); fs.unlinkSync(tmp);
})();
