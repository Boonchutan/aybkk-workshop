const neo4j = require('neo4j-driver');

async function test() {
  console.log('=== Direct Neo4j Test ===');
  
  // Try different possible passwords
  const passwords = ['neo4j', 'password', '...2026', 'test123', 'admin'];
  
  for (const pwd of passwords) {
    const driver = neo4j.driver(
      'bolt://localhost:7687',
      neo4j.auth.basic('neo4j', pwd)
    );
    const session = driver.session();
    
    try {
      const result = await session.run('RETURN 1 as n');
      console.log(`SUCCESS with password: ${pwd}`);
      await session.close();
      await driver.close();
      process.exit(0);
    } catch (err) {
      console.log(`Failed: ${pwd} - ${err.message.substring(0, 50)}`);
      await session.close();
      await driver.close();
    }
  }
  
  console.log('All passwords failed');
}

test().catch(e => console.error(e));