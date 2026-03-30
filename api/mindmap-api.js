const express = require('express');
const neo4j = require('neo4j-driver');

const router = express.Router();

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
);

function parseIntVal(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (val.low !== undefined) return val.low;
  return parseInt(val);
}

// GET /api/mindmap/tree — full tree: structures -> stages -> asanas
router.get('/tree', async (req, res) => {
  const session = driver.session();
  try {
    // TeachingStructure -[:HAS_STAGE]-> TeachingStage -[:TEACHES]-> Asana
    const result = await session.run(`
      MATCH (ts:TeachingStructure)
      OPTIONAL MATCH (ts)-[:HAS_STAGE]->(stage:TeachingStage)
      OPTIONAL MATCH (stage)-[:TEACHES]->(a:Asana)
      OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
      RETURN 
        ts.name as structureName,
        ts.series,
        stage.name as stageName,
        stage.description as stageDesc,
        collect({
          name: a.name,
          englishName: a.englishName,
          vinyasaCount: a.vinyasaCount,
          section: sec.name
        }) as asanas
      ORDER BY ts.name, stage.name
    `);
    
    const structures = {};
    result.records.forEach(record => {
      const structureName = record.get('structureName') || 'Unknown';
      const series = record.get('ts.series') || '';
      
      if (!structures[structureName]) {
        structures[structureName] = {
          name: structureName,
          series: series,
          stages: []
        };
      }
      
      const stageName = record.get('stageName');
      if (stageName) {
        let asanas = record.get('asanas') || [];
        asanas = asanas.filter(a => a.name !== null);
        
        structures[structureName].stages.push({
          name: stageName,
          description: record.get('stageDesc') || '',
          asanas: asanas
        });
      }
    });
    
    res.json({ structures: Object.values(structures) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/asanas — all asanas with tags
router.get('/asanas', async (req, res) => {
  const session = driver.session();
  try {
    // TeachingStage -[:TEACHES]-> Asana
    const result = await session.run(`
      MATCH (stage:TeachingStage)-[:TEACHES]->(a:Asana)
      OPTIONAL MATCH (ts:TeachingStructure)-[:HAS_STAGE]->(stage)
      OPTIONAL MATCH (a)-[:INVOLVES]->(tag:Tag)
      OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
      RETURN 
        a.name as name,
        a.englishName as englishName,
        a.vinyasaCount as vinyasaCount,
        stage.name as stage,
        ts.series as series,
        sec.name as section,
        collect(DISTINCT tag.name) as tags
      ORDER BY a.name
    `);
    
    const asanas = result.records.map(r => ({
      name: r.get('name'),
      englishName: r.get('englishName'),
      vinyasaCount: parseIntVal(r.get('vinyasaCount')),
      stage: r.get('stage'),
      series: r.get('series'),
      section: r.get('section'),
      tags: (r.get('tags') || []).filter(t => t !== null)
    }));
    
    res.json({ asanas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/tags — all tags (actions) with asanas
router.get('/tags', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (tag:Tag)<-[:INVOLVES]-(a:Asana)
      RETURN 
        tag.name as tagName,
        count(DISTINCT a) as asanaCount,
        collect(DISTINCT a.name) as asanas
      ORDER BY tagName
    `);
    
    const tags = result.records.map(r => ({
      name: r.get('tagName'),
      asanaCount: parseIntVal(r.get('asanaCount')),
      asanas: (r.get('asanas') || []).filter(a => a !== null)
    }));
    
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/search?q= — search asanas
router.get('/search', async (req, res) => {
  const session = driver.session();
  const query = req.query.q || '';
  try {
    const result = await session.run(`
      MATCH (a:Asana)
      WHERE a.name CONTAINS $query OR a.englishName CONTAINS $query
      OPTIONAL MATCH (stage:TeachingStage)-[:TEACHES]->(a)
      OPTIONAL MATCH (ts:TeachingStructure)-[:HAS_STAGE]->(stage)
      OPTIONAL MATCH (a)-[:INVOLVES]->(tag:Tag)
      OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
      RETURN 
        a.name as name,
        a.englishName as englishName,
        a.vinyasaCount as vinyasaCount,
        stage.name as stage,
        ts.series as series,
        sec.name as section,
        collect(DISTINCT tag.name) as tags
      ORDER BY a.name
      LIMIT 20
    `, { query });
    
    const asanas = result.records.map(r => ({
      name: r.get('name'),
      englishName: r.get('englishName'),
      vinyasaCount: parseIntVal(r.get('vinyasaCount')),
      stage: r.get('stage'),
      series: r.get('series'),
      section: r.get('section'),
      tags: (r.get('tags') || []).filter(t => t !== null)
    }));
    
    res.json({ asanas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/tag/:tagName — get asanas by tag
router.get('/tag/:tagName', async (req, res) => {
  const session = driver.session();
  const tagName = req.params.tagName;
  try {
    const result = await session.run(`
      MATCH (tag:Tag)<-[:INVOLVES]-(a:Asana)
      WHERE tag.name = $tagName
      OPTIONAL MATCH (stage:TeachingStage)-[:TEACHES]->(a)
      OPTIONAL MATCH (ts:TeachingStructure)-[:HAS_STAGE]->(stage)
      RETURN 
        a.name as name,
        a.englishName as englishName,
        a.vinyasaCount as vinyasaCount,
        stage.name as stage,
        ts.series as series,
        collect(DISTINCT tag.name) as tags
      ORDER BY a.name
    `, { tagName });
    
    const asanas = result.records.map(r => ({
      name: r.get('name'),
      englishName: r.get('englishName'),
      vinyasaCount: parseIntVal(r.get('vinyasaCount')),
      stage: r.get('stage'),
      series: r.get('series'),
      tags: (r.get('tags') || []).filter(t => t !== null)
    }));
    
    res.json({ tagName, asanas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

// GET /api/mindmap/asana/:asanaName — get asana details
router.get('/asana/:asanaName', async (req, res) => {
  const session = driver.session();
  const asanaName = req.params.asanaName;
  try {
    const result = await session.run(`
      MATCH (a:Asana {name: $asanaName})
      OPTIONAL MATCH (stage:TeachingStage)-[:TEACHES]->(a)
      OPTIONAL MATCH (ts:TeachingStructure)-[:HAS_STAGE]->(stage)
      OPTIONAL MATCH (a)-[:INVOLVES]->(tag:Tag)
      OPTIONAL MATCH (a)-[:IN_SECTION]->(sec:Section)
      RETURN 
        a.name as name,
        a.englishName as englishName,
        a.vinyasaCount as vinyasaCount,
        stage.name as stage,
        ts.name as structure,
        ts.series as series,
        sec.name as section,
        collect(DISTINCT tag.name) as tags
    `, { asanaName });
    
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Asana not found' });
    }
    
    const r = result.records[0];
    res.json({
      name: r.get('name'),
      englishName: r.get('englishName'),
      vinyasaCount: parseIntVal(r.get('vinyasaCount')),
      stage: r.get('stage'),
      structure: r.get('structure'),
      series: r.get('series'),
      section: r.get('section'),
      tags: (r.get('tags') || []).filter(t => t !== null)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
