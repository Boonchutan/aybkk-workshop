/**
 * Weekly Transmission tracking — Boonchu's Sunday ritual to city WeChat groups.
 *
 * The drafting job (scripts/transmission/) POSTs /sent when a pack is delivered
 * to Boonchu's phone; his confirm taps (links inside the Telegram/LINE message)
 * record which city groups actually got pasted. /status feeds the Monday nudge
 * and the streak view. Nothing here ever contacts a student.
 *
 * Auth: shared secret ?key=. TRANSMISSION_KEY env wins when set; otherwise the
 * key is derived from NEO4J_PASSWORD so the M1 scripts (which load the same
 * .env) can compute it without any new configuration on Railway.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

function transmissionKey() {
  if (process.env.TRANSMISSION_KEY) return process.env.TRANSMISSION_KEY;
  return crypto.createHash('sha256')
    .update('aybkk-transmission:' + (process.env.NEO4J_PASSWORD || ''))
    .digest('hex').slice(0, 20);
}

function guarded(req, res) {
  if ((req.query.key || req.body?.key || '') !== transmissionKey()) {
    res.status(403).json({ error: 'bad key' });
    return false;
  }
  return true;
}

// POST /api/transmission/sent {key, week, cities: ["xichang", ...]}
// Recorded by the drafting job after the pack reaches Boonchu's phone.
router.post('/sent', async (req, res) => {
  if (!guarded(req, res)) return;
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
  if (!guarded(req, res)) return;
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
  if (!guarded(req, res)) return;
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

module.exports = router;
