// node render.js -> AYBKK-prices-from-1Nov-<EN|TH>-A3.pdf (print) + .png (preview). Copy: ../2026-10-19-prices-v3/final-v3.json
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const REPO = process.env.REPO || '/home/user/aybkk-workshop';
const QRLIB = require(path.join(REPO, 'node_modules/qrcode'));
const THEME = process.env.THEME || '';
const b64 = (f, t) => `data:${t};base64,` + fs.readFileSync(f).toString('base64');
const copy = JSON.parse(fs.readFileSync(path.join(__dirname, '../2026-10-19-prices-v3/final-v3.json'), 'utf8').replace(/’/g, "'"));
(async () => {
  const qr = await QRLIB.toString('https://aybkk.net/start/wall#first-step', { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#17121a', light: '#ffffff' } });
  const html = fs.readFileSync(path.join(__dirname, 'poster.html'), 'utf8')
    .replace('__WORKSANS__', b64(path.join(REPO, 'public/fonts/worksans.woff2'), 'font/woff2'))
    .replace('__PLEXTHAI__', b64(path.join(REPO, 'public/fonts/plexthai-th.woff2'), 'font/woff2'))
    .replace('__CORMORANT__', b64(path.join(REPO, 'public/fonts/cormorant.woff2'), 'font/woff2'))
    .replace('__COPY__', () => JSON.stringify(copy)).replace('__QR__', () => JSON.stringify(qr))
    .replace('__PHOTO__', b64(path.join(REPO, 'public/img/aybkk-hero-1600.jpg'), 'image/jpeg'))
    .replace('__LOGO__', b64(path.join(REPO, 'public/img/aybkk-logo-240.jpg'), 'image/jpeg'));
  const tmp = path.join(__dirname, '.poster-built.html'); fs.writeFileSync(tmp, html);
  const b = await chromium.launch();
  for (const lang of (process.env.LANGS || 'en,th').split(',')) {
    const p = await b.newPage({ viewport: { width: 1123, height: 1587 }, deviceScaleFactor: 2 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + tmp + '?lang=' + lang + (THEME ? '&theme=' + THEME : '')); await p.evaluate(() => document.fonts.ready);
    const chk = await p.evaluate(() => {
      const pg = document.getElementById('page');
      const over = [...pg.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'hidden').map(e => e.className || e.tagName).slice(0, 5);
      const foot = pg.querySelector('.foot').getBoundingClientRect(), notes = pg.querySelector('.notes').getBoundingClientRect();
      return { over, gapAboveFooter: Math.round(foot.top - notes.bottom), pageOverflow: pg.scrollHeight - pg.clientHeight };
    });
    const base = path.join(__dirname, `AYBKK-prices-from-1Nov-${lang.toUpperCase()}${THEME ? '-' + THEME : ''}-A3`);
    await p.screenshot({ path: base + '.png' });
    await p.pdf({ path: base + '.pdf', preferCSSPageSize: true, printBackground: true, pageRanges: '1' });
    // A4 has the same shape as A3: zoom the same layout to 210/297 on an A4 page.
    await p.addStyleTag({ content: '@page{size:210mm 297mm;margin:0} html{zoom:0.70707}' });
    await p.pdf({ path: base.replace('-A3', '-A4') + '.pdf', preferCSSPageSize: true, printBackground: true, pageRanges: '1' });
    console.log(lang, JSON.stringify(chk), errs.join(' '), chk.gapAboveFooter < 12 || chk.pageOverflow > 0 ? 'TOO TIGHT' : 'fits');
    await p.close();
  }
  await b.close(); fs.unlinkSync(tmp);
})();
