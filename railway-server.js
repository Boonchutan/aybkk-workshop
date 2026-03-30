const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple file-based orientation storage (works without Neo4j)
app.post('/api/orientation', (req, res) => {
  try {
    const data = {
      ...req.body,
      submittedAt: new Date().toISOString()
    };
    
    const file = path.join(__dirname, 'orientations.json');
    let orientations = [];
    try {
      orientations = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    
    orientations.push(data);
    fs.writeFileSync(file, JSON.stringify(orientations, null, 2));
    
    res.json({ ok: true, id: orientations.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get all orientations (for later import to Neo4j)
app.get('/api/orientations', (req, res) => {
  try {
    const file = path.join(__dirname, 'orientations.json');
    let orientations = [];
    try {
      orientations = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    res.json({ orientations, count: orientations.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ AYBKK Workshop running on port ${PORT}`);
});
