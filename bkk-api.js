// bkk-api.js — AYBKK Bangkok: packages, payment (PaySolutions), passes,
// class schedule, bookings, check-in.
//
// Mount:  mountBkk(app, { pgPool })
//
// Owns its own bkk_* tables. It NEVER writes Rezerv's students/classes/
// bookings/passes tables — the two systems run side by side.
//
// Money rule: a pass is only created after the gateway itself confirms the
// payment AND the amount matches. The PaySolutions postback is treated as an
// untrusted nudge (their own plugins accept it blindly; we do not).

const crypto = require('crypto');
const { sendMail, render } = require('./mailer');

const TZ_OFFSET = '+07:00';                    // Asia/Bangkok, no DST
const SIGNIN_TTL_MIN = 30;                     // a sign-in link is short-lived
const SIGNIN_PER_EMAIL_HOUR = 3;               // and cheap to abuse without limits
const SIGNIN_PER_IP_HOUR = 10;
const CANCEL_CUTOFF_HOURS = 5;                 // cancel ≥5h before start → credit back

// ── seed data (from aybkk.com, captured 2026-08-05) ─────────────────────────
// price_thb is the BASE price. The online surcharge is a setting, applied at
// checkout, so it can be changed without touching the catalogue.
const SEED_PRODUCTS = [
  { code: 'dropin',    name_en: 'Drop-in',              name_th: 'ครั้งเดียว',        price_thb: 1500,  kind: 'credits',   credits: 1,  valid_days: 1,   daily_cap: null, sort: 10 },
  { code: 'pack10',    name_en: '10 classes / 3 months', name_th: '10 ครั้ง / 3 เดือน', price_thb: 14000, kind: 'credits',   credits: 10, valid_days: 90,  daily_cap: null, sort: 20 },
  { code: 'unlim1',    name_en: '1 month unlimited',     name_th: '1 เดือน ไม่จำกัด',   price_thb: 9600,  kind: 'unlimited', credits: null, valid_days: 30,  daily_cap: 2, sort: 30 },
  { code: 'unlim2',    name_en: '2 months unlimited',    name_th: '2 เดือน ไม่จำกัด',   price_thb: 18200, kind: 'unlimited', credits: null, valid_days: 60,  daily_cap: 2, sort: 40 },
  { code: 'unlim3',    name_en: '3 months unlimited',    name_th: '3 เดือน ไม่จำกัด',   price_thb: 25800, kind: 'unlimited', credits: null, valid_days: 90,  daily_cap: 2, sort: 50 },
  { code: 'unlim6',    name_en: '6 months unlimited',    name_th: '6 เดือน ไม่จำกัด',   price_thb: 45000, kind: 'unlimited', credits: null, valid_days: 180, daily_cap: 2, sort: 60 },
  { code: 'unlim12',   name_en: '12 months unlimited (1 free month)', name_th: '12 เดือน ไม่จำกัด (ฟรี 1 เดือน)', price_thb: 78000, kind: 'unlimited', credits: null, valid_days: 395, daily_cap: 2, sort: 70 },
];

// weekday: 0=Sun … 6=Sat
const SEED_SLOTS = [
  // Titles carry no times — the schedule already shows the time in its own column.
  { code: 'my530',   title: 'Mysore (1st batch)',        kind: 'mysore',       weekdays: [1,2,3,4,5], start_time: '05:30', duration_min: 120, capacity: 42, is_online: false },
  { code: 'my730',   title: 'Mysore (2nd batch)',        kind: 'mysore',       weekdays: [1,2,3,4,5], start_time: '07:30', duration_min: 120, capacity: 42, is_online: false },
  { code: 'lp_mon',  title: 'Led Primary series',        kind: 'led_primary',  weekdays: [1],         start_time: '06:30', duration_min: 90,  capacity: 42, is_online: false },
  { code: 'lp_sat',  title: 'Led Primary series',        kind: 'led_primary',  weekdays: [6],         start_time: '07:00', duration_min: 90,  capacity: 42, is_online: false },
  { code: 'li_sat',  title: 'Led Intermediate series',   kind: 'led_inter',    weekdays: [6],         start_time: '08:45', duration_min: 120, capacity: 42, is_online: false },
  { code: 'my_sun',  title: 'Mysore Sunday',             kind: 'mysore',       weekdays: [0],         start_time: '07:00', duration_min: 150, capacity: 42, is_online: false },
  { code: 'olp_mon', title: '[Online] Led Primary series',      kind: 'led_primary', weekdays: [1], start_time: '06:30', duration_min: 90,  capacity: 20, is_online: true },
  { code: 'olp_sat', title: '[Online] Led Primary series',      kind: 'led_primary', weekdays: [6], start_time: '07:00', duration_min: 90,  capacity: 10, is_online: true },
  { code: 'oli_sat', title: '[Online] Led Intermediate series', kind: 'led_inter',   weekdays: [6], start_time: '09:00', duration_min: 120, capacity: 15, is_online: true },
];

