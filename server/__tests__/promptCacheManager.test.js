const { getCacheConfig, logCacheMetrics } = require('../services/promptCacheManager');

describe('promptCacheManager', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('getCacheConfig', () => {
        it('should enable logging by default', () => {
            delete process.env.PROMPT_CACHE_LOG_HITS;
            const config = getCacheConfig();
            expect(config.logHits).toBe(true);
        });

        it('should disable logging when PROMPT_CACHE_LOG_HITS=false', () => {
            process.env.PROMPT_CACHE_LOG_HITS = 'false';
            const config = getCacheConfig();
            expect(config.logHits).toBe(false);
        });
    });

    describe('logCacheMetrics', () => {
        let consoleSpy;

        beforeEach(() => {
            consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            process.env.PROMPT_CACHE_LOG_HITS = 'true';
        });

        afterEach(() => {
            consoleSpy.mockRestore();
        });

        it('should log when Gemini has cached tokens', () => {
            logCacheMetrics('gemini', {
                promptTokenCount: 1000,
                cachedContentTokenCount: 500,
                candidatesTokenCount: 200,
                totalTokenCount: 1200
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('[Cache] gemini: 500/1000 prompt tokens cached')
            );
        });

        it('should log when OpenRouter has cached tokens', () => {
            logCacheMetrics('openrouter', {
                prompt_tokens: 1000,
                prompt_tokens_details: { cached_tokens: 300 },
                completion_tokens: 200,
                total_tokens: 1200
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('[Cache] openrouter: 300/1000 prompt tokens cached')
            );
        });

        it('should log when Codex has cached tokens', () => {
            logCacheMetrics('codex', {
                prompt_tokens: 800,
                prompt_tokens_details: { cached_tokens: 400 },
                completion_tokens: 100,
                total_tokens: 900
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('[Cache] codex: 400/800 prompt tokens cached')
            );
        });

        it('should not log when no cached tokens', () => {
            logCacheMetrics('gemini', {
                promptTokenCount: 1000,
                candidatesTokenCount: 200,
                totalTokenCount: 1200
            });

            expect(consoleSpy).not.toHaveBeenCalled();
        });

        it('should not log when logging is disabled', () => {
            process.env.PROMPT_CACHE_LOG_HITS = 'false';

            logCacheMetrics('gemini', {
                promptTokenCount: 1000,
                cachedContentTokenCount: 500,
            });

            expect(consoleSpy).not.toHaveBeenCalled();
        });

        it('should not log for unknown provider', () => {
            logCacheMetrics('unknown', { cachedTokens: 500 });
            expect(consoleSpy).not.toHaveBeenCalled();
        });

        it('should not log when usage is null/undefined', () => {
            logCacheMetrics('gemini', null);
            logCacheMetrics('gemini', undefined);
            expect(consoleSpy).not.toHaveBeenCalled();
        });
    });
});
