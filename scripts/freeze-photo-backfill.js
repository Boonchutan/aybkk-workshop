/**
 * Freeze historical photos: for every SelfAssessment / PracticeLog that has no
 * photoUrl, copy the linked Student.photoUrl onto the entry. Pins each
 * historical card to the photo as of *now*, so future student photo uploads
 * stop changing what old cards display.
 *
 * Run preview:  DRY_RUN=1 railway run -- node scripts/freeze-photo-backfill.js
 * Run for real:           railway run -- node scripts/freeze-photo-backfill.js
 */
const neo4j = require('neo4j-driver');

const uri = process.env.NEO4J_URI;
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!uri || !password) {
  console.error('✗ Missing NEO4J_URI / NEO4J_PASSWORD env vars.');
  process.exit(1);
}

const config = uri.startsWith('neo4j+s') ? {} : { encrypted: 'ENCRYPTION_OFF' };
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), config);

const SELECTORS = [
  { label: 'SelfAssessment', rel: 'HAS_SELF_ASSESSMENT' },
  { label: 'PracticeLog',    rel: 'HAS_PRACTICE_LOG' },
];

(async () => {
  const session = driver.session();
  try {
    console.log(DRY_RUN ? '— DRY RUN —' : '— LIVE RUN —');

    let grandTotal = 0;
    let grandUpdated = 0;
    let skippedNoStudentPhoto = 0;

    for (const { label, rel } of SELECTORS) {
      // Count candidates: entry has no photoUrl AND linked student has one
      const countQ = `
        MATCH (s:Student)-[:${rel}]->(e:${label})
        WHERE e.photoUrl IS NULL AND s.photoUrl IS NOT NULL
        RETURN count(e) AS c
      `;
      const skipQ = `
        MATCH (s:Student)-[:${rel}]->(e:${label})
        WHERE e.photoUrl IS NULL AND s.photoUrl IS NULL
        RETURN count(e) AS c
      `;
      const cRes = await session.run(countQ);
      const sRes = await session.run(skipQ);
      const candidates = cRes.records[0]?.get('c')?.toNumber() ?? 0;
      const skipped    = sRes.records[0]?.get('c')?.toNumber() ?? 0;
      grandTotal += candidates;
      skippedNoStudentPhoto += skipped;
      console.log(`${label}: ${candidates} to freeze · ${skipped} skipped (student has no photo)`);

      if (!DRY_RUN && candidates > 0) {
        const updQ = `
          MATCH (s:Student)-[:${rel}]->(e:${label})
          WHERE e.photoUrl IS NULL AND s.photoUrl IS NOT NULL
          SET e.photoUrl = s.photoUrl,
              e.photoFrozenAt = datetime()
          RETURN count(e) AS updated
        `;
        const uRes = await session.run(updQ);
        const updated = uRes.records[0]?.get('updated')?.toNumber() ?? 0;
        grandUpdated += updated;
        console.log(`  → wrote photoUrl on ${updated} ${label} nodes`);
      }
    }

    console.log('---');
    console.log(`Total candidates: ${grandTotal}`);
    console.log(`Total skipped (no student photo at all): ${skippedNoStudentPhoto}`);
    if (DRY_RUN) {
      console.log('No writes performed. Re-run without DRY_RUN=1 to apply.');
    } else {
      console.log(`Total updated: ${grandUpdated}`);
    }
  } catch (err) {
    console.error('✗ Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    await session.close();
    await driver.close();
  }
})();
