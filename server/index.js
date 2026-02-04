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
const path = require('path');
app.set('trust proxy', 1); // Trust first proxy (Vercel)
const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Explicit route for clean /privacy URL
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

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

// Serve static files from public directory
app.use(express.static('public'));

// Middleware
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [
        'http://localhost:3000',
        'https://lingo-context-api.vercel.app'
    ];

// Helper to check if origin is allowed
const isAllowedOrigin = (origin) => {
    if (!origin) return false;
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    // For development/flexibility, we currently allow any chrome-extension.
    // IN PRODUCTION: Replace this with strict ID checking (commented reference above)
    return origin.startsWith('chrome-extension://');
};

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (isAllowedOrigin(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// CSRF Protection Middleware for mutating requests
app.use((req, res, next) => {
    // Skip for non-mutating methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // effectiveOrigin is the origin we validate against
    let effectiveOrigin = origin;
    if (!effectiveOrigin && referer) {
        try {
            effectiveOrigin = new URL(referer).origin;
        } catch (e) {
            // Invalid referer URL
        }
    }

    if (effectiveOrigin && isAllowedOrigin(effectiveOrigin)) {
        return next();
    }

    console.warn(`Blocked CSRF attempt from: Origin=${origin}, Referer=${referer}`);
    return res.status(403).json({ error: 'CSRF Check Failed: Origin not allowed' });
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to ensure cookies are sent as Secure on localhost (required for SameSite=None)
app.use((req, res, next) => {
    if (process.env.NODE_ENV !== 'production' && !req.secure) {
        // Trick express-session into thinking we are secure so it sends the Secure cookie
        Object.defineProperty(req, 'secure', { value: true, writable: false });
        // Or if that fails (as it's a getter), trust proxy logic:
        req.headers['x-forwarded-proto'] = 'https';
    }
    next();
});

// Session Setup
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'keyboard cat',
    resave: false,
    saveUninitialized: false,
    proxy: true, // Required for trust proxy headers to work
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: true, // Always true for SameSite=None
        sameSite: 'none' // Required for cross-site fetch
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
    // Get user data if authenticated
    const user = req.isAuthenticated() ? req.user : null;
    const userData = user ? JSON.stringify({
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url
    }) : 'null';

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Login Successful | LingoContext</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                :root {
                    --primary: #6366f1;
                    --primary-dark: #4f46e5;
                    --bg: #0f172a;
                    --text: #f8fafc;
                }
                body {
                    margin: 0;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    background-color: var(--bg);
                    background-image: 
                        radial-gradient(circle at 0% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
                        radial-gradient(circle at 100% 100%, rgba(79, 70, 229, 0.1) 0%, transparent 50%);
                    font-family: 'Inter', sans-serif;
                    color: var(--text);
                    overflow: hidden;
                }
                .container {
                    text-align: center;
                    padding: 3rem;
                    background: rgba(30, 41, 59, 0.7);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 24px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    max-width: 420px;
                    width: 90%;
                    animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .icon-wrapper {
                    width: 80px;
                    height: 80px;
                    background: rgba(99, 102, 241, 0.2);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 2rem;
                    position: relative;
                }
                .icon-wrapper::after {
                    content: '';
                    position: absolute;
                    inset: -4px;
                    border: 2px solid var(--primary);
                    border-radius: 50%;
                    opacity: 0.3;
                    animation: pulse 2s infinite;
                }
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 0.3; }
                    50% { transform: scale(1.1); opacity: 0.1; }
                    100% { transform: scale(1); opacity: 0.3; }
                }
                .checkmark {
                    width: 40px;
                    height: 40px;
                    stroke: var(--primary);
                    stroke-width: 4;
                    stroke-linecap: round;
                    stroke-linejoin: round;
                    fill: none;
                    stroke-dasharray: 60;
                    stroke-dashoffset: 60;
                    animation: draw 0.6s ease-out 0.4s forwards;
                }
                @keyframes draw {
                    to { stroke-dashoffset: 0; }
                }
                h1 {
                    font-size: 2rem;
                    font-weight: 700;
                    margin: 0 0 1rem;
                    background: linear-gradient(to bottom right, #fff, #94a3b8);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                p {
                    color: #94a3b8;
                    line-height: 1.6;
                    margin: 0 0 2rem;
                    font-size: 1.1rem;
                }
                .close-hint {
                    font-size: 0.875rem;
                    color: #64748b;
                    padding: 0.75rem 1.5rem;
                    background: rgba(15, 23, 42, 0.4);
                    border-radius: 12px;
                    display: inline-block;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                }
            </style>
        </head>
        <body>
            <!-- User data for extension to pick up -->
            <div id="lingocontext-auth-data" data-user='${userData.replace(/'/g, "&#39;")}'></div>
            
            <div class="container">
                <div class="icon-wrapper">
                    <svg class="checkmark" viewBox="0 0 52 52">
                        <path d="M14 27l7.5 7.5L38 18"></path>
                    </svg>
                </div>
                <h1>Welcome Back!</h1>
                <p>Login successful. You can now return to the extension to start learning.</p>
                <div class="close-hint">
                    You can safely close this window now
                </div>
            </div>
            <script>
                // Optional: auto-close window after a delay
                // setTimeout(() => window.close(), 5000);
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

        // Determine if we should use the original text or reconstructed furigana
        const isJapanese = result.language === 'ja' || result.source_language === 'ja';
        const hasReadings = result.segments && Array.isArray(result.segments) &&
            result.segments.some(s => s.reading && s.reading !== s.text);

        if (isJapanese && hasReadings) {
            // Only reconstruct for Japanese with furigana to show
            result.furigana = result.segments.map(segment => {
                if (segment.reading && segment.reading !== segment.text) {
                    return `<ruby>${segment.text}<rt>${segment.reading}</rt></ruby>`;
                }
                return segment.text;
            }).join('');
        } else {
            // For English and all other cases, keep the original selection exactly as-is
            // This ensures spaces and punctuation are perfectly preserved
            result.furigana = text;
        }

        res.json(result);

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: true, message: error.message });
    }
});

// 2. Save Word (with deduplication and multi-context support)
app.post('/api/words', ensureAuthenticated, async (req, res) => {
    const { text, meaning, grammar, context, language, url } = req.body;
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
                // Exact duplicate - just lift order and increment lookup count
                await db.query(
                    'UPDATE words SET saved_at = NOW(), lookup_count = lookup_count + 1 WHERE id = ?',
                    [wordId]
                );
                return res.json({ success: true, action: 'lifted', id: wordId });
            }

            // 3. Same word, different context - add new context
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

        // 4. New word - create word entry
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
        res.status(500).json({ error: error.message });
    }
});

// 3. Get Words (with aggregated contexts)
app.get('/api/words', ensureAuthenticated, async (req, res) => {
    try {
        const { limit, language } = req.query;

        // First, get the words
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

// Only start the server if this file is run directly (local development)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Backend server running on http://localhost:${PORT}`);
    });
}

// Export the app for Vercel
module.exports = app;
