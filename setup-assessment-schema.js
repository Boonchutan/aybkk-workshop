/**
 * Setup Neo4j schema for Assessment Bot
 * Creates Tag nodes and Assessment nodes
 */

const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
);

async function setup() {
  const session = driver.session();

  try {
    console.log('Setting up Assessment schema...\n');

    // Create strength tags
    const strengths = [
      'Core Strength', 'Flexibility', 'Breath Control', 'Balance',
      'Focus', 'Consistency', 'Stamina', 'Hip Opening',
      'Backbending', 'Forward Folding', 'Inversion Experience', 'Arm Strength'
    ];

    for (const name of strengths) {
      await session.run(
        `MERGE (t:Tag {name: $name, type: 'strength'})`,
        { name }
      );
      console.log(`  ✓ Strength: ${name}`);
    }

    // Create weakness tags
    const weaknesses = [
      'Chaturanga', 'Jump Back', 'Jump Through', 'Breathing',
      'Core', 'Balance', 'Flexibility', 'Hip Tightness',
      'Shoulder Mobility', 'Backbending', 'Forward Folding',
      'Inversions', 'Arm Balance', 'Wrist Pain', 'Knee Pain',
      'Neck Strain', 'Lower Back', 'Hamstring Tightness',
      'Focus', 'Consistency'
    ];

    for (const name of weaknesses) {
      await session.run(
        `MERGE (t:Tag {name: $name, type: 'weakness'})`,
        { name }
      );
      console.log(`  ✓ Weakness: ${name}`);
    }

    // Create indexes
    console.log('\nCreating indexes...');
    await session.run(`CREATE INDEX student_id IF NOT EXISTS FOR (s:Student) ON (s.id)`);
    await session.run(`CREATE INDEX tag_name IF NOT EXISTS FOR (t:Tag) ON (t.name, t.type)`);
    await session.run(`CREATE INDEX assessment_id IF NOT EXISTS FOR (a:Assessment) ON (a.id)`);
    await session.run(`CREATE INDEX assessment_teacher IF NOT EXISTS FOR (a:Assessment) ON (a.teacher_id)`);
    console.log('  ✓ Indexes created');

    // Show all tags
    const result = await session.run('MATCH (t:Tag) RETURN t.type AS type, count(t) AS count ORDER BY type');
    console.log('\nTag summary:');
    for (const r of result.records) {
      console.log(`  ${r.get('type')}: ${r.get('count')} tags`);
    }

    console.log('\n✅ Schema setup complete!');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    session.close();
    driver.close();
  }
}

setup();
