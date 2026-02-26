const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/**
 * Fetch wrapper with exponential backoff retry.
 * Follows Google Cloud retry strategy best practices:
 * https://cloud.google.com/vertex-ai/generative-ai/docs/retry-strategy
 *
 * @param {string} url - The URL to fetch
 * @param {object} options - Standard fetch options
 * @param {object} retryOptions - Retry configuration
 * @param {number} retryOptions.maxRetries - Max retry attempts (default: 4)
 * @param {number} retryOptions.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} retryOptions.backoffMultiplier - Delay multiplier per retry (default: 2)
 * @param {number} retryOptions.maxDelay - Maximum delay cap in ms (default: 60000)
 * @param {number[]} retryOptions.retryableStatusCodes - HTTP codes to retry on
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, {
    maxRetries = 4,
    initialDelay = 1000,
    backoffMultiplier = 2,
    maxDelay = 60000,
    retryableStatusCodes = [429, 408, 500, 502, 503, 504],
    // Allow injecting fetch for testing
    _fetch = fetch
} = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await _fetch(url, options);
            if (response.ok || !retryableStatusCodes.includes(response.status)) {
                return response;
            }
            // Retryable status code — save for potential rethrow
            lastError = { status: response.status, response };
            if (attempt < maxRetries) {
                const jitter = Math.random() * 1000;
                const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt) + jitter, maxDelay);
                console.warn(`[Retry] Gemini API returned ${response.status}. Attempt ${attempt + 1}/${maxRetries}, retrying in ${(delay / 1000).toFixed(1)}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        } catch (networkError) {
            lastError = { status: null, error: networkError };
            if (attempt < maxRetries) {
                const jitter = Math.random() * 1000;
                const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt) + jitter, maxDelay);
                console.warn(`[Retry] Network error: ${networkError.message}. Attempt ${attempt + 1}/${maxRetries}, retrying in ${(delay / 1000).toFixed(1)}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    // All retries exhausted
    if (lastError.response) return lastError.response;
    throw lastError.error;
}

module.exports = { fetchWithRetry };
