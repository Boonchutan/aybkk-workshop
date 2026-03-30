// Student-facing Knowledge API - Boonchu spec
const express = require('express');
const neo4j = require('neo4j-driver');
const router = express.Router();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'aybkk-dev')
);

// Get all body areas with movement counts
router.get('/student/body-areas', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (b:BodyPart)
      OPTIONAL MATCH (m:MovementType)-[:USES_BODYPART]->(b)
      OPTIONAL MATCH (a:Asana)-[:INVOLVES]->(m)
      WITH b.name as bodyPart, m.name as movement, count(DISTINCT a) as asanaCount
      RETURN bodyPart, collect({movement: movement, count: asanaCount}) as movements
      ORDER BY bodyPart
    `);
    
    const bodyParts = result.records.map(r => ({
      name: r.get('bodyPart'),
      movements: r.get('movements').filter(m => m.movement !== null)
    }));
    
    res.json(bodyParts);
  } catch (err) {
    console.error('Body areas error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Get movement types (categories for student view)
router.get('/student/movements', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (m:MovementType)
      OPTIONAL MATCH (a:Asana)-[:INVOLVES]->(m)
      WITH m.name as name, count(DISTINCT a) as asanaCount
      RETURN name, asanaCount
      ORDER BY asanaCount DESC
    `);
    
    const movements = result.records.map(r => ({
      name: r.get('name'),
      asanaCount: r.get('asanaCount').low
    }));
    
    res.json(movements);
  } catch (err) {
    console.error('Movements error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Get asanas by movement type
router.get('/student/movement/:name', async (req, res) => {
  const session = driver.session();
  const movementName = req.params.name;
  try {
    const result = await session.run(`
      MATCH (a:Asana)-[:INVOLVES]->(m:MovementType {name: $name})
      RETURN a.name as name
      ORDER BY a.name
    `, { name: movementName });
    
    const asanas = result.records.map(r => r.get('name'));
    res.json(asanas);
  } catch (err) {
    console.error('Movement asanas error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Get all asanas (for asana browser)
router.get('/student/asanas', async (req, res) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (a:Asana)-[:INVOLVES]->(m:MovementType)
      WITH a.name as name, collect(m.name) as movements
      RETURN name, movements
      ORDER BY name
    `);
    
    const asanas = result.records.map(r => ({
      name: r.get('name'),
      movements: r.get('movements')
    }));
    
    res.json(asanas);
  } catch (err) {
    console.error('Asanas error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

// Get asana details with movements and related asanas
router.get('/student/asana/:name', async (req, res) => {
  const session = driver.session();
  const asanaName = req.params.name;
  try {
    // Get asana with its movements
    const result = await session.run(`
      MATCH (a:Asana {name: $name})-[:INVOLVES]->(m:MovementType)
      WITH a.name as name, collect(m.name) as movements
      
      // Find related asanas (share at least one movement)
      OPTIONAL MATCH (a2:Asana)-[:INVOLVES]->(m2:MovementType)
      WHERE m2.name IN movements AND a2.name <> $name
      WITH name, movements, collect(DISTINCT a2.name) as relatedAsanas
      
      RETURN name, movements, relatedAsanas[0..5] as related
    `, { name: asanaName });
    
    if (result.records.length === 0) {
      res.json({ error: 'Asana not found' });
      return;
    }
    
    const r = result.records[0];
    res.json({
      name: r.get('name'),
      movements: r.get('movements'),
      related: r.get('related').filter(a => a !== null)
    });
  } catch (err) {
    console.error('Asana detail error:', err.message);
    res.json({ error: err.message });
  } finally {
    await session.close();
  }
});

// Problems → Solutions mapping
router.get('/student/problems', async (req, res) => {
  const session = driver.session();
  try {
    // Map common problems to movements that help
    const problems = [
      { problem: "Tight shoulders", movements: ["Arm Balance", "Shoulder Extension", "Shoulders Rotation"] },
      { problem: "Tight hips", movements: ["Legs Internal Rotation", "Legs External Rotation", "Leg Split"] },
      { problem: "Weak core", movements: ["Core Strength", "Bandha", "Breathing"] },
      { problem: "Can't do backbends", movements: ["Backbend", "Extreme Backbend", "Core Strength"] },
      { problem: "Balance issues", movements: ["Balance", "Arm Balance"] },
      { problem: "Can't invert", movements: ["Headstand", "Upside Down / Inversion", "Chin Stand"] },
      { problem: "Forward fold tight", movements: ["Forward Bend", "Stretching"] },
      { problem: "Twisting stuck", movements: ["Twisting", "Knee Twisting"] }
    ];
    
    // For each problem/movement, find asanas
    const result = [];
    for (const p of problems) {
      const asanaResult = await session.run(`
        MATCH (a:Asana)-[:INVOLVES]->(m:MovementType)
        WHERE m.name IN $movements
        RETURN m.name as movement, collect(a.name) as asanas
      `, { movements: p.movements });
      
      const solutions = {};
      asanaResult.records.forEach(r => {
        solutions[r.get('movement')] = r.get('asanas').slice(0, 3);
      });
      
      result.push({
        problem: p.problem,
        solutions: solutions
      });
    }
    
    res.json(result);
  } catch (err) {
    console.error('Problems error:', err.message);
    res.json([]);
  } finally {
    await session.close();
  }
});

module.exports = router;