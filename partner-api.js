// partner-api.js — partner locations: AYBKK Chengdu (inside NaSaDi) first.
//
// Mount:  mountPartner(app, { pgPool })
//
// This module exists to answer one question from a partner who has never done
// this before: "can I see everything that happens in my house?" So its rules
// are trust rules:
//   - money is integer fen and every split comes from partner-money.js, which
//     is pinned by its own tests before any endpoint here runs
//   - payments are never edited or deleted — a refund is a new negative row
//     linked to its original
//   - every financial write appends to loc_audit inside the same transaction
//   - an issued statement carries a snapshot of the percentages used, so a
//     settings change can never rewrite history
//   - a partner_viewer sees their location and nothing else, enforced on every
//     query, and proven by test/partner-api.test.js
//
// Deliberately separate from bkk_* (whole-baht, Bangkok-hardcoded, and mid
// Rezerv-migration). Bangkok can migrate INTO this structure later.

const crypto = require('crypto');
const {
  splitDaily, netTransfer, formatFen, DEFAULT_PCTS, PCT_BASE,
} = require('./partner-money.js');

function mountPartner(app, opts = {}) {
  const pool = opts.pgPool;
  if (!pool) { console.warn('⚠ partner-api: no pgPool — partner locations disabled'); return; }
  const q = (sql, params = []) => pool.query(sql, params);
  const hashKey = k => crypto.createHash('sha256').update(String(k)).digest('hex');

  // ── schema ────────────────────────────────────────────────────────────────
  async function initSchema() {
    await q(`CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      name_en TEXT NOT NULL, name_zh TEXT,
      currency TEXT NOT NULL DEFAULT 'CNY',
      tz TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      active BOOLEAN DEFAULT true)`);
    await q(`CREATE TABLE IF NOT EXISTS loc_users (
      id SERIAL PRIMARY KEY,
      location_id INTEGER REFERENCES locations(id),   -- NULL = every location
      role TEXT NOT NULL,
      name TEXT NOT NULL, email TEXT, lang TEXT DEFAULT 'en',
      key_hash TEXT NOT NULL,
      active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS loc_settings (
      location_id INTEGER REFERENCES locations(id),
      key TEXT NOT NULL, value JSONB,
      updated_by INTEGER REFERENCES loc_users(id), updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (location_id, key))`);
    await q(`CREATE TABLE IF NOT EXISTS loc_payments (
      id SERIAL PRIMARY KEY,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      kind TEXT NOT NULL DEFAULT 'daily',
      payer_name TEXT, description TEXT,
      amount_fen BIGINT NOT NULL,
      currency TEXT NOT NULL,
      method TEXT NOT NULL,
      reference TEXT, screenshot_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      collected_by TEXT NOT NULL,
      created_by INTEGER REFERENCES loc_users(id),
      confirmed_by INTEGER REFERENCES loc_users(id), confirmed_at TIMESTAMPTZ,
      refund_of INTEGER REFERENCES loc_payments(id),
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS loc_payments_month
             ON loc_payments (location_id, confirmed_at)`);
    await q(`CREATE TABLE IF NOT EXISTS loc_statements (
      id SERIAL PRIMARY KEY,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      month TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      pct_snapshot JSONB NOT NULL, totals JSONB NOT NULL,
      issued_by INTEGER REFERENCES loc_users(id), issued_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (location_id, month))`);
    await q(`CREATE TABLE IF NOT EXISTS loc_statement_comments (
      id SERIAL PRIMARY KEY,
      statement_id INTEGER NOT NULL REFERENCES loc_statements(id) ON DELETE CASCADE,
      author INTEGER REFERENCES loc_users(id),
      body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
    // Append-only by construction: this module exposes no UPDATE or DELETE on it.
    await q(`CREATE TABLE IF NOT EXISTS loc_audit (
      id SERIAL PRIMARY KEY,
      location_id INTEGER REFERENCES locations(id),
      actor INTEGER REFERENCES loc_users(id), actor_name TEXT,
      action TEXT NOT NULL, entity TEXT, entity_id TEXT,
      before JSONB, after JSONB,
      at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS loc_audit_loc ON loc_audit (location_id, at DESC)`);
  }

  // ── auth & scope ──────────────────────────────────────────────────────────
  const ROLES = ['aybkk_owner', 'aybkk_manager', 'location_admin', 'partner_viewer'];
  const CAN_RECORD = ['aybkk_owner', 'aybkk_manager', 'location_admin'];
  const CAN_STATEMENT = ['aybkk_owner', 'aybkk_manager'];

  async function userFrom(req) {
    const key = req.headers['x-loc-key'];
    if (!key) return null;
    const r = await q('SELECT * FROM loc_users WHERE key_hash=$1 AND active', [hashKey(key)]);
    return r.rows[0] || null;
  }

  // Scope is checked on EVERY route: a scoped user asking about any other
  // location gets the same 404 as a location that does not exist. Not 403 —
  // the partner must not even learn which location ids are real.
  async function locFor(req, res, user) {
    const loc = (await q('SELECT * FROM locations WHERE code=$1 AND active',
      [String(req.params.loc || '')])).rows[0];
    if (!loc || (user.location_id != null && user.location_id !== loc.id)) {
      res.status(404).json({ error: 'not found' });
      return null;
    }
    return loc;
  }

  const need = roles => async (req, res, nextFn) => {
    const user = await userFrom(req);
    if (!user) return res.status(401).json({ error: 'sign in' });
    if (roles && !roles.includes(user.role)) return res.status(404).json({ error: 'not found' });
    return nextFn(user);
  };

  async function audit(client, { locationId, user, action, entity, entityId, before, after }) {
    await client.query(
      `INSERT INTO loc_audit (location_id,actor,actor_name,action,entity,entity_id,before,after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [locationId, user ? user.id : null, user ? user.name : 'system',
       action, entity || null, entityId != null ? String(entityId) : null,
       before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
  }

  async function pcts(locationId) {
    const r = await q('SELECT key, value FROM loc_settings WHERE location_id=$1', [locationId]);
    const out = { ...DEFAULT_PCTS };
    for (const row of r.rows) if (row.key in out) out[row.key] = Number(row.value);
    return out;
  }

  // ── who am I ──────────────────────────────────────────────────────────────
  app.post('/api/loc/login', (req, res) => need(null)(req, res, async (user) => {
    const loc = user.location_id
      ? (await q('SELECT code,name_en,name_zh,currency FROM locations WHERE id=$1',
          [user.location_id])).rows[0]
      : null;
    res.json({ user: { name: user.name, role: user.role, lang: user.lang, location: loc } });
  }));

  app.get('/api/loc/locations', (req, res) => need(null)(req, res, async (user) => {
    const r = user.location_id
      ? await q('SELECT code,name_en,name_zh,currency,tz FROM locations WHERE id=$1 AND active',
          [user.location_id])
      : await q('SELECT code,name_en,name_zh,currency,tz FROM locations WHERE active ORDER BY id');
    res.json({ locations: r.rows });
  }));

  // ── payments ──────────────────────────────────────────────────────────────
  app.get('/api/loc/:loc/payments', (req, res) => need(ROLES)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? req.query.month : null;
    const r = await q(
      `SELECT p.*, cu.name AS created_by_name, cb.name AS confirmed_by_name
       FROM loc_payments p
       LEFT JOIN loc_users cu ON cu.id = p.created_by
       LEFT JOIN loc_users cb ON cb.id = p.confirmed_by
       WHERE p.location_id = $1
         AND ($2::text IS NULL OR
              to_char(coalesce(p.confirmed_at, p.created_at) AT TIME ZONE $3, 'YYYY-MM') = $2)
       ORDER BY p.id DESC LIMIT 500`, [loc.id, month, loc.tz]);
    res.json({ payments: r.rows.map(p => ({ ...p, amount_fen: Number(p.amount_fen) })) });
  }));

  app.post('/api/loc/:loc/payments', (req, res) => need(CAN_RECORD)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const b = req.body || {};
    const amount = Number(b.amountFen);
    if (!Number.isSafeInteger(amount) || amount <= 0)
      return res.status(400).json({ error: 'amountFen must be a positive integer (fen)' });
    if (!['wechat_pay', 'alipay', 'cash', 'bank'].includes(b.method))
      return res.status(400).json({ error: 'method must be wechat_pay, alipay, cash or bank' });
    if (!['AYBKK', 'PARTNER'].includes(b.collectedBy))
      return res.status(400).json({ error: 'collectedBy must be AYBKK or PARTNER' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const p = (await client.query(
        `INSERT INTO loc_payments
           (location_id,kind,payer_name,description,amount_fen,currency,method,
            reference,screenshot_path,status,collected_by,created_by)
         VALUES ($1,'daily',$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10) RETURNING *`,
        [loc.id, String(b.payerName || '').slice(0, 120) || null,
         String(b.description || '').slice(0, 200) || null,
         amount, loc.currency, b.method,
         String(b.reference || '').slice(0, 120) || null,
         String(b.screenshotPath || '').slice(0, 300) || null,
         b.collectedBy, user.id])).rows[0];
      await audit(client, { locationId: loc.id, user, action: 'payment.create',
        entity: 'payment', entityId: p.id, after: {
          amount: formatFen(amount, loc.currency === 'CNY' ? '¥' : ''),
          method: b.method, collected_by: b.collectedBy, payer: b.payerName } });
      await client.query('COMMIT');
      res.json({ success: true, payment: p });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
    } finally { client.release(); }
  }));

  app.post('/api/loc/:loc/payments/:id/confirm', (req, res) => need(CAN_RECORD)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `UPDATE loc_payments SET status='confirmed', confirmed_by=$3, confirmed_at=now()
         WHERE id=$1 AND location_id=$2 AND status='pending' RETURNING *`,
        [req.params.id, loc.id, user.id]);
      if (!r.rows.length) { await client.query('ROLLBACK');
        return res.status(409).json({ error: 'not found, or not pending' }); }
      await audit(client, { locationId: loc.id, user, action: 'payment.confirm',
        entity: 'payment', entityId: r.rows[0].id,
        before: { status: 'pending' }, after: { status: 'confirmed' } });
      await client.query('COMMIT');
      res.json({ success: true, payment: r.rows[0] });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
    } finally { client.release(); }
  }));

  // A refund never touches the original row. It is a new, negative, confirmed
  // payment pointing back at what it refunds — so the ledger only ever grows,
  // and the partner can see exactly what happened and when.
  app.post('/api/loc/:loc/payments/:id/refund', (req, res) => need(CAN_RECORD)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orig = (await client.query(
        `SELECT * FROM loc_payments WHERE id=$1 AND location_id=$2 AND status='confirmed'
           AND refund_of IS NULL FOR UPDATE`, [req.params.id, loc.id])).rows[0];
      if (!orig) { await client.query('ROLLBACK');
        return res.status(409).json({ error: 'not found, not confirmed, or itself a refund' }); }
      const already = (await client.query(
        `SELECT coalesce(-sum(amount_fen),0)::bigint AS n FROM loc_payments WHERE refund_of=$1`,
        [orig.id])).rows[0].n;
      const amount = Number((req.body || {}).amountFen ?? (Number(orig.amount_fen) - Number(already)));
      if (!Number.isSafeInteger(amount) || amount <= 0 ||
          amount + Number(already) > Number(orig.amount_fen)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'refund exceeds what remains of the original' });
      }
      const r = (await client.query(
        `INSERT INTO loc_payments
           (location_id,kind,payer_name,description,amount_fen,currency,method,
            status,collected_by,created_by,confirmed_by,confirmed_at,refund_of)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$9,now(),$10) RETURNING *`,
        [loc.id, orig.kind, orig.payer_name,
         `refund: ${String((req.body || {}).reason || '').slice(0, 150) || 'no reason given'}`,
         -amount, loc.currency, orig.method,
         (req.body || {}).collectedBy === 'AYBKK' || (req.body || {}).collectedBy === 'PARTNER'
           ? req.body.collectedBy : orig.collected_by,
         user.id, orig.id])).rows[0];
      await audit(client, { locationId: loc.id, user, action: 'payment.refund',
        entity: 'payment', entityId: orig.id,
        after: { refunded: formatFen(amount), reason: (req.body || {}).reason || null } });
      await client.query('COMMIT');
      res.json({ success: true, refund: r });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
    } finally { client.release(); }
  }));

  // ── statements ────────────────────────────────────────────────────────────
  async function computeMonth(loc, month) {
    const r = (await q(
      `SELECT coalesce(sum(amount_fen),0)::bigint AS gross,
              coalesce(sum(amount_fen) FILTER (WHERE collected_by='PARTNER'),0)::bigint AS by_partner,
              coalesce(sum(amount_fen) FILTER (WHERE collected_by='AYBKK'),0)::bigint AS by_aybkk,
              count(*) FILTER (WHERE refund_of IS NULL)::int AS payments,
              count(*) FILTER (WHERE refund_of IS NOT NULL)::int AS refunds
       FROM loc_payments
       WHERE location_id=$1 AND status='confirmed'
         AND to_char(confirmed_at AT TIME ZONE $3, 'YYYY-MM') = $2`,
      [loc.id, month, loc.tz])).rows[0];
    const p = await pcts(loc.id);
    const split = splitDaily(Number(r.gross), { dailyPartnerPctX100: p.daily_partner_pct });
    const netFen = netTransfer({
      collectedByPartnerFen: Number(r.by_partner), partnerDailyFen: split.partnerFen });
    return {
      pcts: p,
      totals: {
        grossFen: split.grossFen, partnerFen: split.partnerFen, aybkkFen: split.aybkkFen,
        collectedByPartnerFen: Number(r.by_partner), collectedByAybkkFen: Number(r.by_aybkk),
        netFen, paymentCount: r.payments, refundCount: r.refunds,
      },
    };
  }

  app.post('/api/loc/:loc/statements/:month', (req, res) => need(CAN_STATEMENT)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const month = String(req.params.month);
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = (await client.query(
        `SELECT * FROM loc_statements WHERE location_id=$1 AND month=$2 FOR UPDATE`,
        [loc.id, month])).rows[0];
      // An issued statement is history. It is never recomputed — that is the
      // whole point of issuing it.
      if (existing && existing.status === 'issued') { await client.query('ROLLBACK');
        return res.status(409).json({ error: 'already issued — issued statements never change' }); }
      const { pcts: snap, totals } = await computeMonth(loc, month);
      const st = (await client.query(
        `INSERT INTO loc_statements (location_id,month,status,pct_snapshot,totals)
         VALUES ($1,$2,'draft',$3,$4)
         ON CONFLICT (location_id,month)
         DO UPDATE SET pct_snapshot=$3, totals=$4 RETURNING *`,
        [loc.id, month, JSON.stringify(snap), JSON.stringify(totals)])).rows[0];
      await audit(client, { locationId: loc.id, user, action: 'statement.draft',
        entity: 'statement', entityId: st.id, after: { month, ...totals } });
      await client.query('COMMIT');
      res.json({ success: true, statement: st });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
    } finally { client.release(); }
  }));

  app.post('/api/loc/:loc/statements/:month/issue', (req, res) => need(CAN_STATEMENT)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `UPDATE loc_statements SET status='issued', issued_by=$3, issued_at=now()
         WHERE location_id=$1 AND month=$2 AND status='draft' RETURNING *`,
        [loc.id, req.params.month, user.id]);
      if (!r.rows.length) { await client.query('ROLLBACK');
        return res.status(409).json({ error: 'no draft for that month' }); }
      await audit(client, { locationId: loc.id, user, action: 'statement.issue',
        entity: 'statement', entityId: r.rows[0].id, after: { month: req.params.month } });
      await client.query('COMMIT');
      res.json({ success: true, statement: r.rows[0] });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
    } finally { client.release(); }
  }));

  app.get('/api/loc/:loc/statements', (req, res) => need(ROLES)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const r = await q(
      `SELECT s.*, u.name AS issued_by_name,
         (SELECT count(*)::int FROM loc_statement_comments c WHERE c.statement_id=s.id) AS comments
       FROM loc_statements s LEFT JOIN loc_users u ON u.id=s.issued_by
       WHERE s.location_id=$1 ORDER BY s.month DESC`, [loc.id]);
    res.json({ statements: r.rows });
  }));

  app.get('/api/loc/:loc/statements/:month', (req, res) => need(ROLES)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const st = (await q(
      `SELECT * FROM loc_statements WHERE location_id=$1 AND month=$2`,
      [loc.id, req.params.month])).rows[0];
    if (!st) return res.status(404).json({ error: 'not found' });
    const comments = (await q(
      `SELECT c.body, c.created_at, u.name AS author FROM loc_statement_comments c
       LEFT JOIN loc_users u ON u.id=c.author WHERE c.statement_id=$1 ORDER BY c.id`,
      [st.id])).rows;
    const lines = (await q(
      `SELECT p.id, p.payer_name, p.description, p.amount_fen, p.method, p.collected_by,
              p.reference, p.refund_of, p.confirmed_at
       FROM loc_payments p
       WHERE p.location_id=$1 AND p.status='confirmed'
         AND to_char(p.confirmed_at AT TIME ZONE $3,'YYYY-MM')=$2
       ORDER BY p.confirmed_at`, [loc.id, req.params.month, loc.tz])).rows;
    res.json({ statement: st, comments,
      lines: lines.map(l => ({ ...l, amount_fen: Number(l.amount_fen) })),
      location: { code: loc.code, name_en: loc.name_en, name_zh: loc.name_zh, currency: loc.currency } });
  }));

  // The comment is the one thing a partner may WRITE. Feifei disagreeing with a
  // number in the open, on the record, is the trust mechanism working.
  app.post('/api/loc/:loc/statements/:month/comments', (req, res) => need(ROLES)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const body = String((req.body || {}).body || '').trim().slice(0, 1000);
    if (!body) return res.status(400).json({ error: 'empty comment' });
    const st = (await q(`SELECT id FROM loc_statements WHERE location_id=$1 AND month=$2`,
      [loc.id, req.params.month])).rows[0];
    if (!st) return res.status(404).json({ error: 'not found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO loc_statement_comments (statement_id,author,body) VALUES ($1,$2,$3)`,
        [st.id, user.id, body]);
      await audit(client, { locationId: loc.id, user, action: 'statement.comment',
        entity: 'statement', entityId: st.id, after: { comment: body.slice(0, 120) } });
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
    } finally { client.release(); }
  }));

  app.get('/api/loc/:loc/statements/:month/csv', (req, res) => need(ROLES)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const st = (await q(`SELECT * FROM loc_statements WHERE location_id=$1 AND month=$2`,
      [loc.id, req.params.month])).rows[0];
    if (!st) return res.status(404).json({ error: 'not found' });
    const lines = (await q(
      `SELECT p.* FROM loc_payments p
       WHERE p.location_id=$1 AND p.status='confirmed'
         AND to_char(p.confirmed_at AT TIME ZONE $3,'YYYY-MM')=$2 ORDER BY p.confirmed_at`,
      [loc.id, req.params.month, loc.tz])).rows;
    const t = st.totals;
    const escCsv = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const yuan = f => (Number(f) / 100).toFixed(2);
    const rows = [
      ['日期 Date', '学员 Payer', '说明 Description', '方式 Method', '收款方 Collected by',
       '金额(元) Amount (CNY)', '参考号 Reference', '退款 Refund'],
      ...lines.map(l => [
        new Date(l.confirmed_at).toISOString().slice(0, 10), l.payer_name || '', l.description || '',
        l.method, l.collected_by, yuan(l.amount_fen), l.reference || '',
        l.refund_of ? `refund of #${l.refund_of}` : '']),
      [], ['合计 Totals'],
      ['总收入 Gross', yuan(t.grossFen)],
      [`AYBKK (${(st.pct_snapshot.daily_aybkk_pct / 100).toFixed(2)}%)`, yuan(t.aybkkFen)],
      [`NaSaDi (${(st.pct_snapshot.daily_partner_pct / 100).toFixed(2)}%)`, yuan(t.partnerFen)],
      ['合作方已收 Collected by partner', yuan(t.collectedByPartnerFen)],
      [t.netFen >= 0 ? '合作方应转给AYBKK Partner transfers to AYBKK'
                     : 'AYBKK应转给合作方 AYBKK transfers to partner', yuan(Math.abs(t.netFen))],
    ];
    const csv = rows.map(r2 => r2.map(escCsv).join(',')).join('\n');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition',
      `attachment; filename="aybkk-${loc.code}-${req.params.month}.csv"`);
    // The escape is deliberate: a literal BOM in source gets silently stripped
    // by some editors, and fetch .text() strips it on decode (tests read bytes).
    res.send('\ufeff' + csv);
  }));

  // ── dashboard, settings, audit, users ─────────────────────────────────────
  app.get('/api/loc/:loc/summary', (req, res) => need(ROLES)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const month = (await q(`SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM') AS m`, [loc.tz])).rows[0].m;
    const { pcts: p, totals } = await computeMonth(loc, month);
    const latest = (await q(
      `SELECT month, status, issued_at FROM loc_statements
       WHERE location_id=$1 ORDER BY month DESC LIMIT 1`, [loc.id])).rows[0] || null;
    const pending = (await q(
      `SELECT count(*)::int AS n FROM loc_payments WHERE location_id=$1 AND status='pending'`,
      [loc.id])).rows[0].n;
    res.json({
      location: { code: loc.code, name_en: loc.name_en, name_zh: loc.name_zh, currency: loc.currency },
      month, totals, pendingPayments: pending, latestStatement: latest,
      partnerPct: p.daily_partner_pct,
    });
  }));

  app.get('/api/loc/:loc/settings', (req, res) => need(ROLES)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    res.json({ pcts: await pcts(loc.id) });
  }));

  app.put('/api/loc/:loc/settings', (req, res) => need(['aybkk_owner'])(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const b = (req.body || {}).pcts || {};
    const current = await pcts(loc.id);
    const next = { ...current };
    for (const k of Object.keys(DEFAULT_PCTS)) {
      if (b[k] === undefined) continue;
      const v = Number(b[k]);
      if (!Number.isSafeInteger(v) || v < 0 || v > PCT_BASE)
        return res.status(400).json({ error: `${k} must be 0..${PCT_BASE} (hundredths of a percent)` });
      next[k] = v;
    }
    // The two sides of each split must be the whole pie — a 70/40 "split" is a
    // typo, and typos in percentages are money.
    if (next.daily_aybkk_pct + next.daily_partner_pct !== PCT_BASE)
      return res.status(400).json({ error: 'daily percentages must sum to 100.00%' });
    if (next.host_aybkk_pct + next.host_partner_pct !== PCT_BASE)
      return res.status(400).json({ error: 'host percentages must sum to 100.00%' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [k, v] of Object.entries(next)) {
        await client.query(
          `INSERT INTO loc_settings (location_id,key,value,updated_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (location_id,key) DO UPDATE SET value=$3, updated_by=$4, updated_at=now()`,
          [loc.id, k, JSON.stringify(v), user.id]);
      }
      await audit(client, { locationId: loc.id, user, action: 'settings.change',
        entity: 'settings', before: current, after: next });
      await client.query('COMMIT');
      res.json({ success: true, pcts: next });
    } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
    } finally { client.release(); }
  }));

  app.get('/api/loc/:loc/audit', (req, res) => need(ROLES)(req, res, async (user) => {
    const loc = await locFor(req, res, user); if (!loc) return;
    const r = await q(
      `SELECT actor_name, action, entity, entity_id, before, after, at
       FROM loc_audit WHERE location_id=$1 ORDER BY at DESC LIMIT 200`, [loc.id]);
    res.json({ audit: r.rows });
  }));

  // Owner manages accounts. Passcodes are shown once and stored hashed.
  app.post('/api/loc/users', (req, res) => need(['aybkk_owner'])(req, res, async (user) => {
    try {
      const b = req.body || {};
      if (!ROLES.includes(b.role)) return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });
      if (!String(b.name || '').trim()) return res.status(400).json({ error: 'name required' });
      let locationId = null;
      if (['location_admin', 'partner_viewer'].includes(b.role)) {
        const loc = (await q('SELECT id FROM locations WHERE code=$1', [String(b.location || '')])).rows[0];
        if (!loc) return res.status(400).json({ error: 'that role needs a real location' });
        locationId = loc.id;
      }
      const passcode = crypto.randomBytes(6).toString('base64url');
      const r = await q(
        `INSERT INTO loc_users (location_id,role,name,email,lang,key_hash)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,role,name,email,lang,location_id`,
        [locationId, b.role, String(b.name).trim(), b.email || null,
         ['zh', 'en'].includes(b.lang) ? b.lang : 'en', hashKey(passcode)]);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await audit(client, { locationId, user, action: 'user.create',
          entity: 'user', entityId: r.rows[0].id,
          after: { name: b.name, role: b.role } });
        await client.query('COMMIT');
      } finally { client.release(); }
      res.json({ success: true, user: r.rows[0], passcode,
        note: 'Give this passcode to them now — it cannot be shown again.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  // One-tap demo seed (loc-seed.html). Gated by the Bangkok admin key, not by
  // loc_users — the owner account does not exist until the seed has run.
  // Idempotent, and passcodes come back only on the run that created them.
  app.post('/api/loc/seed-demo', async (req, res) => {
    const adminKey = process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || 'aybkk2026';
    if (req.headers['x-bkk-key'] !== adminKey)
      return res.status(401).json({ error: 'bad key' });
    try {
      const { seedChengdu } = require('./scripts/seed-chengdu.js');
      res.json(await seedChengdu(pool));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  initSchema()
    .then(() => console.log('✓ partner-api mounted (/api/loc/*)'))
    .catch(e => console.error('✗ partner-api schema init failed:', e.message));
}

module.exports = { mountPartner };
