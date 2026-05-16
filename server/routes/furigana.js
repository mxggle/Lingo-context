const express = require('express');
const router = express.Router();
const { generateFurigana } = require('../services/furiganaService');

router.post('/', (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text required' });
    }
    try {
        const furigana = generateFurigana(text.slice(0, 500));
        res.json({ furigana });
    } catch (e) {
        res.status(500).json({ error: 'furigana generation failed' });
    }
});

module.exports = router;
