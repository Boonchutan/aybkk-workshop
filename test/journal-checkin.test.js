// The journal check-in against a fake Neo4j: no database needed.
const express = require('express');
const router = require('../api/student-journal');

function fakeDriver(nodes) {
  const entries = [];
  const run = async (q, p) => {
    for (const [k, v] of Object.entries(p || {})) {
      if (v === undefined) throw new Error(`Expected parameter(s): ${k}`);
    }
    const rec = n => ({ get: () => ({ properties: { ...n } }) });   // a copy, as the real driver gives
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
    if (/MATCH \(s:Student \{id: \$id\}\) SET s\.name = \$name/.test(q)) {
      for (const n of nodes) if (n.id === p.id) n.name = p.name;
      return { records: [] };
    }
    if (/MATCH \(s:Student \{id: \$id\}\)\s+OPTIONAL MATCH/.test(q)) {
      const n = nodes.find(x => x.id === p.id);
      return { records: n ? [{ get: k => k === 's' ? { properties: n } : [] }] : [] };
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

async function post(db, body, pg = null, path = '/api/journal/checkin') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.driver = db.driver; req.pg = pg; next(); });
  app.use('/api/journal', router);
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${path}`, body === null ? {} : {
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

  // Staff changed the name on aybkk.net (20 Nov 2026): the journal follows the profile, not the first name it got.
  const renamed = [{ id: 'bkk-renamed00001', name: 'Old Probe' }];
  db = fakeDriver(renamed);
  const pg = { query: async (sql, args) => ({ rows: /journal_id = \$1/.test(sql) && args[0] === 'bkk-renamed00001' ? [{ name: 'New Probe' }] : [] }) };
  r = await post(db, { studentId: 'bkk-renamed00001', studentName: 'Old Probe', ...answers }, pg);
  const got = await post(db, null, pg, '/api/journal/student/bkk-renamed00001');
  ok('a renamed Bangkok student: the check-in answers with the new name and the journal node takes it',
     r.status === 200 && r.body.studentName === 'New Probe' && renamed[0].name === 'New Probe' && db.entries.length === 1, JSON.stringify([r.body, renamed]));
  ok('...and her whole journal page shows the new name', got.status === 200 && got.body.name === 'New Probe', JSON.stringify(got.body));
  const wsPg = { query: async () => { throw new Error('no table'); } };
  db = fakeDriver([{ id: 'gz-3', name: 'Workshop Name' }]);
  const ws = await post(db, null, wsPg, '/api/journal/student/gz-3');
  ok('a workshop journal keeps its own name, and a database error never breaks the page', ws.status === 200 && ws.body.name === 'Workshop Name', JSON.stringify(ws.body));

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
