const { callAPI, callStreamAPI, parseSSEData, PROVIDER_NAME } = require('../services/providers/gemini');
const { fetchWithRetry } = require('../fetchWithRetry');

jest.mock('../fetchWithRetry', () => ({
    fetchWithRetry: jest.fn()
}));

describe('Gemini Provider', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('should have correct provider name', () => {
        expect(PROVIDER_NAME).toBe('gemini');
    });

    describe('callAPI', () => {
        it('should throw if GEMINI_API_KEY is not set', async () => {
            delete process.env.GEMINI_API_KEY;
            await expect(callAPI('system', 'prompt')).rejects.toMatchObject({
                message: 'Server configuration error: API Key missing',
                status: 500
            });
        });

        it('should call Gemini with correct format', async () => {
            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: '{"meaning": "hello"}' }] } }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
                })
            });

            const result = await callAPI('system instruction', 'user prompt');

            expect(fetchWithRetry).toHaveBeenCalledWith(
                expect.stringContaining('models/gemini-2.0-flash:generateContent?key=test-gemini-key'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('system instruction')
                })
            );

            expect(result.contentText).toBe('{"meaning": "hello"}');
            expect(result.usage).toEqual({
                model: 'gemini-2.0-flash',
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30
            });
        });

        it('should use custom model from env', async () => {
            process.env.GEMINI_MODEL = 'custom-model';
            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: '{"meaning": "test"}' }] } }]
                })
            });

            const result = await callAPI('sys', 'prompt');
            expect(fetchWithRetry).toHaveBeenCalledWith(
                expect.stringContaining('models/custom-model:generateContent'),
                expect.any(Object)
            );
            expect(result.usage.model).toBe('custom-model');
        });

        it('should throw 429 error on rate limit', async () => {
            fetchWithRetry.mockResolvedValueOnce({
                ok: false,
                status: 429,
                json: async () => ({ error: { message: 'Too many requests' } })
            });

            await expect(callAPI('sys', 'prompt')).rejects.toMatchObject({
                message: 'AI service is busy. Please try again in a few seconds.',
                status: 429
            });
        });

        it('should throw on empty response', async () => {
            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ candidates: [] })
            });

            await expect(callAPI('sys', 'prompt')).rejects.toThrow('No content in response');
        });
    });

    describe('parseSSEData', () => {
        it('should parse text from Gemini candidates', () => {
            const result = parseSSEData(JSON.stringify({
                candidates: [{ content: { parts: [{ text: 'Hello' }] } }]
            }));
            expect(result).toEqual({ text: 'Hello', usage: null });
        });

        it('should parse usage metadata', () => {
            const result = parseSSEData(JSON.stringify({
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
            }));
            expect(result).toEqual({
                text: null,
                usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
            });
        });

        it('should return null for invalid JSON', () => {
            expect(parseSSEData('not json')).toBeNull();
        });
    });
});
