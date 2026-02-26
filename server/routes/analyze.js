// Analyze route — AI text analysis proxy
const express = require('express');
const router = express.Router();
const db = require('../db');
const { ensureAuthenticated } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const { analyzeText } = require('../services/gemini');

router.post('/', ensureAuthenticated, async (req, res) => {
    const { text, context, mode } = req.body;

    // Input validation
    if (!text || typeof text !== 'string') {
        return sendError(res, 400, 'text is required and must be a string');
    }
    if (text.length > 5000) {
        return sendError(res, 400, 'text must be 5000 characters or fewer');
    }

    // Use user's preferred target language if not specified in request
    const targetLanguage = req.body.targetLanguage || req.user.target_language || 'English';

    try {
        const { result, usage } = await analyzeText({ text, context, targetLanguage });

        // Log usage to DB (non-blocking — don't fail request if logging fails)
        try {
            await db.query(
                'INSERT INTO usage_logs (user_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)',
                [req.user.id, usage.model, usage.promptTokens, usage.completionTokens, usage.totalTokens, usage.cost]
            );
        } catch (logError) {
            console.error('Failed to log usage:', logError);
        }

        res.json(result);

    } catch (error) {
        console.error('API Error:', error);
        sendError(res, error.status || 500, error.message);
    }
});

module.exports = router;
