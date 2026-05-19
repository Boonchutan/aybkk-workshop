#!/usr/bin/env node
/**
 * Poll AuraDB until a NEW LINE follower appears, then print its UID.
 * Exits 0 with the UID on stdout; exits 1 on timeout.
 *
 *   railway run node scripts/wait-for-follower.js [timeoutSeconds]
 */
const neo4j = require('neo4j-driver');
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD));

const timeoutSec = parseInt(process.argv[2] || '600', 10);
const start = Date.now();

(async () => {
  while ((Date.now() - start) / 1000 < timeoutSec) {
    const s = driver.session();
    try {
      const r = await s.run(`
        MATCH (la:LineAccount)
        WHERE la.followedBot = true AND la.unfollowedAt IS NULL
        RETURN la.uid AS uid, la.createdAt AS at, la.pendingCode AS code,
               la.linked AS linked
        ORDER BY la.createdAt DESC LIMIT 1
      `);
      if (r.records.length) {
        const rec = r.records[0];
        console.log(JSON.stringify({
          uid: rec.get('uid'),
          code: rec.get('code'),
          linked: rec.get('linked'),
          at: String(rec.get('at'))
        }));
        await s.close(); await driver.close();
        process.exit(0);
      }
    } finally { await s.close(); }
    await new Promise(r => setTimeout(r, 8000));
  }
  console.error('TIMEOUT: no follower appeared');
  await driver.close();
  process.exit(1);
})();
