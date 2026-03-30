const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));

async function test() {
  const session = driver.session();
  try {
    // Check Pass nodes
    const pass = await session.run(`MATCH (p:Pass) RETURN keys(p) AS keys, count(p) AS cnt`);
    console.log('Pass properties:', pass.records[0].get('keys'));
    console.log('Total Pass nodes:', pass.records[0].get('cnt').toNumber());

    // Check Booking nodes
    const booking = await session.run(`MATCH (b:Booking) RETURN keys(b) AS keys, count(b) AS cnt LIMIT 3`);
    console.log('\nBooking properties:', booking.records[0]?.get('keys') || 'none');
    console.log('Total Booking nodes:', booking.records[0]?.get('cnt')?.toNumber() || 0);

    // Check any node with 'status' property
    const withStatus = await session.run(`
      MATCH (n)
      WHERE n.status IS NOT NULL
      RETURN labels(n)[0] AS label, count(n) AS cnt
      LIMIT 10
    `);
    console.log('\nNodes with status:');
    withStatus.records.forEach(r => console.log(' ', r.get('label'), ':', r.get('cnt').toNumber()));

    // Check ClassInstance (scheduled classes)
    const classes = await session.run(`MATCH (c:ClassInstance) RETURN keys(c) AS keys LIMIT 2`);
    console.log('\nClassInstance properties:', classes.records[0]?.get('keys') || 'none');

    // Check Booking-Student relationship
    const bookingStudent = await session.run(`
      MATCH (b:Booking)-[r:HAS_STUDENT]->(s:Student)
      RETURN count(b) AS cnt
    `);
    console.log('\nBooking->Student links:', bookingStudent.records[0]?.get('cnt')?.toNumber() || 0);

  } finally {
    session.close();
    driver.close();
  }
}
test().catch(e => console.log('ERR: ' + e.message));