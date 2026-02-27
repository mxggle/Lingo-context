// Analyze route — AI text analysis proxy (Streaming)
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const { analyzeTextStream } = require('../services/geminiStream');

router.post('/', ensureAuthenticated, async (req, res) => {
    const { text, context } = req.body;

    // Input validation
    if (!text || typeof text !== 'string') {
        res.status(400).json({ error: true, message: 'text is required and must be a string' });
        return;
    }
    if (text.length > 5000) {
        res.status(400).json({ error: true, message: 'text must be 5000 characters or fewer' });
        return;
    }

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Important for Vercel/proxies to disable buffering
    res.setHeader('X-Accel-Buffering', 'no');

    // Use user's preferred target language if not specified in request
    const targetLanguage = req.body.targetLanguage || req.user.target_language || 'English';

    try {
        await analyzeTextStream({ text, context, targetLanguage }, res);
    } catch (error) {
        console.error('API Error in analyzeStream:', error);
        res.write(`data: ${JSON.stringify({ error: true, message: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
