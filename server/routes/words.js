// Words routes — CRUD for saved vocabulary
const express = require('express');
const router = express.Router();
const db = require('../db');
const { ensureAuthenticated } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');

// Save word (with deduplication and multi-context support)
router.post('/', ensureAuthenticated, async (req, res) => {
    const { text, meaning, grammar, context, language, url } = req.body;

    // Input validation
    if (!text || typeof text !== 'string') {
        return sendError(res, 400, 'text is required and must be a string');
    }
    if (text.length > 5000) {
        return sendError(res, 400, 'text must be 5000 characters or fewer');
    }

    const textLower = text.toLowerCase();

    try {
        // 1. Check if word already exists for this user+language
        const existing = await db.query(
            'SELECT id, lookup_count FROM words WHERE user_id = ? AND LOWER(text) = ? AND language = ?',
            [req.user.id, textLower, language]
        );

        if (existing.rows.length > 0) {
            const wordId = existing.rows[0].id;

            // 2. Check if exact same context+url exists (duplicate)
            const duplicateContext = await db.query(
                'SELECT id FROM word_contexts WHERE word_id = ? AND (context = ? OR (context IS NULL AND ? IS NULL)) AND (url = ? OR (url IS NULL AND ? IS NULL))',
                [wordId, context, context, url, url]
            );

            if (duplicateContext.rows.length > 0) {
                // Exact duplicate — just lift order and increment lookup count
                await db.query(
                    'UPDATE words SET saved_at = NOW(), lookup_count = lookup_count + 1 WHERE id = ?',
                    [wordId]
                );
                return res.json({ success: true, action: 'lifted', id: wordId });
            }

            // 3. Same word, different context — add new context
            await db.query(
                'INSERT INTO word_contexts (word_id, context, url) VALUES (?, ?, ?)',
                [wordId, context, url]
            );
            // Update word: lift order, increment lookup, update meaning/grammar to latest
            await db.query(
                'UPDATE words SET saved_at = NOW(), lookup_count = lookup_count + 1, meaning = ?, grammar = ? WHERE id = ?',
                [meaning, grammar, wordId]
            );
            return res.json({ success: true, action: 'context_added', id: wordId });
        }

        // 4. New word — create word entry
        const result = await db.query(
            'INSERT INTO words (user_id, text, meaning, grammar, language, lookup_count, saved_at) VALUES (?, ?, ?, ?, ?, 1, NOW())',
            [req.user.id, text, meaning, grammar, language]
        );
        const newWordId = result.rows.insertId;

        // Create first context entry
        await db.query(
            'INSERT INTO word_contexts (word_id, context, url) VALUES (?, ?, ?)',
            [newWordId, context, url]
        );

        res.json({ success: true, action: 'created', id: newWordId });
    } catch (error) {
        console.error('DB Error:', error);
        sendError(res, 500, error.message);
    }
});

// Get words (with aggregated contexts)
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        const { limit, language } = req.query;

        let wordsQuery = 'SELECT id, text, meaning, grammar, language, lookup_count, saved_at FROM words WHERE user_id = ?';
        const wordsParams = [req.user.id];

        if (language) {
            wordsQuery += ' AND language = ?';
            wordsParams.push(language);
        }

        wordsQuery += ' ORDER BY saved_at DESC';

        if (limit) {
            wordsQuery += ' LIMIT ?';
            wordsParams.push(Number(limit));
        }

        const wordsResult = await db.query(wordsQuery, wordsParams);
        const words = wordsResult.rows;

        if (words.length === 0) {
            return res.json([]);
        }

        // Get all contexts for these words
        const wordIds = words.map(w => w.id);
        const contextsResult = await db.query(
            `SELECT id, word_id, context, url, created_at 
             FROM word_contexts 
             WHERE word_id IN (${wordIds.map(() => '?').join(',')})
             ORDER BY created_at DESC`,
            wordIds
        );

        // Group contexts by word_id
        const contextsByWordId = {};
        contextsResult.rows.forEach(ctx => {
            if (!contextsByWordId[ctx.word_id]) {
                contextsByWordId[ctx.word_id] = [];
            }
            contextsByWordId[ctx.word_id].push({
                id: ctx.id,
                context: ctx.context,
                url: ctx.url,
                created_at: ctx.created_at
            });
        });

        // Attach contexts to each word
        const wordsWithContexts = words.map(word => ({
            ...word,
            contexts: contextsByWordId[word.id] || []
        }));

        res.json(wordsWithContexts);
    } catch (error) {
        sendError(res, 500, error.message);
    }
});

// Delete word
router.delete('/:id', ensureAuthenticated, async (req, res) => {
    try {
        const result = await db.query('DELETE FROM words WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (result.rowCount > 0) res.json({ success: true });
        else res.status(404).json({ error: 'Word not found' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
