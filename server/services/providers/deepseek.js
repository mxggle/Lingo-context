// DeepSeek AI Provider — OpenAI-compatible API format
// Docs: https://api-docs.deepseek.com/
// Base URL: https://api.deepseek.com
// Compatible with OpenAI ChatCompletions format.
//
// Available models (as of 2026-04):
//   deepseek-v4-pro   — high performance, complex reasoning, coding, agent tasks
//   deepseek-v4-flash — low latency, cost-effective, broad production use
//   (Legacy: deepseek-chat, deepseek-reasoner — deprecated 2026-07-24)

const { fetchWithRetry } = require('../../fetchWithRetry');
const { logCacheMetrics } = require('../promptCacheManager');
const { getOutputTokenLimit } = require('../outputTokenLimit');

const PROVIDER_NAME = 'deepseek';
const BASE_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';

/**
 * Build the common request body for DeepSeek (OpenAI-compatible format).
 */
function buildRequestBody(systemInstruction, prompt, options = {}) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        throw Object.assign(
            new Error('Server configuration error: DeepSeek API Key missing'),
            { status: 500 }
        );
    }

    const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;

    const body = {
        model,
        messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        top_p: 0.95,
        max_tokens: options.maxOutputTokens || getOutputTokenLimit('DEEPSEEK_MAX_TOKENS'),
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };

    return { body, headers, model };
}

/**
 * Non-streaming call to DeepSeek API.
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
        const errMsg = error.error?.message || 'DeepSeek API request failed';
        if (response.status === 429) {
            throw Object.assign(
                new Error('AI service is busy. Please try again in a few seconds.'),
                { status: 429 }
            );
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
    if (!contentText) throw new Error('No content in DeepSeek response');

    return {
        contentText,
        usage: { model, promptTokens, completionTokens, totalTokens }
    };
}

/**
 * Streaming call to DeepSeek API.
 * Returns { response, model } — the raw fetch response for SSE processing.
 */
async function callStreamAPI(systemInstruction, prompt, options = {}) {
    const { body, headers, model } = buildRequestBody(systemInstruction, prompt, options);

    body.stream = true;
    // Request usage stats in the final stream chunk
    body.stream_options = { include_usage: true };

    const response = await fetchWithRetry(BASE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errMsg = error.error?.message || 'DeepSeek API request failed';
        console.error(`[DeepSeek] Stream request failed (HTTP ${response.status}):`, errMsg);
        if (response.status === 429) {
            throw Object.assign(
                new Error('AI service is busy. Please try again in a few seconds.'),
                { status: 429 }
            );
        }
        throw new Error(errMsg);
    }

    console.log(`[DeepSeek] Stream response OK (HTTP ${response.status}) | model: ${model}`);
    return { response, model };
}

/**
 * Parse a single SSE data line from DeepSeek's streaming response.
 * DeepSeek uses the same SSE format as OpenAI ChatCompletions.
 * Returns { text, usage } or null if the line is not parseable.
 */
function parseSSEData(dataStr) {
    if (dataStr === '[DONE]') return null;

    try {
        const parsed = JSON.parse(dataStr);
        let text = null;
        let usage = null;
        let finishReason = null;

        // Extract streamed text from delta (content is OpenAI standard; text is used by some models)
        const delta = parsed.choices?.[0]?.delta;
        finishReason = parsed.choices?.[0]?.finish_reason || null;
        if (delta?.content) {
            text = delta.content;
        } else if (delta?.text) {
            text = delta.text;
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

        return { text, usage, ...(finishReason ? { finishReason } : {}) };
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
