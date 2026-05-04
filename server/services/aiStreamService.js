// AI Streaming Service — provider-agnostic streaming text analysis with caching

const { getSystemInstruction, generatePrompt } = require('../prompts');
const { getProvider } = require('./providers');
const { normalizeTargetLanguage, shouldRetryForLanguageMismatch } = require('../targetLanguage');

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
    const normalizedTargetLanguage = normalizeTargetLanguage(targetLanguage).name;
    const cacheKey = _cacheKey(text, context, normalizedTargetLanguage);
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
    const prompt = generatePrompt(text, context, normalizedTargetLanguage);

    const timeout = parseInt(process.env.API_TIMEOUT) || 30000;
    let usageForLogging = null;

    try {
        let finalChunks = [];

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const systemInstruction = getSystemInstruction(normalizedTargetLanguage, {
                strictLanguageOnly: attempt > 0
            });
            try {
                const { response, model } = await provider.callStreamAPI(systemInstruction, prompt, {
                    signal: controller.signal,
                    targetLanguage: normalizedTargetLanguage,
                });

                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                const chunks = [];

                for await (const value of response.body) {
                    buffer += decoder.decode(value, { stream: true });

                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
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
                            }
                        }
                    }
                }

                finalChunks = chunks;

                const fullText = chunks.join('');
                const jsonMatch = fullText.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    break;
                }

                let parsedResult;
                try {
                    parsedResult = JSON.parse(jsonMatch[0]);
                } catch (error) {
                    break;
                }

                if (!shouldRetryForLanguageMismatch(parsedResult, normalizedTargetLanguage) || attempt > 0) {
                    break;
                }
            } finally {
                clearTimeout(timeoutId);
            }
        }

        for (const chunk of finalChunks) {
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }

        if (finalChunks.length > 0) {
            _cacheSet(cacheKey, { chunks: finalChunks, usage: usageForLogging });
        }

    } catch (error) {
        console.error('Streaming API Error:', error);
        const message = error.name === 'AbortError'
            ? 'Request timed out. Please try again.'
            : error.message;
        res.write(`data: ${JSON.stringify({ error: true, message })}\n\n`);
    } finally {
        res.write('data: [DONE]\n\n');
        res.end();
    }

    return usageForLogging;
}

module.exports = { analyzeTextStream, _clearCacheForTesting: () => _cache.clear() };