function mountBkk(app, opts = {}) {
  const pool = opts.pgPool;
  const ADMIN_KEY = process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || 'aybkk2026';
  // Header only. A key in the query string ends up in access logs, browser
  // history and Referer headers.
  const isAdmin = req => req.headers['x-bkk-key'] === ADMIN_KEY;

  if (!pool) { console.warn('⚠ bkk-api: no pgPool — Bangkok API disabled'); return; }
  const q = (sql, params = []) => pool.query(sql, params);

  // ── schema ────────────────────────────────────────────────────────────────
  async function initSchema() {
    await q(`CREATE TABLE IF NOT EXISTS bkk_settings (
      key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_products (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      name_en TEXT NOT NULL, name_th TEXT, price_thb INTEGER NOT NULL,
      kind TEXT NOT NULL, credits INTEGER, valid_days INTEGER NOT NULL,
      daily_cap INTEGER, active BOOLEAN DEFAULT true, sort INTEGER DEFAULT 100)`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_members (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, email TEXT, phone TEXT,
      student_id TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_members_email ON bkk_members (lower(email))`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_orders (
      id SERIAL PRIMARY KEY, refno BIGINT UNIQUE NOT NULL,
      product_id INTEGER REFERENCES bkk_products(id),
      member_id INTEGER REFERENCES bkk_members(id),
      base_thb INTEGER NOT NULL, fee_thb INTEGER NOT NULL DEFAULT 0,
      amount_thb INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      gateway_ref TEXT, gateway_note TEXT,
      verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_passes (
      id SERIAL PRIMARY KEY, member_id INTEGER REFERENCES bkk_members(id),
      product_id INTEGER REFERENCES bkk_products(id),
      order_id INTEGER REFERENCES bkk_orders(id),
      kind TEXT NOT NULL, credits_total INTEGER, credits_used INTEGER DEFAULT 0,
      daily_cap INTEGER, valid_days INTEGER NOT NULL,
      valid_from DATE, valid_until DATE,
      status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_class_slots (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, kind TEXT, teachers TEXT,
      weekday INTEGER NOT NULL, start_time TEXT NOT NULL,
      duration_min INTEGER NOT NULL, capacity INTEGER NOT NULL,
      is_online BOOLEAN DEFAULT false, active BOOLEAN DEFAULT true)`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_class_overrides (
      id SERIAL PRIMARY KEY, slot_id INTEGER REFERENCES bkk_class_slots(id),
      class_date DATE NOT NULL, cancelled BOOLEAN DEFAULT false,
      capacity INTEGER, note TEXT, UNIQUE (slot_id, class_date))`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_bookings (
      id SERIAL PRIMARY KEY, slot_id INTEGER REFERENCES bkk_class_slots(id),
      class_date DATE NOT NULL, start_at TIMESTAMPTZ NOT NULL,
      member_id INTEGER REFERENCES bkk_members(id),
      pass_id INTEGER REFERENCES bkk_passes(id),
      status TEXT NOT NULL DEFAULT 'booked',
      booked_at TIMESTAMPTZ DEFAULT now(), cancelled_at TIMESTAMPTZ,
      checked_in_at TIMESTAMPTZ)`);
    // Single-use sign-in links. The IP is kept only to rate-limit: this endpoint
    // sends mail from the shala's domain, so it must not become a spam cannon.
    await q(`CREATE TABLE IF NOT EXISTS bkk_login_tokens (
      token TEXT PRIMARY KEY,
      member_id INTEGER REFERENCES bkk_members(id),
      email TEXT, ip TEXT,
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_login_tokens_recent
             ON bkk_login_tokens (created_at)`);
    // Language the student last chose, so email matches the page they bought on.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS lang TEXT`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_bookings_slot_date
             ON bkk_bookings (slot_id, class_date) WHERE status = 'booked'`);
    // One seat per student per class — but only among LIVE bookings. A plain
    // UNIQUE constraint counted cancelled rows too, so a student who cancelled
    // and changed their mind was told "you already booked this class".
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_bookings_one_live
             ON bkk_bookings (slot_id, class_date, member_id) WHERE status = 'booked'`);
    // Existing databases still carry the old table-level constraint.
    await q(`ALTER TABLE bkk_bookings
             DROP CONSTRAINT IF EXISTS bkk_bookings_slot_id_class_date_member_id_key`);

    // seed catalogue + timetable once
    const p = await q('SELECT count(*)::int AS n FROM bkk_products');
    if (p.rows[0].n === 0) {
      for (const s of SEED_PRODUCTS) {
        await q(`INSERT INTO bkk_products (code,name_en,name_th,price_thb,kind,credits,valid_days,daily_cap,sort)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (code) DO NOTHING`,
          [s.code, s.name_en, s.name_th, s.price_thb, s.kind, s.credits, s.valid_days, s.daily_cap, s.sort]);
      }
      console.log(`✓ bkk: seeded ${SEED_PRODUCTS.length} products`);
    }
    const c = await q('SELECT count(*)::int AS n FROM bkk_class_slots');
    if (c.rows[0].n === 0) {
      for (const s of SEED_SLOTS) {
        for (const wd of s.weekdays) {
          await q(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,is_online)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (code) DO NOTHING`,
            [`${s.code}_${wd}`, s.title, s.kind, wd, s.start_time, s.duration_min, s.capacity, s.is_online]);
        }
      }
      console.log('✓ bkk: seeded weekly timetable');
    }
    // The seed above only fires on an empty table, so renaming a class in
    // SEED_SLOTS would never reach a running shala. Titles are synced on every
    // boot instead. Safe while there is no admin UI for renaming slots — add
    // one, and this has to go.
    for (const s of SEED_SLOTS) {
      for (const wd of s.weekdays) {
        await q('UPDATE bkk_class_slots SET title=$2 WHERE code=$1 AND title <> $2',
          [`${s.code}_${wd}`, s.title]);
      }
    }
    const st = await q(`SELECT value FROM bkk_settings WHERE key = 'surcharge_pct'`);
    if (!st.rows.length) {
      await q(`INSERT INTO bkk_settings (key,value) VALUES ('surcharge_pct','5')`);
    }
  }

  async function getSetting(key, fallback) {
    try {
      const r = await q('SELECT value FROM bkk_settings WHERE key = $1', [key]);
      return r.rows.length ? r.rows[0].value : fallback;
    } catch (e) { return fallback; }
  }

  const surcharge = async () => Number(await getSetting('surcharge_pct', 5)) || 0;

  // ── helpers ───────────────────────────────────────────────────────────────
  const memberCode = () => 'B' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  // PaySolutions requires a numeric refno; 10 digits, unique.
  // PaySolutions wants a unique 12-digit numeric reference. 8 digits of clock
  // (unique for ~28h) + 4 random; the UNIQUE index on refno is the backstop.
  const newRefno = () => Number(String(Date.now()).slice(-8) +
    String(Math.floor(Math.random() * 10000)).padStart(4, '0'));
  const refno12 = n => String(n).padStart(12, '0');
  const bkkNow = () => new Date();
  const startAtISO = (dateStr, hhmm) => `${dateStr}T${hhmm}:00${TZ_OFFSET}`;
  // Calendar date in Bangkok, NOT UTC. toISOString() would put 01:00 Bangkok on
  // the previous day — and 05:30 Mysore is booked in exactly those hours.
  const ymd = d => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);

  async function findOrCreateMember({ name, email, phone }) {
    const em = (email || '').trim().toLowerCase();
    if (em) {
      const r = await q('SELECT * FROM bkk_members WHERE lower(email) = $1 LIMIT 1', [em]);
      if (r.rows.length) return r.rows[0];
    }
    const r = await q(
      `INSERT INTO bkk_members (code,name,email,phone) VALUES ($1,$2,$3,$4) RETURNING *`,
      [memberCode(), (name || '').trim() || 'Student', em || null, (phone || '').trim() || null]);
    return r.rows[0];
  }

  // Active pass for a member, preferring one that is already started.
  async function activePass(memberId) {
    const r = await q(
      `SELECT p.*, pr.name_en FROM bkk_passes p JOIN bkk_products pr ON pr.id = p.product_id
       WHERE p.member_id = $1 AND p.status = 'active'
         AND (p.valid_until IS NULL OR p.valid_until >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
         AND (p.kind = 'unlimited' OR p.credits_used < p.credits_total)
       ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1`, [memberId]);
    return r.rows[0] || null;
  }

  // Reports how money can be taken, and — when it cannot — which environment
  // variables are missing. Variable NAMES only, which are already public in the
  // repo; no value, no length, no fragment of any key is ever exposed.
  function paymentStatus() {
    const need = ['PAYSO_MERCHANT_ID', 'PAYSO_SECRET_KEY', 'PAYSO_API_KEY'];
    const missing = need.filter(k => !String(process.env[k] || '').trim());
    if (!missing.length) return { mode: 'gateway' };
    if (String(process.env.PAYSO_PAYSN_STORE || '').trim())
      return { mode: 'link', missingForGateway: missing };
    return { mode: 'none', missing };
  }

  // ── public: catalogue + schedule ──────────────────────────────────────────
  app.get('/api/bkk/products', async (req, res) => {
    try {
      const pct = await surcharge();
      const r = await q('SELECT * FROM bkk_products WHERE active ORDER BY sort, id');
      res.json({
        surchargePct: pct,
        // Which way this shala can take money right now. Names only — never a
        // key, never a fragment of one. 'gateway' = verified auto-activation,
        // 'link' = pay.sn plus a human confirming, 'none' = cannot sell online.
        payment: paymentStatus(),
        products: r.rows.map(p => ({
          ...p,
          fee_thb: Math.round(p.price_thb * pct / 100),
          total_thb: p.price_thb + Math.round(p.price_thb * pct / 100),
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Schedule is generated from the weekly pattern on read — no cron.
  app.get('/api/bkk/schedule', async (req, res) => {
    try {
      const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 14));
      const slots = (await q('SELECT * FROM bkk_class_slots WHERE active')).rows;
      const from = new Date();
      const dates = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(from.getTime() + i * 86400000);
        dates.push(ymd(d));
      }
      const overrides = (await q(
        `SELECT * FROM bkk_class_overrides WHERE class_date = ANY($1::date[])`, [dates])).rows;
      const counts = (await q(
        `SELECT slot_id, class_date, count(*)::int AS n FROM bkk_bookings
         WHERE status = 'booked' AND class_date = ANY($1::date[])
         GROUP BY slot_id, class_date`, [dates])).rows;

      const out = [];
      for (const dstr of dates) {
        const wd = new Date(`${dstr}T12:00:00${TZ_OFFSET}`).getUTCDay();
        for (const s of slots.filter(x => x.weekday === wd)) {
          const ov = overrides.find(o => o.slot_id === s.id && ymd(new Date(o.class_date)) === dstr);
          if (ov && ov.cancelled) continue;
          // ?? not || — an override capacity of 0 ("closed today") is a real value.
          const cap = (ov && ov.capacity != null) ? ov.capacity : s.capacity;
          const booked = (counts.find(c => c.slot_id === s.id && ymd(new Date(c.class_date)) === dstr) || {}).n || 0;
          const startAt = startAtISO(dstr, s.start_time);
          if (new Date(startAt) < bkkNow()) continue;         // hide past classes
          out.push({
            slotId: s.id, date: dstr, startAt, title: s.title, kind: s.kind,
            teachers: s.teachers || '', durationMin: s.duration_min,
            isOnline: s.is_online, capacity: cap, booked, seatsLeft: Math.max(0, cap - booked),
          });
        }
      }
      out.sort((a, b) => a.startAt.localeCompare(b.startAt));
      res.json({ classes: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── buy: create order, hand back a PaySolutions redirect ──────────────────
  app.post('/api/bkk/orders', async (req, res) => {
    try {
      const { productCode, name, email, phone } = req.body || {};
      if (!productCode || !(name || '').trim() || !(email || '').trim())
        return res.status(400).json({ error: 'name, email and product are required' });

      const pr = (await q('SELECT * FROM bkk_products WHERE code = $1 AND active', [productCode])).rows[0];
      if (!pr) return res.status(404).json({ error: 'product not found' });

      const member = await findOrCreateMember({ name, email, phone });
      const pct = await surcharge();
      const fee = Math.round(pr.price_thb * pct / 100);
      const total = pr.price_thb + fee;

      // refno is unique-indexed and partly random, so a clash is possible if two
      // orders land in the same millisecond. Retry rather than 500 at a student.
      let o = null;
      for (let attempt = 0; attempt < 5 && !o; attempt++) {
        try {
          o = (await q(
            `INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,fee_thb,amount_thb)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [newRefno(), pr.id, member.id, pr.price_thb, fee, total])).rows[0];
        } catch (e) {
          if (!/duplicate key/.test(e.message) || attempt === 4) throw e;
        }
      }

      const cfg = paysoConfig();
      res.json({
        order: { id: o.id, refno: String(o.refno), amount: total, product: pr.name_en },
        member: { code: member.code },
        pay: cfg ? buildPayForm(cfg, o, pr, member, req) : null,
        payLink: cfg ? null : paysnLink(o, pr),
        payUnavailable: (cfg || paysnLink(o, pr)) ? undefined :
          'Online payment is not configured yet — the shala will contact you to arrange payment.',
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Pay.sn is PaySolutions' no-code product: a payment link, no API key, no
  // secret, and therefore nothing we can verify server-side. Orders paid this
  // way stay 'pending' until a human confirms in the admin — deliberately, since
  // auto-activating on an unverifiable signal would hand out free memberships.
  // Format from the merchant console: pay.sn/<store>/<amount>/<detail>,
  // capped at 300,000 THB per link.
  const PAYSN_MAX_THB = 300000;
  function paysnLink(order, product) {
    const store = (process.env.PAYSO_PAYSN_STORE || '').trim().replace(/^\/+|\/+$/g, '');
    if (!store) return null;
    if (order.amount_thb > PAYSN_MAX_THB) return null;
    const ref = String(order.refno);
    // The detail is a path segment: keep slashes out of it entirely rather than
    // relying on %2F surviving their router.
    const detail = `AYBKK ${product.name_en} ref ${ref}`.replace(/[\/\\?#&]+/g, '-');
    return {
      url: `https://pay.sn/${store}/${order.amount_thb}/${encodeURIComponent(detail)}`,
      refno: ref,
      amount: order.amount_thb,
      // Shown to the student — they must quote this so the payment can be matched.
      note: `Please keep reference #${ref}. Your pass is activated once the shala ` +
            `sees the payment, usually the same day.`,
    };
  }

  // All three keys are required, not just the merchant id: the redirect itself
  // needs only merchantid, but without the Inquiry credentials we could never
  // confirm a payment, and activating on an unverifiable postback would give
  // away memberships. No credentials → no automatic activation, by design.
  function paysoConfig() {
    const merchantId = process.env.PAYSO_MERCHANT_ID;
    const secret = process.env.PAYSO_SECRET_KEY;
    const apiKey = process.env.PAYSO_API_KEY;
    if (!merchantId || !secret || !apiKey) return null;
    return {
      merchantId, secret, apiKey,
      endpoint: process.env.PAYSO_ENDPOINT || 'https://payments.paysolutions.asia/payment',
      inquiryBase: process.env.PAYSO_INQUIRY_BASE || 'https://apis.paysolutions.asia',
    };
  }

  // The redirect is unsigned — PaySolutions publishes no hash, checksum or MAC
  // for it, so every field here is modifiable by the payer before submitting.
  // Nothing is trusted on the way back: the amount is re-read from the Inquiry
  // API and compared with what we recorded.
  // Return URL and Post Back URL are NOT form fields; they are configured once
  // in the merchant panel and PaySolutions appends no parameters to the return.
  function buildPayForm(cfg, order, product, member) {
    return {
      action: cfg.endpoint,
      fields: {
        merchantid: String(cfg.merchantId),
        refno: refno12(order.refno),
        customeremail: String(member.email || '').slice(0, 100),
        productdetail: `AYBKK ${product.name_en}`.replace(/[<>&"']/g, ' ').slice(0, 255),
        total: order.amount_thb.toFixed(2),
        cc: '00',                                   // 00 = Thai baht
        lang: 'EN',
      },
      refno: refno12(order.refno),
    };
  }

  // ── payment confirmation ──────────────────────────────────────────────────
  // The postback carries NO trustworthy signature (PaySolutions' own plugins
  // accept it blindly). It only tells us *which* order to go and verify.
  app.post('/api/bkk/pay/postback', express_urlencoded_safe, async (req, res) => {
    const refno = String((req.body && (req.body.refno || req.body.refNo)) || req.query.refno || '').trim();
    res.json({ ok: true });                        // always 200 — never leak state
    if (!refno) return;
    try { await verifyAndActivate(Number(refno)); }
    catch (e) { console.error('[bkk pay] verify failed:', e.message); }
  });

  // Student's browser comes back here; also triggers a verify so activation is
  // not dependent on the postback arriving.
  app.get('/api/bkk/pay/check/:refno', async (req, res) => {
    try {
      const r = await verifyAndActivate(Number(req.params.refno));
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  async function verifyAndActivate(refno) {
    const o = (await q('SELECT * FROM bkk_orders WHERE refno = $1', [refno])).rows[0];
    if (!o) return { status: 'unknown' };
    if (o.status === 'paid') return { status: 'paid', already: true };

    const cfg = paysoConfig();
    if (!cfg) return { status: o.status, note: 'gateway not configured' };

    const verdict = await inquire(cfg, o);
    if (!verdict.paid) {
      await q(`UPDATE bkk_orders SET gateway_note = $2 WHERE id = $1`,
        [o.id, (verdict.note || 'not confirmed').slice(0, 300)]);
      return { status: o.status, note: verdict.note };
    }
    // Amount must match what we asked for. A confirmed payment with no amount
    // is not good enough either — the redirect form is unsigned, so the amount
    // is the one thing a payer could have altered, and it is exactly what must
    // be checked before a pass is created.
    if (verdict.amount == null || Math.round(Number(verdict.amount)) !== o.amount_thb) {
      await q(`UPDATE bkk_orders SET status='mismatch', gateway_note=$2 WHERE id=$1`,
        [o.id, `amount ${verdict.amount} != ${o.amount_thb}`]);
      console.warn(`[bkk pay] AMOUNT MISMATCH refno=${refno} gateway=${verdict.amount} expected=${o.amount_thb}`);
      return { status: 'mismatch' };
    }
    await activateOrder(o, verdict);
    return { status: 'paid' };
  }

  // POST /order/orderdetailpost. Header casing is theirs and is inconsistent
  // with their other endpoints — merchantID, merchantSecretKey, apikey — so it
  // is written out literally rather than normalised. merchantID is the LAST 5
  // DIGITS of the merchant id, in both header and body. Unused body fields take
  // the literal placeholders the docs specify ("X", "QWERTY").
  async function inquire(cfg, order) {
    const url = `${cfg.inquiryBase.replace(/\/$/, '')}/order/orderdetailpost`;
    const mid5 = String(cfg.merchantId).slice(-5);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        merchantID: mid5,
        merchantSecretKey: cfg.secret,
        apikey: cfg.apiKey,
      },
      body: JSON.stringify({
        merchantID: mid5,
        orderNo: 'X',
        refno: refno12(order.refno),
        productDetail: 'QWERTY',
      }),
    });
    const text = (await r.text()).trim();
    // Documented failure mode: an unsuccessful payment returns no body at all.
    if (!text) return { paid: false, note: `no record (http ${r.status})` };
    let j = null; try { j = JSON.parse(text); } catch (_) {}
    if (!j) return { paid: false, note: `inquiry ${r.status}: ${text.slice(0, 120)}` };
    const d = Array.isArray(j) ? j[0] : (j.data || j);
    // Carry the HTTP status in every note: an unpaid order and a rejected API
    // key both come back "not paid", and the code is what tells them apart.
    if (!d) return { paid: false, note: `no record (http ${r.status})` };
    const status = String(d.Status ?? '').toUpperCase();
    const paid = status === 'CP';
    // Total comes back as a JSON number (3900.0), not a string.
    const amount = d.Total == null ? null : Number(d.Total);
    return {
      paid, amount, raw: d,
      note: paid ? 'confirmed'
        : `http ${r.status} status=${status || 'unknown'} ${d.StatusName || ''}`.trim(),
    };
  }

  async function activateOrder(order, verdict = {}) {
    const pr = (await q('SELECT * FROM bkk_products WHERE id = $1', [order.product_id])).rows[0];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE bkk_orders SET status='paid', verified_at=now(), gateway_ref=$2, gateway_note=$3
         WHERE id=$1 AND status <> 'paid' RETURNING id`,
        [order.id, verdict.raw ? JSON.stringify(verdict.raw).slice(0, 400) : null, verdict.note || null]);
      if (!upd.rows.length) { await client.query('ROLLBACK'); return; }   // already activated
      await client.query(
        `INSERT INTO bkk_passes (member_id,product_id,order_id,kind,credits_total,daily_cap,valid_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [order.member_id, pr.id, order.id, pr.kind, pr.credits, pr.daily_cap, pr.valid_days]);
      await client.query('COMMIT');
      console.log(`✓ bkk: pass activated for order ${order.id} (${pr.name_en})`);
      notify(`💳 AYBKK payment\n${pr.name_en} · ฿${order.amount_thb}\nrefno ${order.refno}`);
      // After COMMIT, and awaited only so failures are logged. The pass already
      // exists; a mail server having a bad day must not undo a paid order.
      emailReceipt(order, pr).catch(e => console.error('[bkk] receipt failed:', e.message));
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally { client.release(); }
  }

  // The receipt doubles as the student's way back in: it carries a sign-in link,
  // so nobody has to keep a member code safe to keep their pass.
  async function emailReceipt(order, product) {
    const m = (await q('SELECT * FROM bkk_members WHERE id=$1', [order.member_id])).rows[0];
    if (!m || !m.email) return;
    const token = crypto.randomBytes(32).toString('hex');
    await q(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at)
             VALUES ($1,$2,$3,'receipt', now() + interval '30 days')`,
      [token, m.id, m.email]);
    const t = render('receipt', m.lang || 'en', {
      name: m.name, product: product.name_en,
      amount: order.amount_thb, base: order.base_thb, fee: order.fee_thb,
      refno: order.refno, link: `${baseUrl()}/api/bkk/login/${token}`,
    });
    await sendMail({ to: m.email, subject: t.subject, html: t.html, text: t.text, tag: 'receipt' });
  }

  async function notify(text) {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.BOONCHU_CHAT_ID;
      if (!token || !chat) return;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text }),
      });
    } catch (_) {}
  }

  // ── sign in by email ──────────────────────────────────────────────────────
  // A member code lives in one browser. Lose it and the student is locked out —
  // and the shala has no way to look it up either. A one-time link is the only
  // option here that actually proves the student owns the address: a name is
  // guessable and an email address is not a secret.

  const baseUrl = () => (process.env.PUBLIC_BASE_URL || 'https://cn.aybkk.net').replace(/\/$/, '');
  const clientIp = req =>
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress || 'unknown';

  app.post('/api/bkk/login/request', async (req, res) => {
    // The answer never varies. Telling a stranger whether an address is
    // registered would leak the shala's student list one guess at a time.
    const vague = { ok: true, message: 'If that address is registered, a link is on its way.' };
    try {
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      const lang = String((req.body || {}).lang || '').slice(0, 5) || null;
      if (!email || !email.includes('@')) return res.json(vague);
      const ip = clientIp(req);

      const [byEmail, byIp] = await Promise.all([
        q(`SELECT count(*)::int AS n FROM bkk_login_tokens
           WHERE email=$1 AND created_at > now() - interval '1 hour'`, [email]),
        q(`SELECT count(*)::int AS n FROM bkk_login_tokens
           WHERE ip=$1 AND created_at > now() - interval '1 hour'`, [ip]),
      ]);
      if (byEmail.rows[0].n >= SIGNIN_PER_EMAIL_HOUR || byIp.rows[0].n >= SIGNIN_PER_IP_HOUR) {
        console.warn(`[bkk login] throttled ${email} from ${ip}`);
        return res.json(vague);
      }

      const m = (await q('SELECT * FROM bkk_members WHERE lower(email)=$1 LIMIT 1', [email])).rows[0];
      if (!m) return res.json(vague);
      if (lang) await q('UPDATE bkk_members SET lang=$2 WHERE id=$1', [m.id, lang]);

      const token = crypto.randomBytes(32).toString('hex');
      await q(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at)
               VALUES ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)`,
        [token, m.id, email, ip, String(SIGNIN_TTL_MIN)]);

      const t = render('signin', lang || m.lang || 'en',
        { name: m.name, link: `${baseUrl()}/api/bkk/login/${token}` });
      await sendMail({ to: m.email, subject: t.subject, html: t.html, text: t.text, tag: 'signin' });
      res.json(vague);
    } catch (e) {
      console.error('[bkk login] request failed:', e.message);
      res.json(vague);
    }
  });

  // Landing here consumes the token and hands the member code to the browser.
  // Deliberately not a redirect carrying the code in the URL — that would put it
  // in history and in any link the student pastes to a friend.
  app.get('/api/bkk/login/:token', async (req, res) => {
    const page = (msg, code) => `<!DOCTYPE html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AYBKK</title>
<body style="font-family:-apple-system,sans-serif;background:#f7f1f5;color:#17121a;
text-align:center;padding:22vh 20px"><p>${msg}</p>
<script>${code ? `try{localStorage.setItem('aybkk_member',${JSON.stringify(code)})}catch(e){}
setTimeout(function(){location.replace('/book')},600)` : ''}</script></body></html>`;
    try {
      const r = await q(
        `UPDATE bkk_login_tokens SET used_at = now()
         WHERE token = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING member_id`, [req.params.token]);
      if (!r.rows.length) {
        return res.status(400).send(page('That link has already been used, or it has expired.<br>'
          + '<a href="/book" style="color:#5c2160">Ask for a new one</a>'));
      }
      const m = (await q('SELECT code FROM bkk_members WHERE id=$1', [r.rows[0].member_id])).rows[0];
      if (!m) return res.status(404).send(page('We could not find that member.'));
      res.send(page('Signing you in…', m.code));
    } catch (e) {
      console.error('[bkk login] consume failed:', e.message);
      res.status(500).send(page('Something went wrong. Please try again.'));
    }
  });

  // ── member view ───────────────────────────────────────────────────────────
  app.get('/api/bkk/me/:code', async (req, res) => {
    try {
      const m = (await q('SELECT * FROM bkk_members WHERE code = $1', [req.params.code])).rows[0];
      if (!m) return res.status(404).json({ error: 'not found' });
      const passes = (await q(
        `SELECT p.*, pr.name_en FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
         WHERE p.member_id=$1 ORDER BY p.id DESC`, [m.id])).rows;
      const bookings = (await q(
        `SELECT b.*, s.title, s.start_time, s.is_online FROM bkk_bookings b
         JOIN bkk_class_slots s ON s.id=b.slot_id
         WHERE b.member_id=$1 AND b.status='booked' AND b.start_at >= now()
         ORDER BY b.start_at`, [m.id])).rows;
      res.json({
        member: { code: m.code, name: m.name, email: m.email },
        passes: passes.map(p => ({
          name: p.name_en, kind: p.kind, status: p.status,
          creditsLeft: p.kind === 'unlimited' ? null : (p.credits_total - p.credits_used),
          validFrom: p.valid_from, validUntil: p.valid_until, dailyCap: p.daily_cap,
        })),
        bookings,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── booking ───────────────────────────────────────────────────────────────
  app.post('/api/bkk/bookings', async (req, res) => {
    const { memberCode: mcode, slotId, date } = req.body || {};
    if (!mcode || !slotId || !date) return res.status(400).json({ error: 'memberCode, slotId and date required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const m = (await client.query('SELECT * FROM bkk_members WHERE code=$1', [mcode])).rows[0];
      if (!m) throw new Error('member not found');

      const slot = (await client.query('SELECT * FROM bkk_class_slots WHERE id=$1 AND active', [slotId])).rows[0];
      if (!slot) throw new Error('class not found');
      const startAt = startAtISO(date, slot.start_time);
      if (new Date(startAt) < bkkNow()) throw new Error('that class has already started');

      const ov = (await client.query(
        'SELECT * FROM bkk_class_overrides WHERE slot_id=$1 AND class_date=$2', [slotId, date])).rows[0];
      if (ov && ov.cancelled) throw new Error('class cancelled');
      const capacity = (ov && ov.capacity != null) ? ov.capacity : slot.capacity;

      // Serialise everyone booking this same class: a transaction-scoped
      // advisory lock keyed on (slot, date). Counting rows cannot be locked
      // directly (Postgres forbids FOR UPDATE with aggregates), and without
      // this two students can each read "41 booked" and both take seat 42.
      await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)',
        [slotId, Number(String(date).replace(/-/g, ''))]);

      const taken = (await client.query(
        `SELECT count(*)::int AS n FROM bkk_bookings
         WHERE slot_id=$1 AND class_date=$2 AND status='booked'`, [slotId, date])).rows[0].n;
      if (taken >= capacity) throw new Error('class is full');

      const pass = (await client.query(
        `SELECT p.* FROM bkk_passes p
         WHERE p.member_id=$1 AND p.status='active'
           AND (p.valid_until IS NULL OR p.valid_until >= $2::date)
           AND (p.kind='unlimited' OR p.credits_used < p.credits_total)
         ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1 FOR UPDATE`, [m.id, date])).rows[0];
      if (!pass) throw new Error('no active pass — please buy a package first');

      // daily cap (memberships: 2 bookings per day)
      if (pass.daily_cap) {
        const today = (await client.query(
          `SELECT count(*)::int AS n FROM bkk_bookings
           WHERE member_id=$1 AND class_date=$2 AND status='booked'`, [m.id, date])).rows[0].n;
        if (today >= pass.daily_cap)
          throw new Error(`limit is ${pass.daily_cap} classes per day`);
      }

      // first booking starts the validity window
      let validFrom = pass.valid_from, validUntil = pass.valid_until;
      if (!validFrom) {
        validFrom = date;
        const vu = new Date(`${date}T00:00:00${TZ_OFFSET}`);
        vu.setDate(vu.getDate() + pass.valid_days);
        validUntil = ymd(vu);
        await client.query('UPDATE bkk_passes SET valid_from=$2, valid_until=$3 WHERE id=$1',
          [pass.id, validFrom, validUntil]);
      }
      if (pass.kind !== 'unlimited') {
        await client.query('UPDATE bkk_passes SET credits_used = credits_used + 1 WHERE id=$1', [pass.id]);
      }
      const b = (await client.query(
        `INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`, [slotId, date, startAt, m.id, pass.id])).rows[0];
      await client.query('COMMIT');
      res.json({ success: true, booking: b });
    } catch (e) {
      await client.query('ROLLBACK');
      const msg = /duplicate key/.test(e.message) ? 'you already booked this class' : e.message;
      res.status(409).json({ error: msg });
    } finally { client.release(); }
  });

  app.post('/api/bkk/bookings/:id/cancel', async (req, res) => {
    const { memberCode: mcode } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = (await client.query(
        `SELECT b.*, m.code AS mcode FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
         WHERE b.id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!b) throw new Error('booking not found');
      // The member code is REQUIRED. It used to be optional, which meant omitting
      // it skipped the ownership check entirely and let anyone cancel any booking
      // by guessing its id. Staff cancel through the admin, not through here.
      if (!isAdmin(req) && b.mcode !== String(mcode || '')) throw new Error('not your booking');
      if (b.status !== 'booked') throw new Error('already ' + b.status);

      const hoursLeft = (new Date(b.start_at) - bkkNow()) / 3600000;
      const refund = hoursLeft >= CANCEL_CUTOFF_HOURS;
      await client.query(
        `UPDATE bkk_bookings SET status='cancelled', cancelled_at=now() WHERE id=$1`, [b.id]);
      if (refund && b.pass_id) {
        await client.query(
          `UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - 1)
           WHERE id=$1 AND kind <> 'unlimited'`, [b.pass_id]);
      }
      await client.query('COMMIT');
      res.json({
        success: true, creditReturned: refund,
        message: refund ? 'Cancelled — your credit is back.'
          : `Cancelled. Less than ${CANCEL_CUTOFF_HOURS}h before class, so the credit is used.`,
      });
    } catch (e) {
      await client.query('ROLLBACK'); res.status(409).json({ error: e.message });
    } finally { client.release(); }
  });

  // ── check-in (door) ───────────────────────────────────────────────────────
  // "Is this member booked for a class starting around now?"
  // Staff-only: the door page already holds the admin key, and marking someone
  // present is a claim about the real world that a student must not make alone.
  app.post('/api/bkk/checkin', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, reason: 'bad key' });
    try {
      const { memberCode: mcode, windowMin } = req.body || {};
      const win = Math.min(180, Math.max(15, parseInt(windowMin) || 90));
      const m = (await q('SELECT * FROM bkk_members WHERE code=$1', [mcode])).rows[0];
      if (!m) return res.status(404).json({ ok: false, reason: 'unknown member' });
      const b = (await q(
        `SELECT b.*, s.title FROM bkk_bookings b JOIN bkk_class_slots s ON s.id=b.slot_id
         WHERE b.member_id=$1 AND b.status='booked'
           AND b.start_at BETWEEN now() - ($2 || ' minutes')::interval
                              AND now() + ($2 || ' minutes')::interval
         ORDER BY abs(extract(epoch FROM (b.start_at - now()))) LIMIT 1`, [m.id, win])).rows[0];
      if (!b) return res.json({ ok: false, name: m.name, reason: 'no booking for this time' });
      await q(`UPDATE bkk_bookings SET checked_in_at = COALESCE(checked_in_at, now()) WHERE id=$1`, [b.id]);
      res.json({ ok: true, name: m.name, className: b.title, startAt: b.start_at });
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // ── admin ─────────────────────────────────────────────────────────────────
  app.get('/api/bkk/admin/orders', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const r = await q(
        `SELECT o.*, pr.name_en, m.name AS member_name, m.email, m.code AS member_code
         FROM bkk_orders o JOIN bkk_products pr ON pr.id=o.product_id
         JOIN bkk_members m ON m.id=o.member_id ORDER BY o.id DESC LIMIT 200`);
      res.json({ orders: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Deliberate manual override for the day the gateway misbehaves — recorded
  // as such so the books show it was not a verified payment.
  app.post('/api/bkk/admin/orders/:id/force-activate', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const o = (await q('SELECT * FROM bkk_orders WHERE id=$1', [req.params.id])).rows[0];
      if (!o) return res.status(404).json({ error: 'not found' });
      if (o.status === 'paid') return res.json({ success: true, already: true });
      await activateOrder(o, { note: 'MANUAL ACTIVATION by admin' });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bkk/admin/today', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const r = await q(
        `SELECT s.title, b.class_date, b.start_at, m.name, m.code, b.checked_in_at
         FROM bkk_bookings b JOIN bkk_class_slots s ON s.id=b.slot_id
         JOIN bkk_members m ON m.id=b.member_id
         WHERE b.status='booked' AND b.class_date = (now() AT TIME ZONE 'Asia/Bangkok')::date
         ORDER BY b.start_at, m.name`);
      res.json({ bookings: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/admin/settings', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      if (req.body.surchargePct !== undefined) {
        await q(`INSERT INTO bkk_settings (key,value) VALUES ('surcharge_pct',$1)
                 ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
          [JSON.stringify(Number(req.body.surchargePct))]);
      }
      res.json({ success: true, surchargePct: await surcharge() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  initSchema()
    .then(() => console.log('✓ bkk-api mounted (/api/bkk/*)'))
    .catch(e => console.error('✗ bkk-api schema init failed:', e.message));
}

// PaySolutions posts application/x-www-form-urlencoded; make sure that body is
// parsed even though the app defaults to JSON.
const express = require('express');
const express_urlencoded_safe = express.urlencoded({ extended: false });

module.exports = { mountBkk, CANCEL_CUTOFF_HOURS, SEED_PRODUCTS, SEED_SLOTS };
