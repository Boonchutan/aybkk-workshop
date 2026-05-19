#!/usr/bin/env node
const neo4j = require('neo4j-driver');
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD));

(async () => {
  const s = driver.session();
  try {
    const r = await s.run(`MATCH (s:Student) RETURN s.name AS name, s.email AS email, s.phone AS phone, s.source AS source LIMIT 30`);
    console.log('Sample students:');
    for (const row of r.records) {
      console.log(`  ${row.get('name') || '(no name)'}  | email=${row.get('email') || '-'}  | phone=${row.get('phone') || '-'}  | source=${row.get('source') || '-'}`);
    }
    const counts = await s.run(`
      MATCH (s:Student)
      RETURN
        sum(CASE WHEN s.email IS NOT NULL AND s.email <> '' THEN 1 ELSE 0 END) AS withEmail,
        sum(CASE WHEN s.phone IS NOT NULL AND s.phone <> '' THEN 1 ELSE 0 END) AS withPhone,
        count(s) AS total
    `);
    const c = counts.records[0];
    console.log(`\nTotal=${c.get('total').toNumber()}  withEmail=${c.get('withEmail').toNumber()}  withPhone=${c.get('withPhone').toNumber()}`);

    const sources = await s.run(`MATCH (s:Student) RETURN s.source AS source, count(*) AS n ORDER BY n DESC`);
    console.log('\nBy source:');
    for (const row of sources.records) console.log(`  ${row.get('source') || '(null)'}: ${row.get('n').toNumber()}`);
  } finally {
    await s.close(); await driver.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
