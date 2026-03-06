// Gemini AI Provider — handles Gemini-specific API format
// Supports both implicit caching (via `systemInstruction` field) and
// explicit caching (via CachedContent API for guaranteed savings).

const { fetchWithRetry } = require('../../fetchWithRetry');
const { logCacheMetrics } = require('../promptCacheManager');
const { getCacheName } = require('../geminiCacheService');

const PROVIDER_NAME = 'gemini';

/**
 * Build request URL and body for Gemini API.
 * Shared by both streaming and non-streaming calls.
 *
 * When `cachedContentName` is provided, skips `systemInstruction` and
 * uses the explicit cache reference instead (guaranteed cost savings).
 *
 * @param {string} systemInstruction - System instruction text
 * @param {string} prompt - User prompt text
 * @param {{ stream?: boolean, cachedContentName?: string }} options
 * @returns {{ url: string, body: object, model: string }}
 */
function buildRequest(systemInstruction, prompt, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw Object.assign(new Error('Server configuration error: API Key missing'), { status: 500 });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const isStream = !!options.stream;
    const action = isStream ? 'streamGenerateContent' : 'generateContent';
    const params = isStream ? `alt=sse&key=${apiKey}` : `key=${apiKey}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?${params}`;

    const body = {
        contents: [{
            role: 'user',
            parts: [{ text: prompt }]
        }],
        generationConfig: {
            temperature: 0.3,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 512,
        }
    };

    // Use explicit cache if available, otherwise fall back to systemInstruction
    if (options.cachedContentName) {
        body.cachedContent = options.cachedContentName;
        // NOTE: Do NOT include systemInstruction when using cachedContent
    } else {
        body.systemInstruction = {
            parts: [{ text: systemInstruction }]
        };
    }

    return { url, body, model };
}

/**
 * Extract normalized usage from Gemini's usageMetadata.
 */
function extractUsage(usageMeta, model) {
    const promptTokens = usageMeta.promptTokenCount || 0;
    const completionTokens = usageMeta.candidatesTokenCount || 0;
    const totalTokens = usageMeta.totalTokenCount || 0;

    // Log cache metrics via unified manager
    logCacheMetrics(PROVIDER_NAME, usageMeta);

    return { model, promptTokens, completionTokens, totalTokens };
}

/**
 * Non-streaming call to Gemini API.
 * Attempts to use explicit cache; falls back to implicit caching.
 * Returns { contentText, usage }
 */
async function callAPI(systemInstruction, prompt, options = {}) {
    // Try to get an explicit cache for this language
    const cachedContentName = await getCacheName(options.targetLanguage).catch(err => {
        console.warn('[ExplicitCache] getCacheName failed in callAPI:', err.message);
        return null;
    });
    if (cachedContentName) {
        console.log('[ExplicitCache] Using cache:', cachedContentName);
    }
    const { url, body, model } = buildRequest(systemInstruction, prompt, { cachedContentName });

    const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
    const usageMeta = data.usageMetadata || {};
    const usage = extractUsage(usageMeta, model);

    const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!contentText) throw new Error('No content in response');

    return { contentText, usage };
}

/**
 * Streaming call to Gemini API.
 * Attempts to use explicit cache; falls back to implicit caching.
 * Returns { response, model } — the raw fetch response for SSE processing.
 */
async function callStreamAPI(systemInstruction, prompt, options = {}) {
    // Try to get an explicit cache for this language
    const cachedContentName = await getCacheName(options.targetLanguage).catch(err => {
        console.warn('[ExplicitCache] getCacheName failed in callStreamAPI:', err.message);
        return null;
    });
    if (cachedContentName) {
        console.log('[ExplicitCache] Using cache:', cachedContentName);
    }
    const { url, body, model } = buildRequest(systemInstruction, prompt, {
        stream: true,
        cachedContentName,
    });

    const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errMsg = error.error?.message || 'Gemini API request failed';
        if (response.status === 429) {
            throw Object.assign(new Error('AI service is busy. Please try again in a few seconds.'), { status: 429 });
        }
        throw new Error(errMsg);
    }

    return { response, model };
}

/**
 * Parse a single SSE data line from Gemini's streaming response.
 * Returns { text, usage } or null if the line is not parseable.
 */
function parseSSEData(dataStr) {
    try {
        const parsed = JSON.parse(dataStr);
        let text = null;
        let usage = null;

        const usageMeta = parsed.usageMetadata;
        if (usageMeta) {
            usage = {
                promptTokens: usageMeta.promptTokenCount || 0,
                completionTokens: usageMeta.candidatesTokenCount || 0,
                totalTokens: usageMeta.totalTokenCount || 0
            };
            // Log cache metrics via unified manager
            logCacheMetrics(PROVIDER_NAME, usageMeta);
        }

        const candidates = parsed.candidates;
        if (candidates && candidates.length > 0) {
            text = candidates[0].content?.parts?.[0]?.text || null;
        }

        return { text, usage };
    } catch (e) {
        return null;
    }
}

module.exports = {
    PROVIDER_NAME,
    buildRequest,
    callAPI,
    callStreamAPI,
    parseSSEData
};
