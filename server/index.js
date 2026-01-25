require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { SYSTEM_INSTRUCTION, generatePrompt } = require('./prompts');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database('database.sqlite');

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    meaning TEXT,
    grammar TEXT,
    context TEXT,
    language TEXT,
    url TEXT,
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    model TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    cost_usd REAL
  );
`);

// Logic to calculate cost (approximate for Gemini 2.0 Flash Lite/Gemini 1.5 Flash)
// Pricing (Example for Flash):
// Input: $0.075 / 1M tokens (prompts <= 128k)
// Output: $0.30 / 1M tokens
function calculateCost(promptTokens, completionTokens, model) {
    // Pricing rates (per 1M tokens) - Adjust as needed
    const RATE_INPUT = 0.10;
    const RATE_OUTPUT = 0.40;

    const inputCost = (promptTokens / 1000000) * RATE_INPUT;
    const outputCost = (completionTokens / 1000000) * RATE_OUTPUT;
    return inputCost + outputCost;
}

// API Endpoints

// 1. Analyze Text (AI Proxy)
app.post('/api/analyze', async (req, res) => {
    const { text, context, mode, targetLanguage } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Server configuration error: API Key missing' });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const systemInstruction = SYSTEM_INSTRUCTION;

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

        // Log Usage
        const stmt = db.prepare(`
            INSERT INTO usage_logs (model, prompt_tokens, completion_tokens, total_tokens, cost_usd)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(model, promptTokens, completionTokens, totalTokens, cost);

        // Extract Content
        const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!contentText) throw new Error('No content in response');

        // Parse JSON from content
        const jsonMatch = contentText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Invalid JSON format in response');

        const result = JSON.parse(jsonMatch[0]);
        // Map source_language to language for compatibility
        if (result.source_language && !result.language) {
            result.language = result.source_language;
        }

        // Construct furigana HTML from segments
        if (result.segments && Array.isArray(result.segments)) {
            result.furigana = result.segments.map(segment => {
                if (segment.reading && segment.reading !== segment.text) {
                    return `<ruby>${segment.text}<rt>${segment.reading}</rt></ruby>`;
                }
                return segment.text;
            }).join('');
        } else {
            // Fallback if segments missing (shouldn't happen with strict prompt, but safe to keep)
            result.furigana = result.text || text;
        }

        res.json(result);

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: true, message: error.message });
    }
});

// 2. Save Word
app.post('/api/words', (req, res) => {
    const { text, meaning, grammar, context, language, url, savedAt } = req.body;
    try {
        const stmt = db.prepare(`
            INSERT INTO words (text, meaning, grammar, context, language, url, saved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(text, meaning, grammar, context, language, url, savedAt || new Date().toISOString());
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (error) {
        console.error('DB Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 3. Get Words
app.get('/api/words', (req, res) => {
    try {
        const { limit, language } = req.query;
        let query = 'SELECT * FROM words ORDER BY saved_at DESC';
        const params = [];

        if (language) {
            query = 'SELECT * FROM words WHERE language = ? ORDER BY saved_at DESC';
            params.push(language);
        }

        if (limit) {
            query += ' LIMIT ?';
            params.push(Number(limit));
        }

        const stmt = db.prepare(query);
        const words = stmt.all(...params);
        res.json(words);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Delete Word
app.delete('/api/words/:id', (req, res) => {
    try {
        const stmt = db.prepare('DELETE FROM words WHERE id = ?');
        const info = stmt.run(req.params.id);
        if (info.changes > 0) res.json({ success: true });
        else res.status(404).json({ error: 'Word not found' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Get Stats
app.get('/api/stats', (req, res) => {
    try {
        const usageStmt = db.prepare(`
            SELECT 
                COUNT(*) as total_requests,
                SUM(total_tokens) as total_tokens,
                SUM(cost_usd) as total_cost
            FROM usage_logs
        `);
        const usage = usageStmt.get();

        const wordsStmt = db.prepare('SELECT COUNT(*) as saved_words FROM words');
        const words = wordsStmt.get();

        res.json({
            usage: usage,
            storage: words
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
