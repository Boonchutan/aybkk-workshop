// Decode Drive tool-result files and upload to Cloudinary for the Moments feed.
// Credentials are read from the repo's own aybkk-photo-watcher.js at runtime —
// never passed on a command line or copied into another file.
//
// Usage:
//   node moments-upload.js decode <toolResultsDir> <outDir> <manifest.json>
//     manifest maps Drive file title -> { date: 'YYYY-MM-DD' }; every pending
//     tool-result file is decoded to <outDir>/<date>__<title> and removed.
//   node moments-upload.js upload <outDir>
//     uploads every <date>__<name>.jpg to aybkk/daily/<date>/ with the
//     aybkk-daily tags (same convention as the photo watcher), then deletes it.
const fs = require('fs');
const path = require('path');

const REPO = require('path').join(__dirname, '..');
const src = fs.readFileSync(path.join(REPO, 'aybkk-photo-watcher.js'), 'utf8');
const pick = re => (src.match(re) || [])[1];
const cloudinary = require(path.join(REPO, 'node_modules', 'cloudinary')).v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || pick(/cloud_name:[^']*'([^']+)'/),
  api_key: process.env.CLOUDINARY_API_KEY || pick(/api_key:[^']*'([^']+)'/),
  api_secret: process.env.CLOUDINARY_API_SECRET || pick(/api_secret:[^']*'([^']+)'/),
});

const [, , cmd, a1, a2, a3] = process.argv;

if (cmd === 'fetch') {
  // node moments-from-drive.js fetch <manifest.json> <photosDir>
  // The photos_edited Drive folder is link-shared, so files download directly
  // by id — no connector involved. Validates each file is a real JPEG.
  const { execFileSync } = require('child_process');
  const manifest = JSON.parse(fs.readFileSync(a1, 'utf8'));
  fs.mkdirSync(a2, { recursive: true });
  let ok = 0, bad = 0;
  for (const [title, meta] of Object.entries(manifest)) {
    const dest = path.join(a2, `${meta.date}__${title}`);
    try {
      execFileSync('curl', ['-sL', '--max-time', '90', '-o', dest,
        `https://drive.google.com/uc?export=download&id=${meta.id}`], { stdio: 'pipe' });
      const head = fs.readFileSync(dest).subarray(0, 3);
      if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) ok++;
      else { bad++; console.log('BAD (not JPEG — is the folder still link-shared?):', title); fs.unlinkSync(dest); }
    } catch (e) { bad++; console.log('FAIL:', title, e.message.slice(0, 80)); }
  }
  console.log(`fetched=${ok} bad=${bad}`);
  process.exit(bad && !ok ? 1 : 0);
} else if (cmd === 'decode') {
  const manifest = JSON.parse(fs.readFileSync(a3, 'utf8'));
  fs.mkdirSync(a2, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(a1)) {
    if (!f.startsWith('mcp-Google_Drive-download_file_content-')) continue;
    const full = path.join(a1, f);
    try {
      const j = JSON.parse(fs.readFileSync(full, 'utf8'));
      const meta = manifest[j.title];
      if (!meta) { console.log('skip (not in manifest):', j.title); continue; }
      const out = path.join(a2, `${meta.date}__${j.title}`);
      fs.writeFileSync(out, Buffer.from(j.content, 'base64'));
      console.log('decoded', j.title, '->', out, fs.statSync(out).size, 'bytes');
      n++;
    } catch (e) { console.log('bad tool-result file', f, e.message); }
    fs.unlinkSync(full);
  }
  console.log(n, 'decoded');
} else if (cmd === 'upload') {
  (async () => {
    let ok = 0, fail = 0;
    for (const f of fs.readdirSync(a1).sort()) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})__(.+)\.(jpe?g|png|webp)$/i);
      if (!m) continue;
      const [, date, base] = m;
      const full = path.join(a1, f);
      try {
        const r = await cloudinary.uploader.upload(full, {
          public_id: `aybkk/daily/${date}/${base}-${Date.now()}`,
          tags: [`aybkk-daily-${date}`, 'aybkk-daily'],
          resource_type: 'image',
        });
        console.log('↑', date, base, r.secure_url.slice(0, 80));
        fs.unlinkSync(full); ok++;
      } catch (e) { console.log('✗', f, e.message); fail++; }
    }
    console.log(`${ok} uploaded, ${fail} failed`);
    process.exit(fail && !ok ? 1 : 0);
  })();
} else {
  console.log('unknown command'); process.exit(1);
}
