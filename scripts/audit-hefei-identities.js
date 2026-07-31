/**
 * Audit Hefei student identities: one person, one active node.
 *
 * Read-only. Fetches /api/students + the deployed roster, groups every
 * Hefei-related Student node by roster person, and classifies each person:
 *   OK          roster journalId node only, active
 *   TWIN        roster node AND active gz- node(s)      -> needs merge
 *   GZ-ONLY     active gz- node(s), no roster node      -> needs merge
 *   MERGED      roster node active; gz- node(s) hidden with mergedInto
 *   HIDDEN-ONLY only inactive gz- node(s)               -> needs review
 * For every node carrying mergedInto it also verifies the alias end-to-end:
 * GET /api/journal/student/<old-gz-id> must answer with the canonical id.
 *
 * Usage: node scripts/audit-hefei-identities.js [--base https://cn.aybkk.net]
 */

const BASE = (() => {
  const i = process.argv.indexOf('--base');
  return (i > -1 && process.argv[i + 1]) || process.env.AYBKK_BASE || 'https://cn.aybkk.net';
})();

const latin = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const matchesPerson = (node, p) => {
  const m = String(p.name || '').match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const pZh = (m ? m[1] : p.name || '').trim();
  const pEn = latin(m ? m[2] : p.name);
  const nZh = String(node.name || '').trim();
  const nEn = latin(node.name);
  const akas = (p.aka || []).map(latin);
  return (pEn && nEn && nEn === pEn) || (pZh && nZh && nZh === pZh)
    || (p.slug && nEn === p.slug) || (nEn && akas.includes(nEn));
};

async function getJson(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
  return r.json();
}

(async () => {
  console.log('base:', BASE, '\n');
  const roster = await getJson('/rosters/hefei.json');
  const body = await getJson('/api/students');
  const all = Array.isArray(body) ? body : (body.students || []);
  const counts = {};
  try {
    const js = await getJson('/api/journal/students');
    for (const s of (js.students || [])) counts[s.id] = s.assessmentCount;
  } catch (e) { console.log('(journal counts unavailable: ' + e.message + ')'); }

  const people = (roster.students || []).filter(s => !/^walk-in/i.test(s.name || '') && s.journalId);
  const journalIds = new Set(people.map(p => p.journalId));
  const hefeiNodes = all.filter(n => n.workshop === 'Hefei WS July 2026' || journalIds.has(n.id));

  const claimed = new Set();
  const rows = [];
  let needsMerge = 0, warnings = 0;

  for (const p of people) {
    const mine = hefeiNodes.filter(n =>
      n.id === p.journalId || (String(n.id).startsWith('gz-') && matchesPerson(n, p)));
    if (!mine.length) continue;
    mine.forEach(n => claimed.add(n.id));
    const rosterNode = mine.find(n => n.id === p.journalId) || null;
    const gz = mine.filter(n => String(n.id).startsWith('gz-'));
    const activeGz = gz.filter(n => n.isActive !== false);
    const mergedGz = gz.filter(n => n.mergedInto);

    let status;
    if (rosterNode && activeGz.length) status = 'TWIN';
    else if (!rosterNode && activeGz.length) status = 'GZ-ONLY';
    else if (rosterNode && gz.length && mergedGz.length === gz.length) status = 'MERGED';
    else if (rosterNode && !gz.length) status = 'OK';
    else if (rosterNode) status = 'OK*'; // hidden gz without mergedInto (pre-alias cleanup)
    else status = 'HIDDEN-ONLY';
    if (status === 'TWIN' || status === 'GZ-ONLY' || status === 'HIDDEN-ONLY') needsMerge++;
    if (status === 'OK' && gz.length === 0 && mine.length === 1) continue; // normal bound student, keep output short

    rows.push({ status, p, rosterNode, gz });
  }

  for (const { status, p, rosterNode, gz } of rows) {
    console.log(`[${status}] ${p.id} ${p.name}`);
    if (rosterNode) {
      console.log(`   ROSTER ${rosterNode.id} · active=${rosterNode.isActive !== false} · checkins=${counts[rosterNode.id] ?? '-'} · name="${rosterNode.name}"`);
    } else {
      console.log('   ROSTER (no node yet for ' + p.journalId + ')');
    }
    for (const n of gz) {
      console.log(`   gz     ${n.id} · active=${n.isActive !== false} · checkins=${counts[n.id] ?? '-'} · mergedInto=${n.mergedInto || '-'}`);
    }
  }

  const unclaimed = hefeiNodes.filter(n => String(n.id).startsWith('gz-') && !claimed.has(n.id));
  if (unclaimed.length) {
    warnings += unclaimed.length;
    console.log('\nWARN unmatched gz- nodes (no roster person — fix aka and rerun):');
    for (const n of unclaimed) console.log(`   ${n.id} · active=${n.isActive !== false} · name="${n.name}"`);
  }

  // alias end-to-end: an old saved link id must answer as the canonical student
  const aliased = hefeiNodes.filter(n => n.mergedInto);
  if (aliased.length) {
    console.log('\nalias checks (old id -> canonical):');
    for (const n of aliased) {
      let ok = false, got = '';
      try {
        const r = await getJson('/api/journal/student/' + encodeURIComponent(n.id));
        got = (r.student && r.student.id) || r.id || '';
        ok = got === n.mergedInto;
      } catch (e) { got = 'ERR ' + e.message; }
      let passOk = '';
      try {
        const pr = await fetch(BASE + '/api/attendance/pass/' + encodeURIComponent(n.id));
        passOk = pr.ok ? ' · pass OK' : ' · pass HTTP ' + pr.status;
      } catch (e) { passOk = ' · pass ERR'; }
      if (!ok) warnings++;
      console.log(`   ${ok ? 'PASS' : 'FAIL'} ${n.id} -> ${got || '(no id in response)'}${passOk}`);
    }
  }

  console.log(`\npeople needing merge: ${needsMerge} · warnings: ${warnings}`);
  if (!needsMerge && !warnings) console.log('✓ every Hefei person resolves to one active roster identity');
  process.exit(warnings ? 2 : (needsMerge ? 3 : 0));
})().catch(e => { console.error('✗ audit failed:', e.message); process.exit(1); });
