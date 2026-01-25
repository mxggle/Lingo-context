require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { getSystemInstruction, generatePrompt } = require('./prompts');
const db = require('./db');
const passport = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Session store options for MySQL
const sessionStoreOptions = {
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 minutes
    expiration: 30 * 24 * 60 * 60 * 1000, // 30 days
    createDatabaseTable: true
};
const sessionStore = new MySQLStore(sessionStoreOptions, db.pool);

// Initialize Database Schema
db.initializeDatabase();

// Middleware
app.use(cors({
    origin: true, // Allow all origins for extension (or configure specific chrome-extension:// origins)
    credentials: true // Important for cookies (sessions)
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Setup
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'keyboard cat',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: process.env.NODE_ENV === 'production', // true if https
        sameSite: 'lax' // 'none' if backend and frontend are on different domains (e.g. extension)
    }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Logic to calculate cost
function calculateCost(promptTokens, completionTokens, model) {
    const RATE_INPUT = 0.10;
    const RATE_OUTPUT = 0.40;
    const inputCost = (promptTokens / 1000000) * RATE_INPUT;
    const outputCost = (completionTokens / 1000000) * RATE_OUTPUT;
    return inputCost + outputCost;
}

// Auth Routes
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login_failed' }),
    (req, res) => {
        // Successful authentication
        // Redirect to a success page or close popup
        res.redirect('/auth/success');
        // Or if called from extension, maybe redirect to a custom protocol or just show a success message
    }
);

app.get('/auth/success', (req, res) => {
    res.send(`
        <html>
        <head><title>Login Success</title></head>
        <body>
            <h1>Login Successful</h1>
            <p>You can close this window and return to the extension.</p>
            <script>
                // Optional message to opener if needed
                // window.close();
            </script>
        </body>
        </html>
    `);
});

app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) return next(err);
        res.json({ success: true });
    });
});

app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ authenticated: true, user: req.user });
    } else {
        res.json({ authenticated: false });
    }
});

// Middleware to protect routes
const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized. Please login.' });
};

// User Preferences
app.patch('/api/user/preferences', ensureAuthenticated, async (req, res) => {
    const { targetLanguage } = req.body;

    if (!targetLanguage) {
        return res.status(400).json({ error: 'targetLanguage is required' });
    }

    try {
        await db.query(
            'UPDATE users SET target_language = ? WHERE id = ?',
            [targetLanguage, req.user.id]
        );

        // Update the session user object
        req.user.target_language = targetLanguage;

        res.json({ success: true, targetLanguage });
    } catch (error) {
        console.error('Failed to update user preferences:', error);
        res.status(500).json({ error: error.message });
    }
});

// API Endpoints

// 1. Analyze Text (AI Proxy) - Requires Auth? Maybe not strictly for basic generic use, but better if we want to track usage per user. 
// Let's require auth for now to "record user info" as requested.
app.post('/api/analyze', ensureAuthenticated, async (req, res) => {
    const { text, context, mode } = req.body;
    // Use user's preferred target language if not specified in request
    const targetLanguage = req.body.targetLanguage || req.user.target_language || 'English';
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Server configuration error: API Key missing' });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const systemInstruction = getSystemInstruction(targetLanguage);
    const prompt = generatePrompt(text, context, targetLanguage);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: systemInstruction + '\n\n' + prompt }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1024,
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Gemini API request failed');
        }

        const data = await response.json();

        // Extract Usage Metadata
        const usage = data.usageMetadata || {};
        const promptTokens = usage.promptTokenCount || 0;
        const completionTokens = usage.candidatesTokenCount || 0;
        const totalTokens = usage.totalTokenCount || 0;
        const cost = calculateCost(promptTokens, completionTokens, model);

        // Log Usage with User ID
        try {
            await db.query(
                'INSERT INTO usage_logs (user_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?)',
                [req.user.id, model, promptTokens, completionTokens, totalTokens, cost]
            );
        } catch (logError) {
            console.error('Failed to log usage:', logError);
            // Don't fail the request just because logging failed
        }

        // Extract Content
        const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!contentText) throw new Error('No content in response');

        // Parse JSON from content
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Invalid JSON format in response');

        const result = JSON.parse(jsonMatch[0]);
        if (result.source_language && !result.language) {
            result.language = result.source_language;
        }

        if (result.segments && Array.isArray(result.segments)) {
            result.furigana = result.segments.map(segment => {
                if (segment.reading && segment.reading !== segment.text) {
                    return `<ruby>${segment.text}<rt>${segment.reading}</rt></ruby>`;
                }
                return segment.text;
            }).join('');
        } else {
            result.furigana = result.text || text;
        }

        res.json(result);

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: true, message: error.message });
    }
});

// 2. Save Word
app.post('/api/words', ensureAuthenticated, async (req, res) => {
    const { text, meaning, grammar, context, language, url, savedAt } = req.body;
    try {
        // Convert ISO datetime to MySQL format (YYYY-MM-DD HH:MM:SS)
        const dateValue = savedAt ? new Date(savedAt) : new Date();
        const mysqlDateTime = dateValue.toISOString().slice(0, 19).replace('T', ' ');

        const result = await db.query(
            'INSERT INTO words (user_id, text, meaning, grammar, context, language, url, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, text, meaning, grammar, context, language, url, mysqlDateTime]
        );
        // MySQL returns insertId in the result
        res.json({ success: true, id: result.rows.insertId });
    } catch (error) {
        console.error('DB Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 3. Get Words
app.get('/api/words', ensureAuthenticated, async (req, res) => {
    try {
        const { limit, language } = req.query;
        let queryText = 'SELECT * FROM words WHERE user_id = ?';
        const params = [req.user.id];

        if (language) {
            queryText += ' AND language = ?';
            params.push(language);
        }

        queryText += ' ORDER BY saved_at DESC';

        if (limit) {
            queryText += ' LIMIT ?';
            params.push(Number(limit));
        }

        const result = await db.query(queryText, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Delete Word
app.delete('/api/words/:id', ensureAuthenticated, async (req, res) => {
    try {
        const result = await db.query('DELETE FROM words WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (result.rowCount > 0) res.json({ success: true });
        else res.status(404).json({ error: 'Word not found' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Get Stats
app.get('/api/stats', ensureAuthenticated, async (req, res) => {
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
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
