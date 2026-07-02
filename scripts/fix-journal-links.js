/**
 * Rewrite stored journal links that embed a rotating Cloudflare quick-tunnel
 * domain (trycloudflare.com) to the stable public domain. Those links die on
 * every server restart, which is how the June 2026 cohorts lost their journals.
 *
 * Usage:
 *   node scripts/fix-journal-links.js           # dry run — report only
 *   node scripts/fix-journal-links.js --apply   # rewrite in Neo4j
 */
const neo4j = require('neo4j-driver');
require('dotenv').config();

const STABLE_ORIGIN = process.env.PUBLIC_BASE_URL || 'https://aybkk-ashtanga.up.railway.app';
const APPLY = process.argv.includes('--apply');

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

function rewritten(link) {
  try {
    const u = new URL(link);
    if (!/\.trycloudflare\.com$/i.test(u.hostname)) return null;
    return STABLE_ORIGIN + u.pathname + u.search + u.hash;
  } catch {
    return null; // unparseable — leave alone, report separately
  }
}

async function main() {
  const session = driver.session();
  try {
    const result = await session.run(
      "MATCH (s:Student) WHERE s.journalLink CONTAINS 'trycloudflare' RETURN s.id AS id, s.name AS name, s.workshop AS workshop, s.journalLink AS link"
    );
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — students with tunnel-domain links: ${result.records.length}`);
    let fixed = 0, skipped = 0;
    for (const r of result.records) {
      const id = r.get('id');
      const link = r.get('link');
      const next = rewritten(link);
      if (!next) { skipped++; console.log(`  SKIP (unparseable): ${id} ${link}`); continue; }
      console.log(`  ${id} [${r.get('workshop')}] ${r.get('name')}`);
      console.log(`    ${link}`);
      console.log(`    -> ${next}`);
      if (APPLY) {
        await session.run('MATCH (s:Student {id: $id}) SET s.journalLink = $link', { id, link: next });
        fixed++;
      }
    }
    console.log(APPLY ? `Rewrote ${fixed}, skipped ${skipped}.` : 'Dry run only — re-run with --apply to write.');
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
