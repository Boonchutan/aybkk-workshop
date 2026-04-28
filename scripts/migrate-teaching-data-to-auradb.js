/**
 * Migrate teaching data from local Neo4j → AuraDB
 * Copies: TeachingStructure, TeachingStage, Asana, Tag, Section
 * and all relationships between them
 *
 * Run once: node scripts/migrate-teaching-data-to-auradb.js
 */

const neo4j = require('neo4j-driver');

const SOURCE = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'),
  { encrypted: 'ENCRYPTION_OFF' }
);

const TARGET = neo4j.driver(
  'neo4j+s://69645294.databases.neo4j.io',
  neo4j.auth.basic('69645294', 'eaWAnXOJaU02tsZhD9OZajvYi0iqP_xiDRxHyWjUUFQ')
);

async function run() {
  const src = SOURCE.session();
  const tgt = TARGET.session();

  try {
    console.log('🔍 Reading teaching data from local Neo4j...\n');

    // ── 1. TeachingStructures ─────────────────────────────────────
    const structRes = await src.run(`
      MATCH (ts:TeachingStructure)
      RETURN ts.name AS name, ts.series AS series, ts.description AS description
    `);
    const structures = structRes.records.map(r => ({
      name: r.get('name'), series: r.get('series'), description: r.get('description')
    }));
    console.log(`Found ${structures.length} TeachingStructures`);

    // ── 2. TeachingStages ─────────────────────────────────────────
    const stageRes = await src.run(`
      MATCH (ts:TeachingStructure)-[:HAS_STAGE]->(stage:TeachingStage)
      RETURN ts.name AS structName, stage.name AS stageName,
             stage.description AS stageDesc, stage.order AS stageOrder
    `);
    const stages = stageRes.records.map(r => ({
      structName: r.get('structName'), name: r.get('stageName'),
      description: r.get('stageDesc'), order: r.get('stageOrder')
    }));
    console.log(`Found ${stages.length} TeachingStages`);

    // ── 3. Asanas + their sections ────────────────────────────────
    const asanaRes = await src.run(`
      MATCH (a:Asana)
      OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
      RETURN a.name AS name, a.englishName AS englishName,
             a.vinyasaCount AS vinyasaCount, a.series AS series,
             a.chineseName AS chineseName, a.description AS description,
             sec.name AS sectionName
    `);
    const asanas = asanaRes.records.map(r => ({
      name: r.get('name'), englishName: r.get('englishName'),
      vinyasaCount: r.get('vinyasaCount'), series: r.get('series'),
      chineseName: r.get('chineseName'), description: r.get('description'),
      sectionName: r.get('sectionName')
    }));
    console.log(`Found ${asanas.length} Asanas`);

    // ── 4. Tags ───────────────────────────────────────────────────
    const tagRes = await src.run(`MATCH (t:Tag) RETURN t.name AS name`);
    const tags = tagRes.records.map(r => ({ name: r.get('name') }));
    console.log(`Found ${tags.length} Tags`);

    // ── 5. Stage → Asana relationships ───────────────────────────
    const teachesRes = await src.run(`
      MATCH (stage:TeachingStage)-[:TEACHES]->(a:Asana)
      RETURN stage.name AS stageName, a.name AS asanaName
    `);
    const teaches = teachesRes.records.map(r => ({
      stageName: r.get('stageName'), asanaName: r.get('asanaName')
    }));
    console.log(`Found ${teaches.length} TEACHES relationships`);

    // ── 6. Asana → Tag relationships ─────────────────────────────
    const involvesRes = await src.run(`
      MATCH (a:Asana)-[:INVOLVES]->(t:Tag)
      RETURN a.name AS asanaName, t.name AS tagName
    `);
    const involves = involvesRes.records.map(r => ({
      asanaName: r.get('asanaName'), tagName: r.get('tagName')
    }));
    console.log(`Found ${involves.length} INVOLVES relationships\n`);

    await src.close();

    // ── Write to AuraDB ───────────────────────────────────────────
    console.log('✍️  Writing to AuraDB...\n');

    // Clear existing teaching data in AuraDB
    console.log('Clearing existing teaching data in AuraDB...');
    await tgt.run(`
      MATCH (n)
      WHERE n:TeachingStructure OR n:TeachingStage OR n:Asana OR n:Tag OR n:Section
      DETACH DELETE n
    `);
    console.log('✓ Cleared\n');

    // Write TeachingStructures
    for (const s of structures) {
      await tgt.run(
        `CREATE (ts:TeachingStructure {name: $name, series: $series, description: $description})`,
        s
      );
    }
    console.log(`✓ Created ${structures.length} TeachingStructures`);

    // Write unique Sections first
    const sections = [...new Set(asanas.filter(a => a.sectionName).map(a => a.sectionName))];
    for (const secName of sections) {
      await tgt.run(`CREATE (sec:Section {name: $name})`, { name: secName });
    }
    console.log(`✓ Created ${sections.length} Sections`);

    // Write Tags
    for (const t of tags) {
      await tgt.run(`CREATE (tag:Tag {name: $name})`, t);
    }
    console.log(`✓ Created ${tags.length} Tags`);

    // Write Asanas + Section relationships
    for (const a of asanas) {
      await tgt.run(`
        CREATE (asana:Asana {
          name: $name,
          englishName: $englishName,
          vinyasaCount: $vinyasaCount,
          series: $series,
          chineseName: $chineseName,
          description: $description
        })
      `, {
        name: a.name, englishName: a.englishName || '',
        vinyasaCount: a.vinyasaCount || 0, series: a.series || '',
        chineseName: a.chineseName || '', description: a.description || ''
      });

      if (a.sectionName) {
        await tgt.run(`
          MATCH (asana:Asana {name: $asanaName}), (sec:Section {name: $secName})
          CREATE (asana)-[:IN_SECTION]->(sec)
        `, { asanaName: a.name, secName: a.sectionName });
      }
    }
    console.log(`✓ Created ${asanas.length} Asanas`);

    // Write TeachingStages + HAS_STAGE relationships
    for (const stage of stages) {
      await tgt.run(`
        MATCH (ts:TeachingStructure {name: $structName})
        CREATE (stage:TeachingStage {name: $name, description: $description, order: $order})
        CREATE (ts)-[:HAS_STAGE]->(stage)
      `, {
        structName: stage.structName, name: stage.name,
        description: stage.description || '', order: stage.order || 0
      });
    }
    console.log(`✓ Created ${stages.length} TeachingStages with HAS_STAGE links`);

    // Write TEACHES relationships in batches
    let teachCount = 0;
    for (const t of teaches) {
      await tgt.run(`
        MATCH (stage:TeachingStage {name: $stageName}), (asana:Asana {name: $asanaName})
        CREATE (stage)-[:TEACHES]->(asana)
      `, t);
      teachCount++;
    }
    console.log(`✓ Created ${teachCount} TEACHES relationships`);

    // Write INVOLVES relationships in batches
    let invCount = 0;
    for (const inv of involves) {
      await tgt.run(`
        MATCH (asana:Asana {name: $asanaName}), (tag:Tag {name: $tagName})
        CREATE (asana)-[:INVOLVES]->(tag)
      `, inv);
      invCount++;
    }
    console.log(`✓ Created ${invCount} INVOLVES relationships`);

    await tgt.close();

    console.log('\n✅ Migration complete! AuraDB now has full teaching data.');
    console.log('Test: https://aybkk-ashtanga.up.railway.app/api/mindmap/tree');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    await src.close().catch(() => {});
    await tgt.close().catch(() => {});
  } finally {
    await SOURCE.close();
    await TARGET.close();
  }
}

run();
