// scripts/seed-chengdu.js — realistic demo data for the Feifei call.
//
// Usage:  DATABASE_URL=... node scripts/seed-chengdu.js
// Idempotent: running it twice will not duplicate the location or the users.
// It prints the passcodes ONCE — copy them somewhere safe immediately.

const crypto = require('crypto');
const { Pool } = require('pg');
const { fen } = require('../partner-money.js');

const pool = new Pool({ connectionString: process.env.DATABASE_URL ||
  process.env.TEST_DATABASE_URL || 'postgres://test:test@127.0.0.1:5432/bkktest' });
const sha = k => crypto.createHash('sha256').update(k).digest('hex');
const code = () => crypto.randomBytes(6).toString('base64url');

const NAMES = ['王小雨', '李梅', '陈强', '刘芳', '张伟', '赵丽', '孙洋', '周杰',
  '吴敏', '郑浩', '林静', '何平', '高翔', '罗琳', '梁冰'];

(async () => {
  const existing = (await pool.query(`SELECT id FROM locations WHERE code='chengdu'`)).rows[0];
  let locId;
  if (existing) {
    locId = existing.id;
    console.log('location chengdu already exists — reusing, users and payments untouched');
  } else {
    locId = (await pool.query(
      `INSERT INTO locations (code,name_en,name_zh,currency,tz)
       VALUES ('chengdu','AYBKK Chengdu (NaSaDi)','AYBKK 成都 · 纳萨蒂','CNY','Asia/Shanghai')
       RETURNING id`)).rows[0].id;

    const users = [
      ['aybkk_owner', 'Boonchu', null, 'en'],
      ['location_admin', 'Lou Han', locId, 'zh'],
      ['partner_viewer', 'Feifei', locId, 'zh'],
    ];
    console.log('\nPASSCODES — shown once, stored hashed:');
    for (const [role, name, lid, lang] of users) {
      const pass = code();
      await pool.query(
        `INSERT INTO loc_users (location_id,role,name,lang,key_hash) VALUES ($1,$2,$3,$4,$5)`,
        [lid, role, name, lang, sha(pass)]);
      console.log(`  ${name.padEnd(10)} ${role.padEnd(16)} → ${pass}`);
    }

    // A month of believable Chengdu income: memberships and drop-ins, mixed
    // collection accounts, two pending, one refund — every state visible.
    const owner = (await pool.query(
      `SELECT id FROM loc_users WHERE role='aybkk_owner' ORDER BY id DESC LIMIT 1`)).rows[0].id;
    const admin = (await pool.query(
      `SELECT id FROM loc_users WHERE role='location_admin' AND location_id=$1
       ORDER BY id DESC LIMIT 1`, [locId])).rows[0].id;

    const month = new Date();
    const day = d => {
      const dt = new Date(month.getFullYear(), month.getMonth(), d, 9, 30);
      return dt.toISOString();
    };
    const rows = [];
    // 12 monthly memberships at ¥1,680, most into NaSaDi's WeChat
    for (let i = 0; i < 12; i++) {
      rows.push([NAMES[i % NAMES.length], '月卡 Monthly membership', fen(1680),
        i % 3 === 0 ? 'alipay' : 'wechat_pay', i % 4 === 0 ? 'AYBKK' : 'PARTNER',
        'confirmed', day(1 + i * 2)]);
    }
    // 14 drop-ins at ¥168
    for (let i = 0; i < 14; i++) {
      rows.push([NAMES[(i + 4) % NAMES.length], '单次课 Drop-in', fen(168),
        i % 5 === 0 ? 'cash' : 'wechat_pay', i % 3 === 0 ? 'AYBKK' : 'PARTNER',
        'confirmed', day(2 + i * 2)]);
    }
    // 2 ten-class packs at ¥1,380
    rows.push(['林静', '十次卡 10-class pack', fen(1380), 'bank', 'AYBKK', 'confirmed', day(9)]);
    rows.push(['高翔', '十次卡 10-class pack', fen(1380), 'wechat_pay', 'PARTNER', 'confirmed', day(15)]);
    // 2 still pending
    rows.push(['罗琳', '月卡 Monthly membership', fen(1680), 'wechat_pay', 'PARTNER', 'pending', null]);
    rows.push(['梁冰', '单次课 Drop-in', fen(168), 'alipay', 'PARTNER', 'pending', null]);

    let refundTarget = null;
    for (const [payer, desc, amt, method, coll, status, at] of rows) {
      const r = await pool.query(
        `INSERT INTO loc_payments
           (location_id,payer_name,description,amount_fen,currency,method,status,
            collected_by,created_by,confirmed_by,confirmed_at)
         VALUES ($1,$2,$3,$4,'CNY',$5,$6,$7,$8,$9,$10) RETURNING id`,
        [locId, payer, desc, amt, method, status, coll, admin,
         status === 'confirmed' ? admin : null, at]);
      if (payer === '刘芳' && !refundTarget) refundTarget = r.rows[0].id;
    }
    // one refund: 刘芳's membership, she moved cities
    if (refundTarget) {
      await pool.query(
        `INSERT INTO loc_payments
           (location_id,payer_name,description,amount_fen,currency,method,status,
            collected_by,created_by,confirmed_by,confirmed_at,refund_of)
         SELECT location_id, payer_name, 'refund: 搬去外地 moved away', -amount_fen, currency,
                method, 'confirmed', collected_by, $2, $2, now(), id
         FROM loc_payments WHERE id=$1`, [refundTarget, admin]);
    }
    await pool.query(
      `INSERT INTO loc_audit (location_id,actor,actor_name,action,entity,after)
       VALUES ($1,$2,'Boonchu','location.create','location',
               '{"name":"AYBKK Chengdu (NaSaDi)"}')`, [locId, owner]);
    console.log(`\nseeded ${rows.length} payments + 1 refund for AYBKK Chengdu`);
  }

  const n = (await pool.query(
    `SELECT count(*)::int AS n, coalesce(sum(amount_fen) FILTER (WHERE status='confirmed'),0)::bigint AS g
     FROM loc_payments WHERE location_id=$1`, [locId])).rows[0];
  console.log(`chengdu now holds ${n.n} payment rows, confirmed gross ¥${(Number(n.g) / 100).toLocaleString()}`);
  await pool.end();
})().catch(e => { console.error('seed failed:', e.message); process.exit(1); });
