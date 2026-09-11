// idcn-api.js — AYBKK In-Depth Mysore courses (idcn3 first: Chinese Generation #3).
//
// Mount:  mountIdcn(app, { pgPool })
//
// One app from invitation to completion:
//   - each student has a named link  /idcn3/<slug>  behind a per-person passcode
//   - they confirm their spot IN the app: choose a payment option, read the
//     bilingual course policy, tick every consent, type their name — recorded
//     with timestamp and policy version, append-only, never editable
//   - Boonchu/Jamsai (admin key) upload payment screenshots to the profile as
//     transaction proof; the student always sees their own money state
//   - course photo hub (Cloudinary, tag aybkk-<course>) with student upload
//   - syllabus links editable in the admin, journal links to the existing system
//
// Money: THB satang integers, never floats. Discounts stack multiplicatively
// (Boonchu's decision 9 Sep 2026): option discount first, then attendee 3% on
// the discounted price. Every idcn3 combination lands on exact satang; the
// fractional-satang guard floors toward the student and is pinned by tests.

const crypto = require('crypto');

const SATANG = 100;
// bumped whenever the policy text in public/idcn.html changes, so every
// signature records exactly which wording was on screen
const IDCN3_POLICY_VERSION = 'idcn3-v2';
const sha = k => crypto.createHash('sha256').update(String(k)).digest('hex');
const newPasscode = () => crypto.randomBytes(6).toString('base64url');

// option pct and deadline live in the course terms so future generations can
// differ without code changes
const IDCN3_TERMS = {
  feeSatang: 199000 * SATANG,
  attendeePct: 3,                       // extra AYBKK-attendee discount, %
  options: {
    1: { pct: 10, due: '2026-09-10', label_en: '100% by 10 Sep 2026', label_zh: '9月10日前全额支付' },
    2: { pct: 5, due: '2026-09-16', label_en: '100% by 16 Sep 2026', label_zh: '9月16日前全额支付' },
    3: {
      pct: 0, due: '2026-09-20', depositPct: 60,
      cashDue: '2027-01-10',
      label_en: '60% by 20 Sep 2026 + 40% THB cash on 10 Jan 2027 at AYBKK',
      label_zh: '9月20日前支付60% + 2027年1月10日在AYBKK以泰铢现金支付40%',
    },
  },
  sessions: [
    { dates: '10–24 Oct 2026', place_en: 'Edison & BeiBei Shala, Huizhou, China', place_zh: '中国惠州 Edison & BeiBei 瑜伽馆' },
    { dates: '11–25 Jan 2027', place_en: 'AYBKK Bangkok (11–22) & Khaoyaithieng (22–25), Thailand', place_zh: '泰国曼谷 AYBKK (11–22日) 及 Khaoyaithieng (22–25日)' },
  ],
  confirmBy: '2026-09-10',
};

// Discounted amount in satang: multiply by (100−pct)/100 in integers, flooring
// any fractional satang toward the student. For idcn3 every case is exact.
function applyPct(satang, pct) {
  if (!Number.isSafeInteger(satang) || satang < 0) throw new Error('bad amount');
  return Math.floor((satang * (100 - pct)) / 100);
}

function quote(terms, option, isAttendee) {
  const opt = terms.options[option];
  if (!opt) return null;
  let total = applyPct(terms.feeSatang, opt.pct);
  if (isAttendee) total = applyPct(total, terms.attendeePct);
  const out = {
    option: Number(option),
    listSatang: terms.feeSatang,
    totalSatang: total,
    // shown separately ("−10% −3%"), never summed: the discounts stack
    // multiplicatively, so a summed percentage would contradict the price
    discounts: [opt.pct, isAttendee ? terms.attendeePct : 0].filter(Boolean),
    due: opt.due,
    label_en: opt.label_en, label_zh: opt.label_zh,
  };
  if (opt.depositPct) {
    out.depositSatang = Math.floor((total * opt.depositPct) / 100);
    out.cashSatang = total - out.depositSatang;   // remainder to the cash leg, always exact
    out.cashDue = opt.cashDue;
  }
  return out;
}

