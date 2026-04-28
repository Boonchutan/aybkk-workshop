/**
 * Fix Guangzhou WS students missing a journalLink, and dedupe duplicate
 * names (keep the row with most journals / most recent).
 *
 * Why this exists: students who self-register on /student.html (instead of
 * via the orientation form) hit /api/journal/profile, which used to omit
 * journalLink. Their URL never gets ?id=&name=, so the My Journal / My Week
 * buttons stay hidden. This script backfills the missing link so they can be
 * re-sent the working URL.
 *
 * Usage:
 *   railway run -- node scripts/fix-gz-journal-links.js --dry
 *   railway run -- node scripts/fix-gz-journal-links.js
 */
const neo4j = require('neo4j-driver');

const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');
const BASE_URL = 'https://aybkk-ashtanga.up.railway.app';

const uri = process.env.NEO4J_URI;
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD;

if (!uri || !password) {
  console.error('✗ Missing NEO4J_URI / NEO4J_PASSWORD env vars.');
  process.exit(1);
}

const config = uri.startsWith('neo4j+s') ? {} : { encrypted: 'ENCRYPTION_OFF' };
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), config);

function buildLink({ id, name, language, location }) {
  const lang = language || 'zh';
  const loc = location || 'guangzhou';
  return `${BASE_URL}/student.html?id=${id}`
    + `&name=${encodeURIComponent(name || '')}`
    + `&lang=${lang}`
    + `&location=${loc}`;
}

(async () => {
  const session = driver.session();
  try {
    // Pull every Guangzhou Student (or anyone whose Orientation hangs off a GZ link).
    const rows = await session.run(`
      MATCH (s:Student)
      WHERE s.location = 'guangzhou' OR s.id STARTS WITH 'gz-'
         OR EXISTS { MATCH (s)-[:HAS_PRACTICE_LOG|:HAS_SELF_ASSESSMENT]->(j) WHERE s.location = 'guangzhou' }
      OPTIONAL MATCH (s)-[:HAS_PRACTICE_LOG|:HAS_SELF_ASSESSMENT]->(j)
      WITH s, count(j) AS journals
      RETURN s, journals
      ORDER BY s.createdAt DESC
    `);

    const all = rows.records.map(r => {
      const props = r.get('s').properties;
      return {
        id: props.id,
        name: props.name || '',
        language: props.language,
        location: props.location || 'guangzhou',
        journalLink: props.journalLink || '',
        createdAt: props.createdAt ? props.createdAt.toString() : '',
        journals: r.get('journals').toNumber ? r.get('journals').toNumber() : Number(r.get('journals')),
        props,
      };
    });

    console.log(`Scanned ${all.length} GZ Student nodes.\n`);

    // ─── 1. Backfill missing journalLink ──────────────────────────────────
    const missing = all.filter(s => !s.journalLink && s.id && s.name);
    console.log(`[backfill] ${missing.length} student(s) missing journalLink:`);
    for (const s of missing) {
      const link = buildLink(s);
      console.log(`  ${s.name}  →  ${link}`);
      if (!DRY) {
        await session.run(
          `MATCH (s:Student { id: $id }) SET s.journalLink = $link`,
          { id: s.id, link }
        );
        s.journalLink = link;
      }
    }
    console.log('');

    // ─── 2. Dedupe by name ────────────────────────────────────────────────
    // Placeholder names that are NOT identity matches — different students
    // sometimes register under the same placeholder when they skip the name field.
    const PLACEHOLDERS = new Set(['无', '无名', 'none', 'anonymous', 'test', '匿名', 'na', 'n/a']);
    const byName = new Map();
    for (const s of all) {
      if (!s.name) continue;
      const key = s.name.trim().toLowerCase();
      if (PLACEHOLDERS.has(key)) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(s);
    }
    const dupGroups = [...byName.entries()].filter(([, arr]) => arr.length > 1);
    console.log(`[dedupe] ${dupGroups.length} duplicate name group(s):`);

    let totalDrops = 0;
    for (const [key, members] of dupGroups) {
      members.sort((a, b) => {
        if (b.journals !== a.journals) return b.journals - a.journals;
        // prefer the row that already has a non-empty journalLink
        const aHas = a.journalLink ? 1 : 0;
        const bHas = b.journalLink ? 1 : 0;
        if (bHas !== aHas) return bHas - aHas;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      const keeper = members[0];
      const drops = members.slice(1);
      totalDrops += drops.length;

      console.log(`  ${keeper.name}`);
      console.log(`    keep  ${keeper.id} · journals=${keeper.journals} · link=${!!keeper.journalLink}`);
      for (const d of drops) {
        console.log(`    drop  ${d.id} · journals=${d.journals} · link=${!!d.journalLink}`);
      }
      if (DRY) continue;

      const dropIds = drops.map(d => d.id);

      // Fill keeper's blank fields from the freshest drop that has them.
      const FILL = ['wechatId', 'email', 'phone', 'experience', 'injuries',
                    'goals', 'workshop', 'lineId', 'photoUrl'];
      const fill = {};
      for (const f of FILL) {
        const kv = keeper.props[f];
        if (kv !== null && kv !== undefined && kv !== '') continue;
        for (const d of drops) {
          const dv = d.props[f];
          if (dv !== null && dv !== undefined && dv !== '') { fill[f] = dv; break; }
        }
      }
      if (Object.keys(fill).length) {
        const setClauses = Object.keys(fill).map(f => `k.${f} = $fill_${f}`).join(', ');
        const params = { keeperId: keeper.id };
        for (const [k, v] of Object.entries(fill)) params[`fill_${k}`] = v;
        await session.run(`MATCH (k:Student { id: $keeperId }) SET ${setClauses}`, params);
        console.log(`    ↳ filled blanks: ${Object.keys(fill).join(', ')}`);
      }

      for (const rt of ['HAS_PRACTICE_LOG', 'HAS_SELF_ASSESSMENT', 'HAS_VIDEO']) {
        await session.run(
          `MATCH (k:Student { id: $keeperId })
           MATCH (d:Student) WHERE d.id IN $dropIds
           MATCH (d)-[r:\`${rt}\`]->(t)
           MERGE (k)-[:\`${rt}\`]->(t)
           DELETE r`,
          { keeperId: keeper.id, dropIds }
        );
      }
      await session.run(
        `MATCH (d:Student) WHERE d.id IN $dropIds DETACH DELETE d`,
        { dropIds }
      );
      console.log(`    ✓ merged ${drops.length} drop(s)`);
    }

    console.log(`\n${DRY ? '[DRY RUN]' : 'Done.'}  backfilled: ${missing.length}  ·  merged drops: ${totalDrops}`);
  } catch (e) {
    console.error('✗ Failed:', e.message);
    process.exit(1);
  } finally {
    await session.close();
    await driver.close();
  }
})();
