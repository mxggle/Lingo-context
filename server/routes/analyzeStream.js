// Analyze route — AI text analysis proxy (Streaming)
const express = require('express');
const router = express.Router();
const db = require('../db');
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
        const usage = await analyzeTextStream({ text, context, targetLanguage }, res);

        // Log usage to DB (non-blocking — don't fail request if logging fails)
        if (usage) {
            try {
                await db.query(
                    'INSERT INTO usage_logs (user_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)',
                    [req.user.id, usage.model, usage.promptTokens, usage.completionTokens, usage.totalTokens, usage.cost]
                );
            } catch (logError) {
                console.error('Failed to log usage:', logError);
            }
        }
    } catch (error) {
        console.error('API Error in analyzeStream:', error);
        res.write(`data: ${JSON.stringify({ error: true, message: error.message })}\n\n`);
        res.end();
    }
});

module.exports = router;
