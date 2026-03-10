// Gemini Explicit Cache Service
// Creates and manages CachedContent resources via the Gemini REST API.
// Caches the system instruction per target language so all subsequent
// requests for the same language reuse the pre-computed embeddings.
//
// REST Reference: POST /v1beta/cachedContents
// Usage: when calling generateContent, pass { cachedContent: cacheName }
//        instead of { systemInstruction: ... }

const { getSystemInstruction } = require('../prompts');

const CACHE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// In-memory store: targetLanguage -> { name, expireTime, model }
const _caches = new Map();

// Default TTL for explicit caches (1 hour)
const DEFAULT_TTL_SECONDS = 3600;
// Refresh threshold: refresh cache if it expires within this window
const REFRESH_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes before expiry

/**
 * Create a new CachedContent resource on the Gemini API.
 *
 * @param {string} targetLanguage - Target language for the system instruction
 * @returns {Promise<{ name: string, expireTime: string, model: string } | null>}
 */
async function createCache(targetLanguage) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('[ExplicitCache] No GEMINI_API_KEY, skipping cache creation');
        return null;
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const systemInstruction = getSystemInstruction(targetLanguage);
    const ttl = parseInt(process.env.GEMINI_CACHE_TTL) || DEFAULT_TTL_SECONDS;

    const requestBody = {
        model: `models/${model}`,
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        ttl: `${ttl}s`
    };

    try {
        const url = `${CACHE_API_BASE}/cachedContents?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const msg = error.error?.message || `HTTP ${response.status}`;
            // Common failure: token count below minimum threshold
            console.warn(`[ExplicitCache] Failed to create cache for lang="${targetLanguage}": ${msg}`);
            return null;
        }

        const data = await response.json();
        const cacheEntry = {
            name: data.name,
            expireTime: data.expireTime,
            model,
        };

        _caches.set(targetLanguage, cacheEntry);
        console.log(`[ExplicitCache] Created cache "${data.name}" for lang="${targetLanguage}" (TTL: ${ttl}s, tokens: ${data.usageMetadata?.totalTokenCount || '?'})`);

        return cacheEntry;
    } catch (err) {
        console.error(`[ExplicitCache] Error creating cache:`, err.message);
        return null;
    }
}

/**
 * Get (or create) a cached content name for the given language.
 * Automatically refreshes expiring caches.
 *
 * @param {string} targetLanguage
 * @returns {Promise<string|null>} The cachedContent name, or null if unavailable
 */
async function getCacheName(targetLanguage) {
    const enabled = process.env.GEMINI_EXPLICIT_CACHE !== 'false';
    if (!enabled) return null;

    const lang = targetLanguage || 'English';
    const existing = _caches.get(lang);

    if (existing) {
        // Check if cache is still valid (not near expiry)
        const expireMs = new Date(existing.expireTime).getTime();
        const now = Date.now();
        if (expireMs - now > REFRESH_THRESHOLD_MS) {
            return existing.name;
        }

        // Cache is expiring soon — refresh it
        console.log(`[ExplicitCache] Cache for lang="${lang}" expiring soon, refreshing...`);
        await deleteCache(existing.name);
        _caches.delete(lang);
    }

    // Create new cache
    const entry = await createCache(lang);
    return entry ? entry.name : null;
}

/**
 * Update the TTL of an existing cache.
 *
 * @param {string} cacheName - e.g. "cachedContents/abc123"
 * @param {number} ttlSeconds
 * @returns {Promise<boolean>}
 */
async function updateCacheTTL(cacheName, ttlSeconds) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return false;

    try {
        const url = `${CACHE_API_BASE}/${cacheName}?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: `${ttlSeconds}s` }),
        });

        if (!response.ok) {
            console.warn(`[ExplicitCache] Failed to update TTL for "${cacheName}"`);
            return false;
        }

        const data = await response.json();
        // Update local cache entry
        for (const [lang, entry] of _caches) {
            if (entry.name === cacheName) {
                entry.expireTime = data.expireTime;
                break;
            }
        }

        console.log(`[ExplicitCache] Updated TTL for "${cacheName}" to ${ttlSeconds}s`);
        return true;
    } catch (err) {
        console.error(`[ExplicitCache] Error updating TTL:`, err.message);
        return false;
    }
}

/**
 * Delete a specific cache.
 *
 * @param {string} cacheName
 * @returns {Promise<boolean>}
 */
async function deleteCache(cacheName) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return false;

    try {
        const url = `${CACHE_API_BASE}/${cacheName}?key=${apiKey}`;
        const response = await fetch(url, { method: 'DELETE' });
        if (response.ok) {
            console.log(`[ExplicitCache] Deleted cache "${cacheName}"`);
        }
        return response.ok;
    } catch (err) {
        console.error(`[ExplicitCache] Error deleting cache:`, err.message);
        return false;
    }
}

/**
 * List all active caches (for debugging).
 *
 * @returns {Promise<Array>}
 */
async function listCaches() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return [];

    try {
        const url = `${CACHE_API_BASE}/cachedContents?key=${apiKey}`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        return data.cachedContents || [];
    } catch (err) {
        return [];
    }
}

/**
 * Clean up all caches on shutdown.
 */
async function cleanupAll() {
    for (const [lang, entry] of _caches) {
        await deleteCache(entry.name);
    }
    _caches.clear();
    console.log('[ExplicitCache] All caches cleaned up');
}

/**
 * Get current cache status (for health checks / debugging).
 */
function getStatus() {
    const entries = [];
    for (const [lang, entry] of _caches) {
        const expiresIn = Math.max(0, new Date(entry.expireTime).getTime() - Date.now());
        entries.push({
            language: lang,
            cacheName: entry.name,
            model: entry.model,
            expiresInMs: expiresIn,
            expiresInMin: Math.round(expiresIn / 60000),
        });
    }
    return entries;
}

module.exports = {
    getCacheName,
    createCache,
    updateCacheTTL,
    deleteCache,
    listCaches,
    cleanupAll,
    getStatus,
    // Exposed for testing
    _caches,
};
