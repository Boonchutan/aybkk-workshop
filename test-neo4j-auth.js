require('dotenv').config();
const neo4j = require('neo4j-driver');

console.log('=== Testing Neo4j Connection ===');

// Try different passwords
const passwords = [
  process.env.NEO4J_PASSWORD,
  'neo4j',
  'password',
  'missioncontrol',
  'aybkk123',
  'letmein'
];

async function testPassword(pwd) {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      pwd || 'password'
    )
  );
  
  const session = driver.session();
  try {
    const result = await session.run('RETURN 1 as num');
    console.log('SUCCESS! Password:', pwd);
    await session.close();
    await driver.close();
    return true;
  } catch (err) {
    await session.close();
    await driver.close();
    return false;
  }
}

async function main() {
  console.log('URI:', process.env.NEO4J_URI);
  console.log('User:', process.env.NEO4J_USER);
  console.log('Stored Pwd length:', process.env.NEO4J_PASSWORD?.length || 0);
  
  for (const pwd of passwords) {
    if (!pwd) continue;
    process.stdout.write('Testing: ' + pwd.substring(0, 3) + '... ');
    if (await testPassword(pwd)) {
      console.log('Found working password!');
      process.exit(0);
    } else {
      console.log('Failed');
    }
  }
  
  console.log('\nNone of the passwords worked.');
}

main().catch(console.error);