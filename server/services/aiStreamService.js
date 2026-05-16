// AI Streaming Service — provider-agnostic streaming text analysis with caching

const { getSystemInstruction, generatePrompt, normalizePromptContext } = require('../prompts');
const { getProvider } = require('./providers');
const { normalizeTargetLanguage, shouldRetryForLanguageMismatch } = require('../targetLanguage');
const { normalizeAnalysisResult } = require('./normalizeAnalysisResult');

const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const _cache = new Map();

function _cacheKey(text, context, targetLanguage) {
    const trimmedContext = normalizePromptContext(context);
    return `${targetLanguage}:${text}:${trimmedContext}`;
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

/**
 * Universal stream reader that works with both Web Streams (getReader)
 * and Node.js Readable streams (async iterator / events).
 */
async function* readStreamBody(body) {
    if (!body) {
        console.warn('[AI:stream] Response body is null/undefined');
        return;
    }

    // Web Streams API (node-fetch v3, native fetch, undici)
    if (typeof body.getReader === 'function') {
        const reader = body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield value;
        }
        return;
    }

    // Node.js Readable stream (async iterable in Node 10+)
    if (typeof body[Symbol.asyncIterator] === 'function') {
        for await (const chunk of body) {
            yield chunk;
        }
        return;
    }

    // Legacy event-emitter fallback (should rarely be needed)
    console.warn('[AI:stream] Falling back to event-based stream reading');
    const chunks = [];
    let ended = false;
    let streamError = null;

    body.on('data', chunk => chunks.push(chunk));
    body.on('end', () => { ended = true; });
    body.on('error', err => { streamError = err; ended = true; });

    while (!ended || chunks.length > 0) {
        if (chunks.length > 0) {
            yield chunks.shift();
        } else if (!ended) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    }

    if (streamError) throw streamError;
}

function calculateCost(promptTokens, completionTokens) {
    const RATE_INPUT = 0.10;
    const RATE_OUTPUT = 0.40;
    const inputCost = (promptTokens / 1000000) * RATE_INPUT;
    const outputCost = (completionTokens / 1000000) * RATE_OUTPUT;
    return inputCost + outputCost;
}

function isOutputTokenLimitFinishReason(finishReason) {
    return ['MAX_TOKENS', 'length'].includes(String(finishReason || ''));
}

async function analyzeTextStream({ text, context, targetLanguage, aiProvider }, res) {
    const normalizedTargetLanguage = normalizeTargetLanguage(targetLanguage).name;
    const cacheKey = _cacheKey(text, context, normalizedTargetLanguage);
    const cached = _cacheGet(cacheKey);
    if (cached) {
        console.log(`[AI:stream] Cache HIT for "${text.slice(0, 40)}" (lang: ${normalizedTargetLanguage})`);
        const cachedChunks = Array.isArray(cached) ? cached : (cached.chunks || []);
        for (const chunk of cachedChunks) {
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return Array.isArray(cached) ? null : (cached.usage || null);
    }

    const provider = getProvider(aiProvider);
    const prompt = generatePrompt(text, context, normalizedTargetLanguage);

    const timeout = parseInt(process.env.API_TIMEOUT) || 30000;
    let usageForLogging = null;

    try {
        let finalChunks = [];
        let lastStreamError = null;
        let hasValidResult = false;

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const systemInstruction = getSystemInstruction(normalizedTargetLanguage, {
                strictLanguageOnly: attempt > 0
            });
            const callTime = new Date().toISOString();
            const startMs = Date.now();
            console.log(`[AI:stream] ▶ Calling provider (attempt ${attempt + 1}) | lang: ${normalizedTargetLanguage} | time: ${callTime}`);
            console.log(`[AI:stream]   selection: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`); 
            try {
                const { response, model } = await provider.callStreamAPI(systemInstruction, prompt, {
                    signal: controller.signal,
                    targetLanguage: normalizedTargetLanguage,
                });

                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                const chunks = [];
                let rawLineCount = 0;
                let stoppedByOutputTokenLimit = false;

                for await (const value of readStreamBody(response.body)) {
                    const chunk = Buffer.isBuffer(value) ? value.toString('utf-8') : decoder.decode(value, { stream: true });
                    buffer += chunk;

                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        rawLineCount++;
                        // Log first few raw lines for diagnostics
                        if (rawLineCount <= 5) {
                            console.log(`[AI:stream] raw line #${rawLineCount}: ${line.slice(0, 120)}`);
                        }

                        if (line.startsWith(':')) continue;

                        if (line.startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '').trim();
                            if (!dataStr || dataStr === '[DONE]') continue;

                            const parsed = provider.parseSSEData(dataStr);
                            if (!parsed) continue;

                            if (isOutputTokenLimitFinishReason(parsed.finishReason)) {
                                stoppedByOutputTokenLimit = true;
                            }

                            if (parsed.usage) {
                                usageForLogging = {
                                    model,
                                    promptTokens: parsed.usage.promptTokens,
                                    completionTokens: parsed.usage.completionTokens,
                                    totalTokens: parsed.usage.totalTokens,
                                    cost: calculateCost(parsed.usage.promptTokens, parsed.usage.completionTokens)
                                };
                                const elapsedMs = Date.now() - startMs;
                                console.log(`[AI:stream] ✔ Stream complete | model: ${model} | elapsed: ${elapsedMs}ms | tokens: ${parsed.usage.totalTokens ?? '?'} (prompt: ${parsed.usage.promptTokens ?? '?'}, completion: ${parsed.usage.completionTokens ?? '?'})`);
                            }

                            if (parsed.text) {
                                chunks.push(parsed.text);
                            }
                        }
                    }
                }
                console.log(`[AI:stream] Stream body done | rawLines: ${rawLineCount}, textChunks: ${chunks.length}`);

                const fullText = chunks.join('');
                const jsonMatch = fullText.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    lastStreamError = stoppedByOutputTokenLimit
                        ? new Error('AI response was cut off before valid JSON was complete. Please retry or increase AI_MAX_OUTPUT_TOKENS.')
                        : new Error('No content in streaming response');
                    if (stoppedByOutputTokenLimit) break;
                    continue;
                }

                let parsedResult;
                try {
                    parsedResult = normalizeAnalysisResult(JSON.parse(jsonMatch[0]), text);
                } catch (error) {
                    lastStreamError = stoppedByOutputTokenLimit
                        ? new Error('AI response was cut off before valid JSON was complete. Please retry or increase AI_MAX_OUTPUT_TOKENS.')
                        : new Error('Invalid JSON format in streaming response');
                    if (stoppedByOutputTokenLimit) break;
                    continue;
                }

                if (!shouldRetryForLanguageMismatch(parsedResult, normalizedTargetLanguage) || attempt > 0) {
                    finalChunks = [JSON.stringify(parsedResult)];
                    hasValidResult = true;
                    lastStreamError = null;
                    break;
                }
                console.log(`[AI:stream] ↩ Language mismatch detected, retrying with strict mode…`);
                lastStreamError = new Error('AI response used the wrong target language');
            } finally {
                clearTimeout(timeoutId);
            }
        }

        if (!hasValidResult) {
            throw lastStreamError || new Error('No content in streaming response');
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