function mountIdcn(app, opts = {}) {
  const pool = opts.pgPool;
  if (!pool) { console.warn('⚠ idcn-api: no pgPool — in-depth courses disabled'); return; }
  const q = (sql, params = []) => pool.query(sql, params);
  const ADMIN_KEY = process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || 'aybkk2026';
  const isAdmin = req => req.headers['x-bkk-key'] === ADMIN_KEY;

  async function initSchema() {
    await q(`CREATE TABLE IF NOT EXISTS idc_courses (
      code TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_zh TEXT,
      terms JSONB NOT NULL, policy_version TEXT NOT NULL,
      active BOOLEAN DEFAULT true)`);
    await q(`CREATE TABLE IF NOT EXISTS idc_students (
      id SERIAL PRIMARY KEY,
      course_code TEXT NOT NULL REFERENCES idc_courses(code),
      slug TEXT NOT NULL,
      name_en TEXT NOT NULL, name_zh TEXT, lang TEXT DEFAULT 'zh',
      key_hash TEXT NOT NULL,
      journal_url TEXT,
      payment_option INTEGER,
      is_attendee BOOLEAN DEFAULT false,
      status TEXT NOT NULL DEFAULT 'invited',
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (course_code, slug))`);
    // append-only: signing is an event, never a row that gets edited
    await q(`CREATE TABLE IF NOT EXISTS idc_consents (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES idc_students(id),
      policy_version TEXT NOT NULL,
      payment_option INTEGER NOT NULL,
      items JSONB NOT NULL,
      signed_name TEXT NOT NULL,
      health_note TEXT,
      media_public BOOLEAN DEFAULT false,
      signed_at TIMESTAMPTZ DEFAULT now(),
      ip TEXT)`);
    await q(`CREATE TABLE IF NOT EXISTS idc_payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES idc_students(id),
      label TEXT NOT NULL,
      amount_satang BIGINT,
      proof_url TEXT,
      note TEXT,
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now())`);
    // notes & assignments the teaching team sends into a student's profile
    await q(`CREATE TABLE IF NOT EXISTS idc_notes (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES idc_students(id),
      kind TEXT NOT NULL DEFAULT 'note',
      title TEXT, body TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now())`);
    // Jamsai negotiates the tier with each student, so the option is admin-set
    // and a student may sign the consent before their plan is settled
    await q(`ALTER TABLE idc_consents ALTER COLUMN payment_option DROP NOT NULL`)
      .catch(() => {});
    await q(`CREATE TABLE IF NOT EXISTS idc_settings (
      course_code TEXT NOT NULL REFERENCES idc_courses(code),
      key TEXT NOT NULL, value JSONB,
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (course_code, key))`);
    await q(`INSERT INTO idc_courses (code, name_en, name_zh, terms, policy_version)
      VALUES ('idcn3', 'AYBKK In-Depth Mysore Course for Chinese Generation #3',
              'AYBKK 深度迈索尔课程 · 中国第三期', $1, $2)
      ON CONFLICT (code) DO NOTHING`, [JSON.stringify(IDCN3_TERMS), IDCN3_POLICY_VERSION]);
    await q(`UPDATE idc_courses SET policy_version=$1 WHERE code='idcn3' AND policy_version <> $1`,
      [IDCN3_POLICY_VERSION]);
  }

  const courseFor = async (req, res) => {
    const c = (await q('SELECT * FROM idc_courses WHERE code=$1 AND active',
      [String(req.params.course || '')])).rows[0];
    if (!c) { res.status(404).json({ error: 'not found' }); return null; }
    return c;
  };

  // A student key only ever opens its own row; the admin key opens any slug in
  // the course. Wrong key and wrong slug are the same 401/404 — a named link
  // must not confirm whose passcode is whose.
  async function studentFrom(req, res, course, slug) {
    const row = (await q(
      'SELECT * FROM idc_students WHERE course_code=$1 AND slug=$2',
      [course.code, String(slug || '').toLowerCase()])).rows[0];
    if (isAdmin(req)) {
      if (!row) { res.status(404).json({ error: 'not found' }); return null; }
      return row;
    }
    const key = req.headers['x-idcn-key'];
    if (!key || !row || row.key_hash !== sha(key)) {
      res.status(401).json({ error: 'passcode needed' }); return null;
    }
    return row;
  }

  const REQUIRED_CONSENTS = ['payment_final', 'adjustments', 'risk_health',
    'instructions', 'travel', 'schedule', 'media_course', 'privacy'];

  async function profileJson(course, s) {
    const terms = course.terms;
    const consent = (await q(
      `SELECT policy_version, payment_option, items, signed_name, health_note,
              media_public, signed_at
       FROM idc_consents WHERE student_id=$1 ORDER BY id ASC LIMIT 1`, [s.id])).rows[0] || null;
    const payments = (await q(
      `SELECT id, label, amount_satang, proof_url, note, created_at
       FROM idc_payments WHERE student_id=$1 ORDER BY id ASC`, [s.id])).rows;
    const links = (await q(
      `SELECT value FROM idc_settings WHERE course_code=$1 AND key='links'`,
      [course.code])).rows[0];
    const notes = (await q(
      `SELECT id, kind, title, body, created_by, created_at
       FROM idc_notes WHERE student_id=$1 ORDER BY id DESC LIMIT 100`, [s.id])).rows;
    return {
      course: { code: course.code, name_en: course.name_en, name_zh: course.name_zh,
        sessions: terms.sessions, confirmBy: terms.confirmBy,
        policyVersion: course.policy_version },
      student: { slug: s.slug, name_en: s.name_en, name_zh: s.name_zh, lang: s.lang,
        status: s.status, paymentOption: s.payment_option, isAttendee: s.is_attendee,
        journalUrl: s.journal_url || null },
      quotes: [1, 2, 3].map(o => quote(terms, o, s.is_attendee)),
      quote: s.payment_option ? quote(terms, s.payment_option, s.is_attendee) : null,
      consent, payments, notes,
      links: (links && links.value) || [],
      requiredConsents: REQUIRED_CONSENTS,
    };
  }

  // ── student endpoints ─────────────────────────────────────────────────────
  app.get('/api/idcn/:course/students/:slug', async (req, res) => {
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = await studentFrom(req, res, course, req.params.slug); if (!s) return;
      res.json(await profileJson(course, s));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/idcn/:course/students/:slug/consent', async (req, res) => {
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = await studentFrom(req, res, course, req.params.slug); if (!s) return;
      const b = req.body || {};
      const already = (await q('SELECT 1 FROM idc_consents WHERE student_id=$1', [s.id])).rows[0];
      if (already) return res.status(409).json({ error: 'already signed' });
      const items = b.items || {};
      const missing = REQUIRED_CONSENTS.filter(k => items[k] !== true);
      if (missing.length)
        return res.status(400).json({ error: 'every consent is required', missing });
      const signedName = String(b.signedName || '').trim();
      if (signedName.length < 2) return res.status(400).json({ error: 'type your full name to sign' });
      const kept = {}; for (const k of REQUIRED_CONSENTS) kept[k] = true;
      await q(
        `INSERT INTO idc_consents (student_id, policy_version, payment_option, items,
           signed_name, health_note, media_public, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s.id, course.policy_version, s.payment_option, JSON.stringify(kept),
         signedName, String(b.healthNote || '').slice(0, 2000) || null,
         b.mediaPublic === true,
         String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim()]);
      await q(`UPDATE idc_students SET status='confirmed' WHERE id=$1`, [s.id]);
      res.json({ success: true, status: 'confirmed' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── course photo hub (Cloudinary, own tag so nothing leaks between feeds) ──
  const photoCache = new Map();
  app.get('/api/idcn/:course/photos', async (req, res) => {
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = await studentFrom(req, res, course, req.query.slug); if (!s) return;
      const cached = photoCache.get(course.code);
      if (cached && Date.now() - cached.at < 5 * 60 * 1000) return res.json(cached.data);
      const cloudinary = require('cloudinary').v2;
      const result = await cloudinary.search
        .expression(`tags=aybkk-${course.code} AND resource_type:image`)
        .sort_by('created_at', 'desc').max_results(200).execute();
      const byDay = new Map();
      for (const r of result.resources || []) {
        const m = String(r.public_id).match(/\/(\d{4}-\d{2}-\d{2})\//);
        const day = m ? m[1] : String(r.created_at).slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push({ url: r.secure_url, w: r.width || 0, h: r.height || 0 });
      }
      const data = { days: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, items]) => ({ date, items })) };
      photoCache.set(course.code, { at: Date.now(), data });
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/idcn/:course/photos', async (req, res) => {
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = await studentFrom(req, res, course, (req.body || {}).slug); if (!s) return;
      const imageBase64 = (req.body || {}).imageBase64;
      if (!imageBase64 || !/^data:image\//.test(imageBase64))
        return res.status(400).json({ error: 'imageBase64 (data:image/...) required' });
      const cloudinary = require('cloudinary').v2;
      const day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      const up = await cloudinary.uploader.upload(imageBase64, {
        folder: `aybkk/${course.code}/${day}`,
        tags: [`aybkk-${course.code}`],
        resource_type: 'image',
      });
      photoCache.delete(course.code);
      res.json({ success: true, url: up.secure_url });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── admin (Boonchu + Jamsai, x-bkk-key) ───────────────────────────────────
  const needAdmin = (req, res) => {
    if (!isAdmin(req)) { res.status(401).json({ error: 'bad key' }); return false; }
    return true;
  };

  app.post('/api/idcn/admin/:course/students', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const b = req.body || {};
      const nameEn = String(b.nameEn || '').trim();
      if (!nameEn) return res.status(400).json({ error: 'nameEn required' });
      const slug = String(b.slug || nameEn).trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!slug) return res.status(400).json({ error: 'slug required (latin letters)' });
      const passcode = newPasscode();
      try {
        const r = await q(
          `INSERT INTO idc_students (course_code, slug, name_en, name_zh, lang,
             key_hash, journal_url, is_attendee)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, slug, name_en, name_zh, status`,
          [course.code, slug, nameEn, String(b.nameZh || '').trim() || null,
           ['zh', 'en'].includes(b.lang) ? b.lang : 'zh',
           sha(passcode), String(b.journalUrl || '').trim() || null,
           b.isAttendee === true]);
        res.json({ success: true, student: r.rows[0], passcode,
          link: `/${course.code}/${slug}`,
          note: 'Passcode is shown once. Send them the link and the passcode together.' });
      } catch (e) {
        if (String(e.message).includes('idc_students_course_code_slug_key'))
          return res.status(409).json({ error: `slug '${slug}' is taken in ${course.code}` });
        throw e;
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/idcn/admin/:course/students', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const rows = (await q(
        `SELECT s.id, s.slug, s.name_en, s.name_zh, s.lang, s.status,
                s.payment_option, s.is_attendee, s.journal_url,
                c.signed_at, c.signed_name, c.health_note, c.media_public,
                (SELECT count(*)::int FROM idc_payments p WHERE p.student_id=s.id) AS proofs
         FROM idc_students s
         LEFT JOIN idc_consents c ON c.student_id=s.id
         WHERE s.course_code=$1 ORDER BY s.name_en`, [course.code])).rows;
      res.json({ students: rows.map(r =>
        ({ ...r, quote: r.payment_option ? quote(course.terms, r.payment_option, r.is_attendee) : null })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/idcn/admin/:course/students/:id', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const b = req.body || {};
      const s = (await q('SELECT * FROM idc_students WHERE id=$1 AND course_code=$2',
        [Number(req.params.id), course.code])).rows[0];
      if (!s) return res.status(404).json({ error: 'not found' });
      const out = { success: true };
      if (b.resetKey === true) {
        const passcode = newPasscode();
        await q('UPDATE idc_students SET key_hash=$1 WHERE id=$2', [sha(passcode), s.id]);
        out.passcode = passcode;
      }
      if (b.journalUrl !== undefined)
        await q('UPDATE idc_students SET journal_url=$1 WHERE id=$2',
          [String(b.journalUrl || '').trim() || null, s.id]);
      if (b.isAttendee !== undefined)
        await q('UPDATE idc_students SET is_attendee=$1 WHERE id=$2', [b.isAttendee === true, s.id]);
      if (b.paymentOption !== undefined) {
        if (![1, 2, 3].includes(Number(b.paymentOption)))
          return res.status(400).json({ error: 'option must be 1, 2 or 3' });
        await q('UPDATE idc_students SET payment_option=$1 WHERE id=$2', [Number(b.paymentOption), s.id]);
      }
      if (b.status !== undefined) {
        if (!['invited', 'confirmed', 'completed', 'withdrawn'].includes(b.status))
          return res.status(400).json({ error: 'bad status' });
        await q('UPDATE idc_students SET status=$1 WHERE id=$2', [b.status, s.id]);
      }
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // payment proof: a screenshot Boonchu or Jamsai uploads onto the profile
  app.post('/api/idcn/admin/:course/students/:id/payments', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const s = (await q('SELECT * FROM idc_students WHERE id=$1 AND course_code=$2',
        [Number(req.params.id), course.code])).rows[0];
      if (!s) return res.status(404).json({ error: 'not found' });
      const b = req.body || {};
      const label = String(b.label || '').trim();
      if (!label) return res.status(400).json({ error: 'label required (e.g. "60% deposit 定金")' });
      let proofUrl = null;
      if (b.imageBase64) {
        if (!/^data:image\//.test(b.imageBase64))
          return res.status(400).json({ error: 'imageBase64 must be data:image/...' });
        const cloudinary = require('cloudinary').v2;
        // proofs live OUTSIDE the tagged photo folders so they can never
        // surface in any moments/course feed
        const up = await cloudinary.uploader.upload(b.imageBase64, {
          folder: `aybkk/${course.code}/proofs/${s.slug}`, resource_type: 'image' });
        proofUrl = up.secure_url;
      }
      const amount = b.amountSatang != null ? Number(b.amountSatang) : null;
      if (amount != null && (!Number.isSafeInteger(amount) || amount <= 0))
        return res.status(400).json({ error: 'amountSatang must be a positive integer' });
      const r = await q(
        `INSERT INTO idc_payments (student_id, label, amount_satang, proof_url, note, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, label, amount_satang, proof_url, note, created_at`,
        [s.id, label, amount, proofUrl, String(b.note || '').trim() || null,
         String(b.uploadedBy || 'AYBKK').slice(0, 60)]);
      res.json({ success: true, payment: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // a note or assignment into one profile, or every profile in the course
  app.post('/api/idcn/admin/:course/notes', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const b = req.body || {};
      const kind = b.kind === 'assignment' ? 'assignment' : 'note';
      const body = String(b.body || '').trim();
      if (!body) return res.status(400).json({ error: 'body required' });
      let ids;
      if (b.all === true) {
        ids = (await q(
          `SELECT id FROM idc_students WHERE course_code=$1 AND status != 'withdrawn'`,
          [course.code])).rows.map(r => r.id);
      } else {
        const s = (await q('SELECT id FROM idc_students WHERE id=$1 AND course_code=$2',
          [Number(b.studentId), course.code])).rows[0];
        if (!s) return res.status(404).json({ error: 'student not found' });
        ids = [s.id];
      }
      for (const id of ids) {
        await q(`INSERT INTO idc_notes (student_id, kind, title, body, created_by)
                 VALUES ($1,$2,$3,$4,$5)`,
          [id, kind, String(b.title || '').slice(0, 200) || null, body.slice(0, 8000),
           String(b.createdBy || 'AYBKK').slice(0, 60)]);
      }
      res.json({ success: true, sentTo: ids.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/idcn/admin/:course/links', async (req, res) => {
    if (!needAdmin(req, res)) return;
    const course = await courseFor(req, res); if (!course) return;
    const r = (await q(`SELECT value FROM idc_settings WHERE course_code=$1 AND key='links'`,
      [course.code])).rows[0];
    res.json({ links: (r && r.value) || [] });
  });

  app.put('/api/idcn/admin/:course/links', async (req, res) => {
    if (!needAdmin(req, res)) return;
    try {
      const course = await courseFor(req, res); if (!course) return;
      const links = Array.isArray((req.body || {}).links) ? req.body.links : null;
      if (!links) return res.status(400).json({ error: 'links must be an array' });
      const clean = links.map(l => ({
        title_en: String(l.title_en || '').slice(0, 200),
        title_zh: String(l.title_zh || '').slice(0, 200),
        url: String(l.url || '').slice(0, 500),
      })).filter(l => l.url && (l.title_en || l.title_zh));
      await q(`INSERT INTO idc_settings (course_code, key, value) VALUES ($1,'links',$2)
        ON CONFLICT (course_code, key) DO UPDATE SET value=$2, updated_at=now()`,
        [course.code, JSON.stringify(clean)]);
      res.json({ success: true, links: clean });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  initSchema()
    .then(() => console.log('✓ idcn-api mounted (/api/idcn/*)'))
    .catch(e => console.error('✗ idcn-api schema init failed:', e.message));
}

module.exports = { mountIdcn, quote, applyPct, IDCN3_TERMS };
