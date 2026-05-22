// Provider factory — returns the correct AI provider based on AI_PROVIDER env var

const geminiProvider = require('./gemini');
const openrouterProvider = require('./openrouter');
const codexProvider = require('./codex');
const deepseekProvider = require('./deepseek');

const providers = {
    gemini: geminiProvider,
    openrouter: openrouterProvider,
    codex: codexProvider,
    deepseek: deepseekProvider,
};

const ALLOWED_USER_PROVIDERS = new Set(['gemini', 'deepseek']);

/**
 * Get the active AI provider.
 * @param {string} [providerName] - Optional override; falls back to AI_PROVIDER env var then 'gemini'.
 *   Only 'gemini' and 'deepseek' are accepted as user-selectable providers.
 * @returns {object} Provider module with { callAPI, callStreamAPI, parseSSEData, PROVIDER_NAME }
 */
function getProvider(providerName) {
    const resolved = (
        (providerName && ALLOWED_USER_PROVIDERS.has(providerName.toLowerCase()) ? providerName : null) ||
        process.env.AI_PROVIDER ||
        'gemini'
    ).toLowerCase();

    const provider = providers[resolved];

    if (!provider) {
        throw new Error(`Unknown AI provider: "${resolved}". Supported: ${Object.keys(providers).join(', ')}`);
    }

    return provider;
}

module.exports = { getProvider };
