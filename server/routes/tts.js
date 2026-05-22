const express = require('express');
const router = express.Router();
const { synthesize } = require('../services/edgeTtsService');

// Simple in-memory cache: key = "lang:text" → Buffer
const cache = new Map();
const CACHE_MAX = 200;

router.post('/', async (req, res) => {
  const { text, lang = 'en' } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: 'text too long (max 500 chars)' });
  }

  const cacheKey = `${lang}:${text}`;
  if (cache.has(cacheKey)) {
    const buf = cache.get(cacheKey);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', buf.length);
    res.set('X-Cache', 'HIT');
    return res.send(buf);
  }

  try {
    const audioBuffer = await synthesize(text, lang);

    if (cache.size >= CACHE_MAX) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(cacheKey, audioBuffer);

    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  } catch (err) {
    res.status(502).json({ error: 'TTS synthesis failed', detail: err.message });
  }
});

module.exports = router;
