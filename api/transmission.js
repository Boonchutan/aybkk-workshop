/**
 * Weekly Transmission tracking — Boonchu's Sunday ritual to city WeChat groups.
 *
 * The drafting job (scripts/transmission/) POSTs /sent when a pack is delivered
 * to Boonchu's phone; his confirm taps (links inside the Telegram/LINE message)
 * record which city groups actually got pasted. /status feeds the Monday nudge
 * and the streak view. Nothing here ever contacts a student.
 *
 * Auth: shared secret ?key=. TRANSMISSION_KEY env wins when set; otherwise a
 * random key is generated once and stored in Neo4j (:Config). The M1 scripts
 * fetch it exactly once via GET /bootstrap (trust-on-first-use: the first
 * caller after deploy claims it; it is never handed out again).
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

let cachedKey = null;
async function getKey(driver) {
  if (process.env.TRANSMISSION_KEY) return process.env.TRANSMISSION_KEY;
  if (cachedKey) return cachedKey;
  const session = driver.session();
  try {
    const r = await session.run(
      `MERGE (c:Config {name: 'transmissionKey'})
       ON CREATE SET c.value = $v, c.claimed = false, c.createdAt = datetime()
       RETURN c.value AS v`,
      { v: crypto.randomBytes(16).toString('hex') }
    );
    cachedKey = r.records[0].get('v');
    return cachedKey;
  } finally {
    await session.close();
  }
}

async function guarded(req, res) {
  const provided = req.query.key || (req.body && req.body.key) || '';
  const key = await getKey(req.driver);
  if (!provided || provided !== key) {
    res.status(403).json({ error: 'bad key' });
    return false;
  }
  return true;
}

// GET /api/transmission/bootstrap — one-time key handout for the M1 scripts.
// First caller after deploy claims the key; every later call is refused.
router.get('/bootstrap', async (req, res) => {
  if (process.env.TRANSMISSION_KEY) {
    return res.status(404).json({ error: 'key is env-managed' });
  }
  const session = req.driver.session();
  try {
    await getKey(req.driver); // ensure the Config node exists
    const r = await session.run(
      `MATCH (c:Config {name: 'transmissionKey'})
       WHERE coalesce(c.claimed, false) = false
       SET c.claimed = true, c.claimedAt = datetime()
       RETURN c.value AS v`
    );
    if (!r.records.length) return res.status(404).json({ error: 'already claimed' });
    res.json({ key: r.records[0].get('v') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// POST /api/transmission/sent {key, week, cities: ["xichang", ...]}
router.post('/sent', async (req, res) => {
  if (!(await guarded(req, res))) return;
  const { week, cities } = req.body || {};
  if (!week || !Array.isArray(cities) || cities.length === 0) {
    return res.status(400).json({ error: 'week and cities[] required' });
  }
  const session = req.driver.session();
  try {
    for (const city of cities) {
      await session.run(
        `MERGE (t:Transmission {week: $week, city: $city})
         ON CREATE SET t.createdAt = datetime()
         SET t.sentAt = coalesce(t.sentAt, datetime())`,
        { week, city }
      );
    }
    res.json({ success: true, week, cities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/transmission/confirm?week=&city=&key= — Boonchu's one-tap confirm.
router.get('/confirm', async (req, res) => {
  if (!(await guarded(req, res))) return;
  const { week, city } = req.query;
  if (!week || !city) return res.status(400).send('week and city required');
  const session = req.driver.session();
  try {
    await session.run(
      `MERGE (t:Transmission {week: $week, city: $city})
       ON CREATE SET t.createdAt = datetime()
       SET t.confirmedAt = datetime()`,
      { week, city }
    );
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Confirmed</title></head>
<body style="font-family:-apple-system,sans-serif;background:#f1ede3;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;">
<div style="text-align:center;background:#faf6ec;border-radius:16px;padding:36px 28px;box-shadow:0 10px 30px rgba(120,80,40,0.18);">
<div style="font-size:44px;margin-bottom:10px;">🙏</div>
<div style="font-size:20px;font-weight:700;color:#2f2517;">已确认 · Confirmed</div>
<div style="font-size:14px;color:#6c5e4a;margin-top:8px;">${String(city).replace(/[<>&]/g, '')} · week ${String(week).replace(/[<>&]/g, '')}</div>
</div></body></html>`);
  } catch (err) {
    res.status(500).send(err.message);
  } finally {
    await session.close();
  }
});

// GET /api/transmission/status?key= — per-week record + current streak.
router.get('/status', async (req, res) => {
  if (!(await guarded(req, res))) return;
  const session = req.driver.session();
  try {
    const result = await session.run(
      `MATCH (t:Transmission)
       RETURN t.week AS week, t.city AS city,
              toString(t.sentAt) AS sentAt, toString(t.confirmedAt) AS confirmedAt
       ORDER BY week DESC, city ASC`
    );
    const weeks = {};
    for (const r of result.records) {
      const w = r.get('week');
      weeks[w] = weeks[w] || [];
      weeks[w].push({ city: r.get('city'), sentAt: r.get('sentAt'), confirmedAt: r.get('confirmedAt') });
    }
    const ordered = Object.keys(weeks).sort().reverse();
    let streak = 0;
    for (const w of ordered) {
      const allConfirmed = weeks[w].every(c => !c.sentAt || c.confirmedAt);
      if (allConfirmed && weeks[w].some(c => c.sentAt)) streak++;
      else break;
    }
    res.json({ streak, weeks: ordered.map(w => ({ week: w, cities: weeks[w] })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/transmission/shortlist?key= — warmth-ranked grads for the monthly
// voice-note list. Raw signals only; the drafting agent writes the hook lines.
router.get('/shortlist', async (req, res) => {
  if (!(await guarded(req, res))) return;
  const session = req.driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)
      WHERE s.workshop IS NOT NULL AND coalesce(s.isChineseStudent, false) = true
      OPTIONAL MATCH (s)-[:HAS_SELF_ASSESSMENT]->(sa:SelfAssessment)
      WHERE sa.checkedInAt >= datetime() - duration('P90D')
      OPTIONAL MATCH (o:Orientation {id: s.id})
      WITH s, o, count(sa) AS recentCheckins, max(sa.checkedInAt) AS lastCheckin
      RETURN s.id AS id, s.name AS name, s.workshop AS workshop, s.wechatId AS wechat,
             coalesce(o.goals, '') AS goals, coalesce(s.injuries, o.injuries, '') AS injuries,
             recentCheckins, toString(lastCheckin) AS lastCheckin
      ORDER BY recentCheckins DESC, lastCheckin DESC
      LIMIT 25
    `);
    res.json({
      students: result.records.map(r => ({
        id: r.get('id'),
        name: r.get('name'),
        workshop: r.get('workshop'),
        wechat: r.get('wechat'),
        goals: r.get('goals'),
        injuries: r.get('injuries'),
        recentCheckins: (v => (v && v.toNumber ? v.toNumber() : Number(v) || 0))(r.get('recentCheckins')),
        lastCheckin: r.get('lastCheckin')
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// POST /api/transmission/fix-links {key, apply} — server-side version of
// scripts/fix-journal-links.js (the M1 has no Neo4j credentials). Rewrites
// stored journal links that embed a rotating trycloudflare domain.
router.post('/fix-links', async (req, res) => {
  if (!(await guarded(req, res))) return;
  const apply = !!(req.body && req.body.apply);
  const STABLE = process.env.PUBLIC_BASE_URL || 'https://aybkk-ashtanga.up.railway.app';
  const session = req.driver.session();
  try {
    const result = await session.run(
      "MATCH (s:Student) WHERE s.journalLink CONTAINS 'trycloudflare' RETURN s.id AS id, s.journalLink AS link"
    );
    const changes = [];
    for (const r of result.records) {
      const id = r.get('id');
      const link = r.get('link');
      let next = null;
      try {
        const u = new URL(link);
        if (/\.trycloudflare\.com$/i.test(u.hostname)) next = STABLE + u.pathname + u.search + u.hash;
      } catch { /* unparseable — skip */ }
      if (!next) continue;
      changes.push({ id, from: link, to: next });
      if (apply) {
        await session.run('MATCH (s:Student {id: $id}) SET s.journalLink = $link', { id, link: next });
      }
    }
    res.json({ apply, found: result.records.length, rewritten: changes.length, changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
