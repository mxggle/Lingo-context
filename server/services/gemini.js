// Gemini AI service — encapsulates all AI interaction logic

const { getSystemInstruction, generatePrompt } = require('../prompts');
const { fetchWithRetry } = require('../fetchWithRetry');
const { sendError } = require('../middleware/errorHandler');

// ── In-memory result cache ─────────────────────────────────────────────────
// Caches the last CACHE_MAX_SIZE unique (text, context, targetLanguage) lookups
// for CACHE_TTL_MS to avoid re-hitting Gemini for repeat selections.
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _cache = new Map();

function _cacheKey(text, context, targetLanguage) {
    return `${targetLanguage}:${text}:${String(context)}`;
}

function _cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        _cache.delete(key);
        return null;
    }
    return entry.value;
}

function _cacheSet(key, value) {
    // Evict oldest entry when at capacity
    if (_cache.size >= CACHE_MAX_SIZE) {
        _cache.delete(_cache.keys().next().value);
    }
    _cache.set(key, { value, ts: Date.now() });
}

// Cost calculation (rates per 1M tokens for Gemini Flash)
function calculateCost(promptTokens, completionTokens) {
    const RATE_INPUT = 0.10;
    const RATE_OUTPUT = 0.40;
    const inputCost = (promptTokens / 1000000) * RATE_INPUT;
    const outputCost = (completionTokens / 1000000) * RATE_OUTPUT;
    return inputCost + outputCost;
}

// Call Gemini API and return parsed result (cache-aware)
async function analyzeText({ text, context, targetLanguage }) {
    const cacheKey = _cacheKey(text, context, targetLanguage);
    const cached = _cacheGet(cacheKey);
    if (cached) return cached;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw Object.assign(new Error('Server configuration error: API Key missing'), { status: 500 });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const systemInstruction = getSystemInstruction(targetLanguage);
    const prompt = generatePrompt(text, context, targetLanguage);

    const response = await fetchWithRetry(apiUrl, {
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
                maxOutputTokens: 512,
            }
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errMsg = error.error?.message || 'Gemini API request failed';
        if (response.status === 429) {
            throw Object.assign(new Error('AI service is busy. Please try again in a few seconds.'), { status: 429 });
        }
        throw new Error(errMsg);
    }

    const data = await response.json();

    // Extract usage metadata
    const usage = data.usageMetadata || {};
    const promptTokens = usage.promptTokenCount || 0;
    const completionTokens = usage.candidatesTokenCount || 0;
    const totalTokens = usage.totalTokenCount || 0;
    const cost = calculateCost(promptTokens, completionTokens);

    // Extract content
    const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!contentText) throw new Error('No content in response');

    // Parse JSON from content
    const jsonMatch = contentText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid JSON format in response');

    const result = JSON.parse(jsonMatch[0]);
    if (result.source_language && !result.language) {
        result.language = result.source_language;
    }

    // Furigana reconstruction for Japanese
    const isJapanese = result.language === 'ja' || result.source_language === 'ja';
    const hasReadings = result.segments && Array.isArray(result.segments) &&
        result.segments.some(s => s.reading && s.reading !== s.text);

    if (isJapanese && hasReadings) {
        result.furigana = result.segments.map(segment => {
            if (segment.reading && segment.reading !== segment.text) {
                return `<ruby>${segment.text}<rt>${segment.reading}</rt></ruby>`;
            }
            return segment.text;
        }).join('');
    } else {
        result.furigana = text;
    }

    const response2 = {
        result,
        usage: { model, promptTokens, completionTokens, totalTokens, cost }
    };
    _cacheSet(cacheKey, response2);
    return response2;
}

module.exports = { analyzeText, calculateCost, _clearCacheForTesting: () => _cache.clear() };
