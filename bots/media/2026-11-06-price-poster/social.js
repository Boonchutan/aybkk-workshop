// node social.js -> AYBKK-prices-12Nov-<EN|TH>-grid-<post|story>.jpg (1080 wide), the wall poster's grid at social sizes.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const REPO = process.env.REPO || '/home/user/aybkk-workshop';
const THEME = process.env.THEME || 'site';
const b64 = (f, t) => `data:${t};base64,` + fs.readFileSync(f).toString('base64');
const copy = JSON.parse(fs.readFileSync(path.join(__dirname, '../2026-10-19-prices-v3/final-v3.json'), 'utf8').replace(/’/g, "'"));
(async () => {
  const html = fs.readFileSync(path.join(__dirname, 'poster.html'), 'utf8')
    .replace('__WORKSANS__', b64(path.join(REPO, 'public/fonts/worksans.woff2'), 'font/woff2'))
    .replace('__PLEXTHAI__', b64(path.join(REPO, 'public/fonts/plexthai-th.woff2'), 'font/woff2'))
    .replace('__CORMORANT__', b64(path.join(REPO, 'public/fonts/cormorant.woff2'), 'font/woff2'))
    .replace('__COPY__', () => JSON.stringify(copy)).replace('__QR__', () => JSON.stringify(''))
    .replace('__PHOTO__', b64(path.join(REPO, 'public/img/aybkk-hero-1600.jpg'), 'image/jpeg'))
    .replace('__LOGO__', b64(path.join(REPO, 'public/img/aybkk-logo-240.jpg'), 'image/jpeg'));
  const tmp = path.join(__dirname, '.social-built.html'); fs.writeFileSync(tmp, html);
  const b = await chromium.launch();
  for (const [size, h] of [['post', 1350], ['story', 1920]]) for (const lang of ['en', 'th']) {
    const p = await b.newPage({ viewport: { width: 1080, height: h }, deviceScaleFactor: 1 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`file://${tmp}?lang=${lang}&theme=${THEME}&size=${size}`); await p.evaluate(() => document.fonts.ready);
    const chk = await p.evaluate(() => {
      const pg = document.getElementById('page'), foot = pg.querySelector('.foot').getBoundingClientRect();
      const last = [...pg.querySelectorAll('.sec')].filter(s => s.offsetParent !== null).pop().getBoundingClientRect();
      return { gapAboveFooter: Math.round(foot.top - last.bottom), pageOverflow: pg.scrollHeight - pg.clientHeight, footBottom: Math.round(foot.bottom) };
    });
    const out = path.join(__dirname, `AYBKK-prices-12Nov-${lang.toUpperCase()}-grid-${size}.jpg`);
    await p.screenshot({ path: out, type: 'jpeg', quality: 92 });
    console.log(size, lang, JSON.stringify(chk), errs.join(' '), chk.gapAboveFooter < 10 || chk.pageOverflow > 0 ? 'TOO TIGHT' : 'fits');
    await p.close();
  }
  await b.close(); fs.unlinkSync(tmp);
})();
