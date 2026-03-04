// OpenAI Codex CLI OAuth Provider — Local deployment only
// Reference: https://developers.openai.com/codex/auth/

const { fetchWithRetry } = require('../../fetchWithRetry');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROVIDER_NAME = 'codex';
// Use ChatGPT backend endpoint for subscription-based access (not API billing)
const BASE_URL = process.env.CHATGPT_API_URL || 'https://api.openai.com/v1/chat/completions';
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const AUTH_FILE = path.join(CODEX_HOME, 'auth.json');

/**
 * Get cached auth token from Codex CLI auth file.
 * Codex CLI caches login details at ~/.codex/auth.json
 * @returns {string|null} Access token or null if not found
 */
function getCachedAuthToken() {
    try {
        if (!fs.existsSync(AUTH_FILE)) {
            console.warn(`Codex auth file not found at ${AUTH_FILE}`);
            return null;
        }

        const authData = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
        
        // Codex CLI stores tokens in different formats depending on version/login method
        
        // New format: tokens.access_token (Codex CLI v0.4+)
        if (authData.tokens?.access_token) {
            return authData.tokens.access_token;
        }
        
        // Direct access_token (older format)
        if (authData.access_token) {
            return authData.access_token;
        }
        
        // ChatGPT login format
        if (authData.chatgpt?.access_token) {
            return authData.chatgpt.access_token;
        }
        
        // API key format
        if (authData.api_key) {
            return authData.api_key;
        }
        
        // OPENAI_API_KEY in auth file
        if (authData.OPENAI_API_KEY) {
            return authData.OPENAI_API_KEY;
        }

        console.warn('No valid token found in Codex auth file');
        return null;
    } catch (err) {
        console.error('Error reading Codex auth file:', err.message);
        return null;
    }
}

/**
 * Get authentication token - checks env var first, then cached file.
 * @returns {string} Access token
 * @throws {Error} If no token is available
 */
function getAuthToken() {
    // Priority 1: Environment variable (for CI/CD or explicit config)
    if (process.env.OPENAI_API_KEY) {
        return process.env.OPENAI_API_KEY;
    }

    // Priority 2: Cached token from Codex CLI
    const cachedToken = getCachedAuthToken();
    if (cachedToken) {
        return cachedToken;
    }

    throw Object.assign(
        new Error('Codex authentication required. Please run "codex login" or set OPENAI_API_KEY environment variable.'),
        { status: 401 }
    );
}

/**
 * Build the common request body for OpenAI API (OpenAI-compatible format).
 */
function buildRequestBody(systemInstruction, prompt, options = {}) {
    const token = getAuthToken();
    const model = process.env.CODEX_MODEL || 'codex';

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
        'Authorization': `Bearer ${token}`,
    };

    // Add OpenAI organization header if available
    if (process.env.OPENAI_ORGANIZATION) {
        headers['OpenAI-Organization'] = process.env.OPENAI_ORGANIZATION;
    }

    // Add OpenAI project header if available
    if (process.env.OPENAI_PROJECT) {
        headers['OpenAI-Project'] = process.env.OPENAI_PROJECT;
    }

    return { body, headers, model };
}

/**
 * Non-streaming call to OpenAI API.
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
        const errMsg = error.error?.message || 'OpenAI API request failed';
        if (response.status === 429) {
            throw Object.assign(new Error('AI service is busy. Please try again in a few seconds.'), { status: 429 });
        }
        if (response.status === 401) {
            throw Object.assign(new Error('Codex authentication failed. Please run "codex login" again.'), { status: 401 });
        }
        throw new Error(errMsg);
    }

    const data = await response.json();

    const usage = data.usage || {};
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
 * Streaming call to OpenAI API.
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
        const errMsg = error.error?.message || 'OpenAI API request failed';
        if (response.status === 429) {
            throw Object.assign(new Error('AI service is busy. Please try again in a few seconds.'), { status: 429 });
        }
        if (response.status === 401) {
            throw Object.assign(new Error('Codex authentication failed. Please run "codex login" again.'), { status: 401 });
        }
        throw new Error(errMsg);
    }

    return { response, model };
}

/**
 * Parse a single SSE data line from OpenAI's streaming response.
 * Returns { text, usage } or null if the line is not parseable.
 * Handles [DONE] marker.
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

/**
 * Check if Codex provider is properly configured.
 * @returns {boolean} True if auth token is available
 */
function isConfigured() {
    try {
        const token = getAuthToken();
        return !!token;
    } catch (err) {
        return false;
    }
}

module.exports = {
    PROVIDER_NAME,
    callAPI,
    callStreamAPI,
    parseSSEData,
    isConfigured,
    getCachedAuthToken,
    getAuthToken
};
