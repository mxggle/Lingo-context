// Provider factory — returns the correct AI provider based on AI_PROVIDER env var

const geminiProvider = require('./gemini');
const openrouterProvider = require('./openrouter');
const codexProvider = require('./codex');

const providers = {
    gemini: geminiProvider,
    openrouter: openrouterProvider,
    codex: codexProvider,
};

/**
 * Get the active AI provider based on the AI_PROVIDER environment variable.
 * Defaults to 'gemini' if not set.
 * @returns {object} Provider module with { callAPI, callStreamAPI, parseSSEData, PROVIDER_NAME }
 */
function getProvider() {
    const providerName = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
    const provider = providers[providerName];

    if (!provider) {
        throw new Error(`Unknown AI provider: "${providerName}". Supported: ${Object.keys(providers).join(', ')}`);
    }

    return provider;
}

module.exports = { getProvider };
