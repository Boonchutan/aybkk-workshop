// Builds the AYBKK Google review QR card: A6 print (PDF + PNG) and a phone screen version.
const fs = require('fs'), path = require('path');
const QR = require('qrcode');
const { chromium } = require('playwright-core');
const DIR = __dirname, URL_REVIEW = 'https://aybkk.net/review';
const font = f => 'data:font/woff2;base64,' + fs.readFileSync(path.join(DIR, 'fonts', f)).toString('base64');

const css = (w, h, scale) => `
@font-face{font-family:'Mark';src:url('${font('longcang.woff2')}')}
@font-face{font-family:'Hand';src:url('${font('patrickhand.woff2')}')}
@font-face{font-family:'Work';src:url('${font('worksans.woff2')}');font-weight:100 900}
@font-face{font-family:'PlexTH';src:url('${font('plexthai-th.woff2')}');font-weight:100 900}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w};height:${h};background:#fff}
body{font-family:'Work','PlexTH','Inter','WenQuanYi Zen Hei',sans-serif;color:#17121a;-webkit-font-smoothing:antialiased}
.card{width:${w};height:${h};display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden}
.band{width:100%;background:#3E1442;color:#FBF5F9;padding:calc(${scale}*5mm) 0 calc(${scale}*4.2mm)}
.mark{font-family:'Mark',cursive;color:#e6bf66;font-size:calc(${scale}*13mm);line-height:1}
.sub{font-size:calc(${scale}*2.9mm);letter-spacing:.14em;text-transform:uppercase;color:#C9AFCB;margin-top:calc(${scale}*1.6mm)}
h1{font-family:'Hand','PlexTH',cursive;font-weight:400;font-size:calc(${scale}*7.6mm);line-height:1.05;margin-top:calc(${scale}*4.6mm);color:#3E1442}
.th{font-family:'PlexTH','Work',sans-serif}
h2{font-weight:600;font-size:calc(${scale}*4.3mm);margin-top:calc(${scale}*1mm);color:#3E1442}
.qr{margin-top:calc(${scale}*3.6mm);width:calc(${scale}*50mm);height:calc(${scale}*50mm);padding:calc(${scale}*2.5mm);border:calc(${scale}*.6mm) solid #e6bf66;border-radius:calc(${scale}*3mm);background:#fff}
.qr svg{width:100%;height:100%;display:block}
.scan{font-weight:600;font-size:calc(${scale}*3.9mm);margin-top:calc(${scale}*3mm)}
.scan .th{display:block;font-weight:500;font-size:calc(${scale}*3.7mm);margin-top:calc(${scale}*.6mm)}
.why{font-size:calc(${scale}*3mm);color:#4a3a4c;margin-top:calc(${scale}*2.4mm);line-height:1.35;padding:0 calc(${scale}*8mm)}
.url{font-weight:700;letter-spacing:.02em;font-size:calc(${scale}*3.6mm);color:#9a6b12;margin-top:calc(${scale}*2mm)}
.mid{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;padding-bottom:calc(${scale}*2mm)}
.thanks{width:100%;background:#fbe7f0;color:#3E1442;font-size:calc(${scale}*3.3mm);padding:calc(${scale}*3.2mm) 0;letter-spacing:.02em}
`;
const body = qrSvg => `<div class="card">
  <div class="band"><div class="mark">AYBKK</div><div class="sub">Ashtanga Yoga Bangkok · Sukhumvit 31</div></div>
  <div class="mid">
  <h1>How is your practice here?</h1>
  <h2 class="th">ฝึกกับเราเป็นอย่างไรบ้าง</h2>
  <div class="qr">${qrSvg}</div>
  <div class="scan">Scan to write a Google review<span class="th">สแกนเพื่อเขียนรีวิวบน Google</span></div>
  <div class="why">Your honest words help the next student find us.<br><span class="th">รีวิวจริงจากคุณ ช่วยให้คนต่อไปหาเราเจอ</span></div>
  <div class="url">aybkk.net/review</div>
  </div>
  <div class="thanks">Thank you · <span class="th">ขอบคุณ</span> · 谢谢 · Спасибо</div>
</div>`;

(async () => {
  const qrSvg = await QR.toString(URL_REVIEW, { type: 'svg', errorCorrectionLevel: 'Q', margin: 1, color: { dark: '#17121a', light: '#ffffff' } });
  await QR.toFile(path.join(DIR, 'out', 'aybkk-review-qr-only.png'), URL_REVIEW, { errorCorrectionLevel: 'Q', margin: 2, width: 1200, color: { dark: '#17121a', light: '#ffffff' } });
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  // A6 print card: 105 x 148 mm
  const p = await b.newPage({ viewport: { width: 397, height: 559 }, deviceScaleFactor: 3.125 });  // 397 px = 105 mm at 96 dpi; x3.125 = 300 dpi
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>${css('105mm', '148mm', 1)}</style>${body(qrSvg)}`, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: path.join(DIR, 'out', 'aybkk-review-card-A6.pdf'), width: '105mm', height: '148mm', printBackground: true, pageRanges: '1' });
  await p.screenshot({ path: path.join(DIR, 'out', 'aybkk-review-card-A6.png') });
  // Phone / screen version: 1080 x 1920, same layout scaled up
  const q = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await q.setContent(`<!doctype html><meta charset="utf-8"><style>${css('1080px', '1920px', 2.72)}</style>${body(qrSvg)}`, { waitUntil: 'load' });
  await q.evaluate(() => document.fonts.ready);
  await q.screenshot({ path: path.join(DIR, 'out', 'aybkk-review-phone-1080x1920.png') });
  await b.close();
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
