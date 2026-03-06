// OpenRouter AI Provider — OpenAI-compatible API format

const { fetchWithRetry } = require('../../fetchWithRetry');
const { logCacheMetrics } = require('../promptCacheManager');

const PROVIDER_NAME = 'openrouter';
const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Build the common request body for OpenRouter (OpenAI-compatible format).
 */
function buildRequestBody(systemInstruction, prompt, options = {}) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        throw Object.assign(new Error('Server configuration error: OpenRouter API Key missing'), { status: 500 });
    }

    const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';

    const body = {
        model,
        messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        top_p: 0.95,
        max_tokens: 512,
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };

    return { body, headers, model };
}

/**
 * Non-streaming call to OpenRouter API.
 * Returns { contentText, usage }
 */
async function callAPI(systemInstruction, prompt, options = {}) {
    const { body, headers, model } = buildRequestBody(systemInstruction, prompt, options);

    const response = await fetchWithRetry(BASE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errMsg = error.error?.message || 'OpenRouter API request failed';
        if (response.status === 429) {
            throw Object.assign(new Error('AI service is busy. Please try again in a few seconds.'), { status: 429 });
        }
        throw new Error(errMsg);
    }

    const data = await response.json();

    const usage = data.usage || {};
    logCacheMetrics(PROVIDER_NAME, usage);

    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

    const contentText = data.choices?.[0]?.message?.content;
    if (!contentText) throw new Error('No content in response');

    return {
        contentText,
        usage: { model, promptTokens, completionTokens, totalTokens }
    };
}

/**
 * Streaming call to OpenRouter API.
 * Returns { response, model } — the raw fetch response for SSE processing.
 */
async function callStreamAPI(systemInstruction, prompt, options = {}) {
    const { body, headers, model } = buildRequestBody(systemInstruction, prompt, options);

    body.stream = true;

    const response = await fetchWithRetry(BASE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errMsg = error.error?.message || 'OpenRouter API request failed';
        if (response.status === 429) {
            throw Object.assign(new Error('AI service is busy. Please try again in a few seconds.'), { status: 429 });
        }
        throw new Error(errMsg);
    }

    return { response, model };
}

/**
 * Parse a single SSE data line from OpenRouter's streaming response.
 * Returns { text, usage } or null if the line is not parseable.
 * Handles [DONE] marker and ignores comment lines (: OPENROUTER PROCESSING).
 */
function parseSSEData(dataStr) {
    if (dataStr === '[DONE]') return null;

    try {
        const parsed = JSON.parse(dataStr);
        let text = null;
        let usage = null;

        // Extract streamed text from delta
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
            text = delta.content;
        }

        // Final chunk may include usage stats
        if (parsed.usage) {
            logCacheMetrics(PROVIDER_NAME, parsed.usage);
            usage = {
                promptTokens: parsed.usage.prompt_tokens || 0,
                completionTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0
            };
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
