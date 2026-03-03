// Gemini AI Provider — handles Gemini-specific API format

const { fetchWithRetry } = require('../../fetchWithRetry');

const PROVIDER_NAME = 'gemini';

/**
 * Build request config for Gemini's generateContent API.
 */
function buildRequest(systemInstruction, prompt, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw Object.assign(new Error('Server configuration error: API Key missing'), { status: 500 });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
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
    };

    return { url, body, model };
}

/**
 * Non-streaming call to Gemini API.
 * Returns { contentText, usage }
 */
async function callAPI(systemInstruction, prompt, options = {}) {
    const { url, body, model } = buildRequest(systemInstruction, prompt, options);

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
    const promptTokens = usageMeta.promptTokenCount || 0;
    const completionTokens = usageMeta.candidatesTokenCount || 0;
    const totalTokens = usageMeta.totalTokenCount || 0;

    const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!contentText) throw new Error('No content in response');

    return {
        contentText,
        usage: { model, promptTokens, completionTokens, totalTokens }
    };
}

/**
 * Streaming call to Gemini API.
 * Returns { response, model } — the raw fetch response for SSE processing.
 */
async function callStreamAPI(systemInstruction, prompt, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw Object.assign(new Error('Server configuration error: API Key missing'), { status: 500 });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const body = {
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
    };

    const response = await fetchWithRetry(streamUrl, {
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
    callAPI,
    callStreamAPI,
    parseSSEData
};
