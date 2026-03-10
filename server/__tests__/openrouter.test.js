const { callAPI, callStreamAPI, parseSSEData, PROVIDER_NAME } = require('../services/providers/openrouter');
const { fetchWithRetry } = require('../fetchWithRetry');

jest.mock('../fetchWithRetry', () => ({
    fetchWithRetry: jest.fn()
}));

describe('OpenRouter Provider', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('should have correct provider name', () => {
        expect(PROVIDER_NAME).toBe('openrouter');
    });

    describe('callAPI', () => {
        it('should throw if OPENROUTER_API_KEY is not set', async () => {
            delete process.env.OPENROUTER_API_KEY;
            await expect(callAPI('system', 'prompt')).rejects.toMatchObject({
                message: 'Server configuration error: OpenRouter API Key missing',
                status: 500
            });
        });

        it('should call OpenRouter with correct OpenAI-compatible format', async () => {
            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: '{"meaning": "hello"}' } }],
                    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
                })
            });

            const result = await callAPI('system instruction', 'user prompt');

            expect(fetchWithRetry).toHaveBeenCalledWith(
                'https://openrouter.ai/api/v1/chat/completions',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-openrouter-key',
                        'Content-Type': 'application/json'
                    }),
                    body: expect.stringContaining('"messages"')
                })
            );

            // Verify request body format
            const bodyStr = fetchWithRetry.mock.calls[0][1].body;
            const body = JSON.parse(bodyStr);
            expect(body.messages).toEqual([
                { role: 'system', content: 'system instruction' },
                { role: 'user', content: 'user prompt' }
            ]);

            expect(result.contentText).toBe('{"meaning": "hello"}');
            expect(result.usage).toEqual({
                model: 'google/gemini-2.0-flash-001',
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30
            });
        });

        it('should use custom model from env', async () => {
            process.env.OPENROUTER_MODEL = 'anthropic/claude-3-haiku';
            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: '{"meaning": "test"}' } }],
                    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 }
                })
            });

            const result = await callAPI('sys', 'prompt');
            const body = JSON.parse(fetchWithRetry.mock.calls[0][1].body);
            expect(body.model).toBe('anthropic/claude-3-haiku');
            expect(result.usage.model).toBe('anthropic/claude-3-haiku');
        });

        it('should throw 429 error on rate limit', async () => {
            fetchWithRetry.mockResolvedValueOnce({
                ok: false,
                status: 429,
                json: async () => ({ error: { message: 'Rate limited' } })
            });

            await expect(callAPI('sys', 'prompt')).rejects.toMatchObject({
                message: 'AI service is busy. Please try again in a few seconds.',
                status: 429
            });
        });

        it('should throw on empty response', async () => {
            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [] })
            });

            await expect(callAPI('sys', 'prompt')).rejects.toThrow('No content in response');
        });

        it('should throw API error on non-200 responses', async () => {
            fetchWithRetry.mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: async () => ({ error: { message: 'Bad request' } })
            });

            await expect(callAPI('sys', 'prompt')).rejects.toThrow('Bad request');
        });
    });

    describe('parseSSEData', () => {
        it('should parse text from delta', () => {
            const result = parseSSEData(JSON.stringify({
                choices: [{ delta: { content: 'Hello' } }]
            }));
            expect(result).toEqual({ text: 'Hello', usage: null });
        });

        it('should parse usage from final chunk', () => {
            const result = parseSSEData(JSON.stringify({
                choices: [{ delta: {} }],
                usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
            }));
            expect(result).toEqual({
                text: null,
                usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
            });
        });

        it('should return null for [DONE]', () => {
            expect(parseSSEData('[DONE]')).toBeNull();
        });

        it('should return null for invalid JSON', () => {
            expect(parseSSEData('not json')).toBeNull();
        });

        it('should handle chunk with both text and usage', () => {
            const result = parseSSEData(JSON.stringify({
                choices: [{ delta: { content: 'world' } }],
                usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 }
            }));
            expect(result).toEqual({
                text: 'world',
                usage: { promptTokens: 5, completionTokens: 15, totalTokens: 20 }
            });
        });
    });
});
