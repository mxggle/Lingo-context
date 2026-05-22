// AI Service — provider-agnostic text analysis with caching

const { getSystemInstruction, generatePrompt, normalizePromptContext } = require('../prompts');
const { getProvider } = require('./providers');
const { normalizeTargetLanguage, shouldRetryForLanguageMismatch } = require('../targetLanguage');
const { normalizeAnalysisResult } = require('./normalizeAnalysisResult');

// ── In-memory result cache ─────────────────────────────────────────────────
// Caches the last CACHE_MAX_SIZE unique (text, context, targetLanguage) lookups
// for CACHE_TTL_MS to avoid re-hitting the AI provider for repeat selections.
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _cache = new Map();

function _cacheKey(text, context, targetLanguage) {
    const trimmedContext = normalizePromptContext(context);
    return `${targetLanguage}:${text}:${trimmedContext}`;
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

// Cost calculation (rates per 1M tokens — Gemini Flash default rates)
function calculateCost(promptTokens, completionTokens) {
    const RATE_INPUT = 0.10;
    const RATE_OUTPUT = 0.40;
    const inputCost = (promptTokens / 1000000) * RATE_INPUT;
    const outputCost = (completionTokens / 1000000) * RATE_OUTPUT;
    return inputCost + outputCost;
}

// Call AI provider and return parsed result (cache-aware)
async function analyzeText({ text, context, targetLanguage, aiProvider }) {
    const normalizedTargetLanguage = normalizeTargetLanguage(targetLanguage).name;
    const cacheKey = _cacheKey(text, context, normalizedTargetLanguage);
    const cached = _cacheGet(cacheKey);
    if (cached) {
        console.log(`[AI] Cache HIT for "${text.slice(0, 40)}" (lang: ${normalizedTargetLanguage})`);
        return cached;
    }

    const provider = getProvider(aiProvider);
    const prompt = generatePrompt(text, context, normalizedTargetLanguage);
    let result;
    let usage;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const systemInstruction = getSystemInstruction(normalizedTargetLanguage, {
            strictLanguageOnly: attempt > 0
        });

        const callTime = new Date().toISOString();
        const startMs = Date.now();
        console.log(`[AI] ▶ Calling provider (attempt ${attempt + 1}) | lang: ${normalizedTargetLanguage} | time: ${callTime}`);
        console.log(`[AI]   selection: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`); 

        const response = await provider.callAPI(systemInstruction, prompt, {
            targetLanguage: normalizedTargetLanguage
        });
        const elapsedMs = Date.now() - startMs;
        usage = response.usage;

        const modelName = usage?.model || provider.name || 'unknown';
        console.log(`[AI] ✔ Response received | model: ${modelName} | elapsed: ${elapsedMs}ms | tokens: ${usage?.totalTokens ?? '?'} (prompt: ${usage?.promptTokens ?? '?'}, completion: ${usage?.completionTokens ?? '?'})`);

        const jsonMatch = response.contentText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Invalid JSON format in response');

        result = normalizeAnalysisResult(JSON.parse(jsonMatch[0]), text);

        if (!shouldRetryForLanguageMismatch(result, normalizedTargetLanguage) || attempt > 0) {
            break;
        }
        console.log(`[AI] ↩ Language mismatch detected, retrying with strict mode…`);
    }

    const cost = calculateCost(usage.promptTokens, usage.completionTokens);
    const response2 = {
        result,
        usage: { ...usage, cost }
    };
    _cacheSet(cacheKey, response2);
    return response2;
}

module.exports = { analyzeText, calculateCost, _clearCacheForTesting: () => _cache.clear() };
