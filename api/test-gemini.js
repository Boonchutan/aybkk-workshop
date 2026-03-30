const express = require('express');
const router = express.Router();

// Dummy Gemini test route
router.get('/', async (req, res) => {
  res.json({ status: 'Gemini API is responsive!' });
});

module.exports = router;