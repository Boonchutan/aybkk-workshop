// API routes for Knowledge Explorer - Updated with correct Plato schema
const express = require('express');
const neo4j = require('neo4j-driver');
const router = express.Router();

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
);

// Movement Types (primary way asanas are categorized)
router.get('/knowledge/body-parts', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (m:MovementType)
      OPTIONAL MATCH (a:Asana)-[:INVOLVES]->(m)
      WITH m.name as name, collect(a.englishName) as asanas
      RETURN name, size(asanas) as count, asanas
      ORDER BY count DESC
      LIMIT 12
    `);
    
    const parts = result.records.map(r => ({
      name: r.get('name'),
      count: r.get('count').low,
      asanas: r.get('asanas').filter(a => a !== null)
    }));
    
    res.json(parts);
  } catch (err) {
    console.error('Movement types error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Series with their asanas (working relationship: BELONGS_TO)
router.get('/knowledge/series', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Series)
      OPTIONAL MATCH (a:Asana)-[:BELONGS_TO]->(s)
      WITH s.name as name, collect(a.englishName) as asanas
      RETURN name, size(asanas) as count, asanas
      ORDER BY 
        CASE name 
          WHEN 'Primary Series' THEN 1 
          WHEN 'Intermediate Series' THEN 2 
          WHEN 'Advanced A' THEN 3 
          WHEN 'Advanced B' THEN 4 
          ELSE 5 
        END
    `);
    
    const series = result.records.map(r => ({
      name: r.get('name'),
      count: r.get('count').low,
      asanas: r.get('asanas').filter(a => a !== null)
    }));
    
    res.json(series);
  } catch (err) {
    console.error('Series error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Sections (standing, seated, etc.)
router.get('/knowledge/sections', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Section)
      OPTIONAL MATCH (a:Asana)-[:HAS_SECTION]->(s)
      WITH s.name as name, collect(a.englishName) as asanas
      RETURN name, size(asanas) as count, asanas
      ORDER BY count DESC
    `);
    
    const sections = result.records.map(r => ({
      name: r.get('name'),
      count: r.get('count').low,
      asanas: r.get('asanas').filter(a => a !== null)
    }));
    
    res.json(sections);
  } catch (err) {
    console.error('Sections error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Core concepts
router.get('/knowledge/concepts', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (c:Concept)
      RETURN c.name as name, c.description as description
      ORDER BY c.name
    `);
    
    const concepts = result.records.map(r => ({
      name: r.get('name'),
      description: r.get('description')
    }));
    
    res.json(concepts);
  } catch (err) {
    console.error('Concepts error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Guru lineage
router.get('/knowledge/gurus', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (p:Person)
      WHERE p.guru = true OR p.lineage = true OR p:Teacher
      RETURN p.name as name, p.title as title, p.description as description
      ORDER BY p.name
    `);
    
    const gurus = result.records.map(r => ({
      name: r.get('name'),
      title: r.get('title') || 'Guru',
      description: r.get('description')
    }));
    
    res.json(gurus);
  } catch (err) {
    console.error('Gurus error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Teaching Stages
router.get('/knowledge/stages', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (t:TeachingStage)
      RETURN t.name as name, t.description as description
      ORDER BY t.name
    `);
    
    const stages = result.records.map(r => ({
      name: r.get('name'),
      description: r.get('description')
    }));
    
    res.json(stages);
  } catch (err) {
    console.error('Stages error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Sanskrit roots
router.get('/knowledge/sanskrit', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (sr:SanskritRoot)
      OPTIONAL MATCH (a:Asana)-[:HAS_SANSKRIT_ROOT]->(sr)
      WITH sr.name as name, sr.meaning as meaning, collect(a.englishName) as asanas
      RETURN name, meaning, asanas
      ORDER BY name
      LIMIT 20
    `);
    
    const roots = result.records.map(r => ({
      name: r.get('name'),
      meaning: r.get('meaning'),
      asanas: r.get('asanas').filter(a => a !== null)
    }));
    
    res.json(roots);
  } catch (err) {
    console.error('Sanskrit error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

module.exports = router;