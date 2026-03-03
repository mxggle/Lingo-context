// AI Streaming Service — provider-agnostic streaming text analysis with caching

const { getSystemInstruction, generatePrompt } = require('../prompts');
const { getProvider } = require('./providers');

const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const _cache = new Map();

function _cacheKey(text, context, targetLanguage) {
    return `${targetLanguage}:${text}:${String(context)}`;
}

function _cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        _cache.delete(key);
        return null;
    }
    return entry.value;
}

function _cacheSet(key, value) {
    if (_cache.size >= CACHE_MAX_SIZE) {
        _cache.delete(_cache.keys().next().value);
    }
    _cache.set(key, { value, ts: Date.now() });
}

function calculateCost(promptTokens, completionTokens) {
    const RATE_INPUT = 0.10;
    const RATE_OUTPUT = 0.40;
    const inputCost = (promptTokens / 1000000) * RATE_INPUT;
    const outputCost = (completionTokens / 1000000) * RATE_OUTPUT;
    return inputCost + outputCost;
}

async function analyzeTextStream({ text, context, targetLanguage }, res) {
    const cacheKey = _cacheKey(text, context, targetLanguage);
    const cached = _cacheGet(cacheKey);
    if (cached) {
        const cachedChunks = Array.isArray(cached) ? cached : (cached.chunks || []);
        for (const chunk of cachedChunks) {
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return Array.isArray(cached) ? null : (cached.usage || null);
    }

    const provider = getProvider();
    const systemInstruction = getSystemInstruction(targetLanguage);
    const prompt = generatePrompt(text, context, targetLanguage);

    const timeout = parseInt(process.env.API_TIMEOUT) || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    let usageForLogging = null;

    try {
        const { response, model } = await provider.callStreamAPI(systemInstruction, prompt, {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        const chunks = [];

        for await (const value of response.body) {
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop(); // Save incomplete chunk for next iteration

            for (const line of lines) {
                // Skip SSE comment lines (e.g., ": OPENROUTER PROCESSING")
                if (line.startsWith(':')) continue;

                if (line.startsWith('data: ')) {
                    const dataStr = line.replace('data: ', '').trim();
                    if (!dataStr || dataStr === '[DONE]') continue;

                    const parsed = provider.parseSSEData(dataStr);
                    if (!parsed) continue;

                    if (parsed.usage) {
                        usageForLogging = {
                            model,
                            promptTokens: parsed.usage.promptTokens,
                            completionTokens: parsed.usage.completionTokens,
                            totalTokens: parsed.usage.totalTokens,
                            cost: calculateCost(parsed.usage.promptTokens, parsed.usage.completionTokens)
                        };
                    }

                    if (parsed.text) {
                        chunks.push(parsed.text);
                        res.write(`data: ${JSON.stringify({ text: parsed.text })}\n\n`);
                    }
                }
            }
        }

        if (chunks.length > 0) {
            _cacheSet(cacheKey, { chunks, usage: usageForLogging });
        }

    } catch (error) {
        console.error('Streaming API Error:', error);
        const message = error.name === 'AbortError'
            ? 'Request timed out. Please try again.'
            : error.message;
        res.write(`data: ${JSON.stringify({ error: true, message })}\n\n`);
    } finally {
        clearTimeout(timeoutId);
        res.write('data: [DONE]\n\n');
        res.end();
    }

    return usageForLogging;
}

module.exports = { analyzeTextStream, _clearCacheForTesting: () => _cache.clear() };
