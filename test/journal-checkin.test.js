// The journal check-in against a fake Neo4j: no database needed.
const express = require('express');
const router = require('../api/student-journal');

function fakeDriver(nodes) {
  const entries = [];
  const run = async (q, p) => {
    for (const [k, v] of Object.entries(p || {})) {
      if (v === undefined) throw new Error(`Expected parameter(s): ${k}`);
    }
    const rec = n => ({ get: () => ({ properties: n }) });
    if (/MATCH \(s:Student \{id: \$id\}\) RETURN s/.test(q)) {
      return { records: nodes.filter(n => n.id === p.id).map(rec) };
    }
    if (/MATCH \(s:Student \{name: \$name\}\)/.test(q)) {
      const idOnly = /s\.id IS NOT NULL/.test(q);
      return { records: nodes.filter(n => n.name === p.name && (!idOnly || n.id)).slice(0, 1).map(rec) };
    }
    if (/MERGE \(s:Student \{id: \$id\}\)/.test(q)) {
      const n = { id: p.id, name: p.name };
      nodes.push(n);
      return { records: [rec(n)] };
    }
    if (/CREATE \(sa:SelfAssessment/.test(q)) {
      if (p.studentId === undefined) throw new Error('Expected parameter(s): studentId');
      entries.push({ studentId: p.studentId, sessionDate: p.sessionDate });
      return { records: [] };
    }
    return { records: [] };
  };
  return { entries, driver: { session: () => ({ run, close: async () => {} }) } };
}

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => { cond ? PASS++ : FAIL++; console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + extra}`); };

async function post(db, body) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.driver = db.driver; next(); });
  app.use('/api/journal', router);
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/journal/checkin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  } finally { srv.close(); }
}

const answers = { vinyasa: 'kept_moving', bandha: 'body_light', stableToday: ['breathing'], difficultToday: ['backbending'],
  practiceNotes: 'passion', location: 'bangkok', sessionDate: '2026-10-07' };

(async () => {
  // An old import with the same name and no id: what broke a Bangkok student on 7 Oct.
  let db = fakeDriver([{ name: 'Test Student' }]);
  let r = await post(db, { studentId: 'bkk-abc123def456', studentName: 'Test Student', ...answers });
  ok('a Bangkok journal saves although an id-less record shares the name', r.status === 200, JSON.stringify(r.body));
  ok('the entry lands on the Bangkok journal id', db.entries[0] && db.entries[0].studentId === 'bkk-abc123def456', JSON.stringify(db.entries));
  ok('on the class day it was opened for', db.entries[0] && db.entries[0].sessionDate === '2026-10-07');

  // Someone else with the same name and a real id: never their journal.
  db = fakeDriver([{ id: 'gz-1', name: 'Test Student' }]);
  await post(db, { studentId: 'bkk-zzz999yyy888', studentName: 'Test Student', ...answers });
  ok("a Bangkok journal never writes into another person's record by name", db.entries[0] && db.entries[0].studentId === 'bkk-zzz999yyy888', JSON.stringify(db.entries));

  // Workshop links keep their old rescue: an unknown id finds the student by name.
  db = fakeDriver([{ id: 'gz-2', name: 'Workshop Student' }]);
  await post(db, { studentId: 'gz-old', studentName: 'Workshop Student', ...answers, location: 'guangzhou' });
  ok('a workshop link with a stale id still finds the student by name', db.entries[0] && db.entries[0].studentId === 'gz-2', JSON.stringify(db.entries));

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
