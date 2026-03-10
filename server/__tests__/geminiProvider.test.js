const { callAPI, callStreamAPI, parseSSEData, buildRequest, PROVIDER_NAME } = require('../services/providers/gemini');
const { fetchWithRetry } = require('../fetchWithRetry');

jest.mock('../fetchWithRetry', () => ({
    fetchWithRetry: jest.fn()
}));

jest.mock('../services/promptCacheManager', () => ({
    logCacheMetrics: jest.fn()
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

    describe('buildRequest', () => {
        it('should use systemInstruction field separate from contents', () => {
            const { body } = buildRequest('system text', 'user prompt');

            // systemInstruction must be its own field
            expect(body.systemInstruction).toEqual({
                parts: [{ text: 'system text' }]
            });

            // contents should only have the user prompt, NOT the system instruction
            expect(body.contents).toEqual([{
                role: 'user',
                parts: [{ text: 'user prompt' }]
            }]);

            // Must NOT contain the old broken cachedContent field
            expect(body.cachedContent).toBeUndefined();
        });

        it('should NOT contain cachedContent property', () => {
            process.env.GEMINI_ENABLE_CACHE = 'true';
            process.env.GEMINI_CACHED_CONTENT_NAME = 'some-name';

            const { body } = buildRequest('sys', 'prompt');
            expect(body.cachedContent).toBeUndefined();
        });

        it('should use generateContent URL for non-stream', () => {
            const { url } = buildRequest('sys', 'prompt');
            expect(url).toContain(':generateContent');
            expect(url).not.toContain('streamGenerateContent');
        });

        it('should use streamGenerateContent URL for stream', () => {
            const { url } = buildRequest('sys', 'prompt', { stream: true });
            expect(url).toContain(':streamGenerateContent');
            expect(url).toContain('alt=sse');
        });

        it('should use custom model from env', () => {
            process.env.GEMINI_MODEL = 'custom-model';
            const { url, model } = buildRequest('sys', 'prompt');
            expect(url).toContain('models/custom-model:');
            expect(model).toBe('custom-model');
        });

        it('should throw if GEMINI_API_KEY is not set', () => {
            delete process.env.GEMINI_API_KEY;
            expect(() => buildRequest('sys', 'prompt')).toThrow('Server configuration error: API Key missing');
        });
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
                expect.stringContaining('models/gemini-2.0-flash:generateContent'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('systemInstruction')
                })
            );

            // Verify systemInstruction is separate from contents
            const requestBody = JSON.parse(fetchWithRetry.mock.calls[0][1].body);
            expect(requestBody.systemInstruction.parts[0].text).toBe('system instruction');
            expect(requestBody.contents[0].parts[0].text).toBe('user prompt');

            expect(result.contentText).toBe('{"meaning": "hello"}');
            expect(result.usage).toEqual({
                model: 'gemini-2.0-flash',
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30
            });
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
