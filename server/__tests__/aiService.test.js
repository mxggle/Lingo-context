const { analyzeText, calculateCost, _clearCacheForTesting } = require('../services/aiService');
const { getProvider } = require('../services/providers');

jest.mock('../services/providers', () => ({
    getProvider: jest.fn()
}));

jest.mock('../prompts', () => ({
    getSystemInstruction: jest.fn().mockReturnValue('mock system instruction'),
    generatePrompt: jest.fn().mockReturnValue('mock prompt')
}));

describe('aiService.js', () => {
    const originalEnv = process.env;
    let mockProvider;

    beforeEach(() => {
        process.env = { ...originalEnv };
        jest.clearAllMocks();
        _clearCacheForTesting(); // reset in-memory cache so tests don't bleed

        // Create a mock provider that mirrors the provider interface
        mockProvider = {
            callAPI: jest.fn(),
            PROVIDER_NAME: 'mock'
        };
        getProvider.mockReturnValue(mockProvider);
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('calculateCost', () => {
        it('should calculate cost correctly', () => {
            // RATE_INPUT = 0.10, RATE_OUTPUT = 0.40 per 1M tokens
            // 1M prompt tokens = $0.10
            // 1M completion tokens = $0.40
            const cost = calculateCost(1000000, 1000000);
            expect(cost).toBeCloseTo(0.50);
        });
    });

    describe('analyzeText', () => {
        const defaultParams = { text: 'hello', context: 'greeting', targetLanguage: 'Spanish' };

        it('should successfully analyze text and return parsed result and usage', async () => {
            mockProvider.callAPI.mockResolvedValueOnce({
                contentText: '```json\n{ "source_language": "en", "meaning": "hola" } \n```',
                usage: { model: 'gemini-2.0-flash', promptTokens: 10, completionTokens: 20, totalTokens: 30 }
            });

            const { result, usage } = await analyzeText(defaultParams);

            expect(mockProvider.callAPI).toHaveBeenCalledWith(
                'mock system instruction',
                'mock prompt'
            );

            // result.language fallback
            expect(result).toEqual({
                source_language: 'en',
                language: 'en',
                meaning: 'hola',
                furigana: 'hello' // matches text since isJapanese is false
            });

            expect(usage).toEqual({
                model: 'gemini-2.0-flash',
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
                cost: expect.any(Number)
            });
        });

        it('should handle missing usageMetadata', async () => {
            mockProvider.callAPI.mockResolvedValueOnce({
                contentText: '{"meaning": "hola"}',
                usage: { model: 'gemini-2.0-flash', promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            });

            const { usage } = await analyzeText(defaultParams);

            expect(usage).toEqual({
                model: 'gemini-2.0-flash',
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                cost: 0
            });
        });

        it('should throw "No content in response" if provider throws it', async () => {
            mockProvider.callAPI.mockRejectedValueOnce(new Error('No content in response'));

            await expect(analyzeText(defaultParams)).rejects.toThrow('No content in response');
        });

        it('should throw "Invalid JSON format in response" if JSON is not valid', async () => {
            mockProvider.callAPI.mockResolvedValueOnce({
                contentText: 'No json here!',
                usage: { model: 'test', promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            });

            await expect(analyzeText(defaultParams)).rejects.toThrow('Invalid JSON format in response');
        });

        it('should handle Japanese furigana reconstruction correctly', async () => {
            mockProvider.callAPI.mockResolvedValueOnce({
                contentText: JSON.stringify({
                    language: 'ja',
                    segments: [
                        { text: '私', reading: 'わたし' },
                        { text: 'は', reading: 'は' }
                    ]
                }),
                usage: { model: 'test', promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            });

            const { result } = await analyzeText(defaultParams);
            expect(result.furigana).toBe('<ruby>私<rt>わたし</rt></ruby>は');
        });

        it('should throw specific 429 error if rate limited', async () => {
            mockProvider.callAPI.mockRejectedValueOnce(
                Object.assign(new Error('AI service is busy. Please try again in a few seconds.'), { status: 429 })
            );

            await expect(analyzeText(defaultParams)).rejects.toMatchObject({
                message: 'AI service is busy. Please try again in a few seconds.',
                status: 429
            });
        });

        it('should throw API error message on non-200 responses', async () => {
            mockProvider.callAPI.mockRejectedValueOnce(new Error('Bad request from API'));

            await expect(analyzeText(defaultParams)).rejects.toThrow('Bad request from API');
        });
    });
});

// ── Cache behaviour ──────────────────────────────────────────────────────────

describe('aiService.js cache', () => {
    let mockProvider;

    beforeEach(() => {
        process.env.GEMINI_API_KEY = 'test-key';
        jest.clearAllMocks();
        _clearCacheForTesting();

        mockProvider = {
            callAPI: jest.fn().mockResolvedValue({
                contentText: '{"meaning": "hello", "source_language": "en"}',
                usage: { model: 'test-model', promptTokens: 5, completionTokens: 10, totalTokens: 15 }
            }),
            PROVIDER_NAME: 'mock'
        };
        getProvider.mockReturnValue(mockProvider);
    });

    it('should return cached result on identical lookup (provider called once)', async () => {
        const params = { text: 'hello', context: 'greet', targetLanguage: 'English' };
        const first = await analyzeText(params);
        const second = await analyzeText(params);

        // Provider should only have been called ONCE; second call hits cache
        expect(mockProvider.callAPI).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
    });

    it('should call provider again when targetLanguage differs (cache miss)', async () => {
        await analyzeText({ text: 'hello', context: 'greet', targetLanguage: 'English' });
        await analyzeText({ text: 'hello', context: 'greet', targetLanguage: 'Japanese' });

        // Different targetLanguage -> different cache key -> provider called twice
        expect(mockProvider.callAPI).toHaveBeenCalledTimes(2);
    });

    it('should expire cache entry after TTL and re-call provider', async () => {
        jest.useFakeTimers();

        const params = { text: 'hello', context: 'greet', targetLanguage: 'English' };
        await analyzeText(params);

        // Advance time beyond TTL (10 minutes)
        jest.advanceTimersByTime(11 * 60 * 1000);
        await analyzeText(params);

        // Cache expired -> provider called again
        expect(mockProvider.callAPI).toHaveBeenCalledTimes(2);
        jest.useRealTimers();
    });
});
