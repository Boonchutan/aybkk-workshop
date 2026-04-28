/**
 * Wipe all Russia test records from Neo4j.
 * Run via: railway run -- node scripts/clean-ru-test-data.js
 * (uses NEO4J_URI/USER/PASSWORD from Railway env, hits production DB).
 */
const neo4j = require('neo4j-driver');

const uri = process.env.NEO4J_URI;
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD;

if (!uri || !password) {
  console.error('✗ Missing NEO4J_URI / NEO4J_PASSWORD env vars.');
  process.exit(1);
}

const config = uri.startsWith('neo4j+s') ? {} : { encrypted: 'ENCRYPTION_OFF' };
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), config);

(async () => {
  const session = driver.session();
  try {
    // Count first so we can report what we're about to delete
    const countResult = await session.run(
      `MATCH (n) WHERE n.id STARTS WITH 'ru-' OR n.id STARTS WITH 'rutmp-'
       RETURN count(n) AS c`
    );
    const before = countResult.records[0]?.get('c')?.toNumber() ?? 0;
    console.log(`Found ${before} test nodes (ru-* or rutmp-*).`);

    if (before === 0) {
      console.log('✓ Nothing to delete. Production is already clean.');
      return;
    }

    const delResult = await session.run(
      `MATCH (n) WHERE n.id STARTS WITH 'ru-' OR n.id STARTS WITH 'rutmp-'
       DETACH DELETE n
       RETURN count(n) AS deleted`
    );
    const deleted = delResult.records[0]?.get('deleted')?.toNumber() ?? 0;
    console.log(`✓ Deleted ${deleted} nodes. Production is now clean.`);
  } catch (e) {
    console.error('✗ Cleanup failed:', e.message);
    process.exit(1);
  } finally {
    await session.close();
    await driver.close();
  }
})();
