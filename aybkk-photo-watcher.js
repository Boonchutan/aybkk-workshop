#!/usr/bin/env node
/**
 * AYBKK Photo Watcher — Phase 2
 *
 * Watches a Google-Drive-synced folder for new class photos.
 * On a new image: uploads it to Cloudinary, prints the public URL
 * (which you then feed into aybkk-line-broadcast.js).
 *
 * Designed to run locally on the Mac mini (where Drive is synced).
 *
 *   node aybkk-photo-watcher.js
 *   node aybkk-photo-watcher.js --once   # one-shot scan, exit (use in cron)
 *
 * Env (optional):
 *   AYBKK_PHOTO_DIR   absolute folder to watch (defaults below)
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { spawnSync } = require('child_process');

const HOME = require('os').homedir();
const DEFAULT_DIR = path.join(
  HOME,
  'Library/CloudStorage/GoogleDrive-boonchutan@gmail.com/My Drive/AYBKK/02_Shala_BKK/Daily Class Photos'
);
const WATCH_DIR = process.env.AYBKK_PHOTO_DIR || DEFAULT_DIR;
const STATE_FILE = path.join(__dirname, 'data', 'photo-watcher-state.json');
const POLL_MS = 30_000;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dw1uubecu',
  api_key: process.env.CLOUDINARY_API_KEY || '191765218532954',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'kBwusl-gHqqNiZYykFgChJjt3MQ'
});

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { uploaded: {} }; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function uploadOne(filepath, state) {
  const stat = fs.statSync(filepath);
  const key = `${filepath}::${stat.mtimeMs}::${stat.size}`;
  if (state.uploaded[key]) return state.uploaded[key];

  const today = new Date().toISOString().slice(0, 10);
  const tag = `aybkk-daily-${today}`;
  const publicId = `aybkk/daily/${today}/${path.basename(filepath, path.extname(filepath))}-${Date.now()}`;

  console.log(`↑ uploading ${path.basename(filepath)}…`);
  const result = await cloudinary.uploader.upload(filepath, {
    public_id: publicId,
    tags: [tag, 'aybkk-daily'],
    overwrite: false,
    resource_type: 'image'
  });

  state.uploaded[key] = { url: result.secure_url, publicId, uploadedAt: new Date().toISOString(), broadcast: false };
  saveState(state);
  console.log(`✓ ${result.secure_url}`);

  // Auto-broadcast to all linked active members unless disabled
  if (!process.env.AYBKK_NO_BROADCAST) {
    const today = new Date().toISOString().slice(0, 10);
    const caption = `AYBKK practice — ${today}`;
    const r = spawnSync('node', [
      path.join(__dirname, 'aybkk-line-broadcast.js'),
      '--all-active',
      '--photo-url', result.secure_url,
      '--caption', caption
    ], { stdio: 'inherit', env: process.env });
    state.uploaded[key].broadcast = r.status === 0;
    saveState(state);
  }
  return state.uploaded[key];
}

async function scanOnce(state) {
  if (!fs.existsSync(WATCH_DIR)) {
    console.error(`Watch dir does not exist: ${WATCH_DIR}`);
    console.error(`Create it, or set AYBKK_PHOTO_DIR env var to the right path.`);
    process.exit(1);
  }
  const entries = fs.readdirSync(WATCH_DIR);
  const images = entries.filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase()));
  for (const f of images) {
    try { await uploadOne(path.join(WATCH_DIR, f), state); }
    catch (e) { console.error(`✗ ${f} → ${e.message}`); }
  }
  return images.length;
}

(async () => {
  console.log(`Watching: ${WATCH_DIR}`);
  const state = loadState();
  const once = process.argv.includes('--once');
  const found = await scanOnce(state);
  console.log(`Initial scan: ${found} image(s) inspected.\n`);
  if (once) return;

  console.log(`Polling every ${POLL_MS / 1000}s. Ctrl-C to stop.\n`);
  setInterval(async () => {
    try { await scanOnce(state); }
    catch (e) { console.error('scan error:', e.message); }
  }, POLL_MS);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
