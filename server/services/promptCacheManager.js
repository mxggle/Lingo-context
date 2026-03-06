// Prompt Cache Manager — unified, provider-agnostic cache metrics and config
//
// Each provider implements its own native caching strategy internally
// (Gemini: systemInstruction field, OpenAI/Codex: system message prefix).
// This module provides shared cache-hit logging and configuration.

/**
 * Read unified cache config from environment.
 * @returns {{ logHits: boolean }}
 */
function getCacheConfig() {
    return {
        logHits: process.env.PROMPT_CACHE_LOG_HITS !== 'false', // on by default
    };
}

/**
 * Provider-specific cache token extractors.
 * Each returns { cachedTokens, totalPromptTokens } from the provider's usage format.
 */
const extractors = {
    gemini(usage) {
        return {
            cachedTokens: usage.cachedContentTokenCount || 0,
            totalPromptTokens: usage.promptTokenCount || usage.promptTokens || 0,
        };
    },
    openrouter(usage) {
        // OpenRouter passes through underlying model's cache stats
        return {
            cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
            totalPromptTokens: usage.prompt_tokens || usage.promptTokens || 0,
        };
    },
    codex(usage) {
        // OpenAI-compatible format
        return {
            cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
            totalPromptTokens: usage.prompt_tokens || usage.promptTokens || 0,
        };
    },
};

// Cost rate per 1M tokens (standard vs cached)
const RATES = {
    gemini: { input: 0.10, cached: 0.025 },   // 75% discount on cached
    openrouter: { input: 0.10, cached: 0.05 },     // ~50% discount
    codex: { input: 0.10, cached: 0.05 },      // ~50% discount
};

/**
 * Log cache metrics from a provider's response usage data.
 * Call this after every API response to surface cache hits uniformly.
 *
 * @param {string} providerName - 'gemini' | 'openrouter' | 'codex'
 * @param {object} rawUsage     - Raw usage object from the provider's response
 */
function logCacheMetrics(providerName, rawUsage) {
    if (!rawUsage) return;

    const config = getCacheConfig();
    if (!config.logHits) return;

    const extractor = extractors[providerName];
    if (!extractor) return;

    const { cachedTokens, totalPromptTokens } = extractor(rawUsage);

    if (cachedTokens > 0) {
        const rates = RATES[providerName] || RATES.gemini;
        const savings = (cachedTokens / 1_000_000) * (rates.input - rates.cached);
        const pct = totalPromptTokens > 0 ? Math.round((cachedTokens / totalPromptTokens) * 100) : 0;
        console.log(
            `[Cache] ${providerName}: ${cachedTokens}/${totalPromptTokens} prompt tokens cached (${pct}%, saved ~$${savings.toFixed(6)})`
        );
    } else if (totalPromptTokens > 0) {
        console.log(
            `[Cache] ${providerName}: 0/${totalPromptTokens} prompt tokens cached (no cache hit)`
        );
    }
}

module.exports = { getCacheConfig, logCacheMetrics };
