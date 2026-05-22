const DEFAULT_OUTPUT_TOKEN_LIMIT = 2048;

function parsePositiveInteger(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getOutputTokenLimit(providerEnvName) {
    return parsePositiveInteger(process.env[providerEnvName]) ||
        parsePositiveInteger(process.env.AI_MAX_OUTPUT_TOKENS) ||
        DEFAULT_OUTPUT_TOKEN_LIMIT;
}

module.exports = { DEFAULT_OUTPUT_TOKEN_LIMIT, getOutputTokenLimit };
