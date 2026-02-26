// User routes — profile, preferences, stats
const express = require('express');
const router = express.Router();
const db = require('../db');
const { invalidateCachedUser } = require('../auth');
const { ensureAuthenticated } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');

// Get current user
router.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ authenticated: true, user: req.user });
    } else {
        res.json({ authenticated: false });
    }
});

// Update preferences
router.patch('/preferences', ensureAuthenticated, async (req, res) => {
    const { targetLanguage } = req.body;

    if (!targetLanguage) {
        return res.status(400).json({ error: 'targetLanguage is required' });
    }

    try {
        await db.query(
            'UPDATE users SET target_language = ? WHERE id = ?',
            [targetLanguage, req.user.id]
        );

        // Update the session user object and bust cache
        req.user.target_language = targetLanguage;
        invalidateCachedUser(req.user.id);

        res.json({ success: true, targetLanguage });
    } catch (error) {
        console.error('Failed to update user preferences:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get usage stats
router.get('/stats', ensureAuthenticated, async (req, res) => {
    try {
        const usageRes = await db.query(`
            SELECT 
                COUNT(*) as total_requests,
                SUM(total_tokens) as total_tokens,
                SUM(cost_usd) as total_cost
            FROM usage_logs
            WHERE user_id = ?
        `, [req.user.id]);

        const wordsRes = await db.query('SELECT COUNT(*) as saved_words FROM words WHERE user_id = ?', [req.user.id]);

        res.json({
            usage: usageRes.rows[0],
            storage: wordsRes.rows[0]
        });
    } catch (error) {
        sendError(res, 500, error.message);
    }
});

module.exports = router;
