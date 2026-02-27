const { analyzeText, calculateCost } = require('../services/gemini');
const { fetchWithRetry } = require('../fetchWithRetry');
const { getSystemInstruction, generatePrompt } = require('../prompts');

jest.mock('../fetchWithRetry', () => ({
    fetchWithRetry: jest.fn()
}));

jest.mock('../prompts', () => ({
    getSystemInstruction: jest.fn().mockReturnValue('mock system instruction'),
    generatePrompt: jest.fn().mockReturnValue('mock prompt')
}));

describe('gemini.js', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        jest.clearAllMocks();
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

        it('should throw an error if GEMINI_API_KEY is not set', async () => {
            delete process.env.GEMINI_API_KEY;
            await expect(analyzeText(defaultParams)).rejects.toMatchObject({
                message: 'Server configuration error: API Key missing',
                status: 500
            });
        });

        it('should successfully analyze text and return parsed result and usage', async () => {
            process.env.GEMINI_API_KEY = 'test-key';

            const mockApiResponse = {
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 20,
                    totalTokenCount: 30
                },
                candidates: [{
                    content: {
                        parts: [{
                            text: '```json\n{ "source_language": "en", "meaning": "hola" }\n```'
                        }]
                    }
                }]
            };

            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => mockApiResponse
            });

            const { result, usage } = await analyzeText(defaultParams);

            expect(fetchWithRetry).toHaveBeenCalledWith(
                expect.stringContaining('models/gemini-2.0-flash:generateContent?key=test-key'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('mock system instruction')
                })
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
            process.env.GEMINI_API_KEY = 'test-key';

            const mockApiResponse = {
                candidates: [{
                    content: { parts: [{ text: '{"meaning": "hola"}' }] }
                }]
            };

            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => mockApiResponse
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

        it('should throw "No content in response" if candidates text is missing', async () => {
            process.env.GEMINI_API_KEY = 'test-key';

            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ candidates: [] }) // no [0].content
            });

            await expect(analyzeText(defaultParams)).rejects.toThrow('No content in response');
        });

        it('should throw "Invalid JSON format in response" if JSON is not valid', async () => {
            process.env.GEMINI_API_KEY = 'test-key';

            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    candidates: [{
                        content: { parts: [{ text: 'No json here!' }] }
                    }]
                })
            });

            await expect(analyzeText(defaultParams)).rejects.toThrow('Invalid JSON format in response');
        });

        it('should handle Japanese furigana reconstruction correctly', async () => {
            process.env.GEMINI_API_KEY = 'test-key';

            const mockApiResponse = {
                candidates: [{
                    content: {
                        parts: [{
                            text: JSON.stringify({
                                language: 'ja',
                                segments: [
                                    { text: '私', reading: 'わたし' },
                                    { text: 'は', reading: 'は' }
                                ]
                            })
                        }]
                    }
                }]
            };

            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => mockApiResponse
            });

            const { result } = await analyzeText(defaultParams);
            expect(result.furigana).toBe('<ruby>私<rt>わたし</rt></ruby>は');
        });

        it('should throw specific 429 error if rate limited', async () => {
            process.env.GEMINI_API_KEY = 'test-key';

            fetchWithRetry.mockResolvedValueOnce({
                ok: false,
                status: 429,
                json: async () => ({ error: { message: 'Too many requests' } })
            });

            await expect(analyzeText(defaultParams)).rejects.toMatchObject({
                message: 'AI service is busy. Please try again in a few seconds.',
                status: 429
            });
        });

        it('should throw API error message on non-200 responses', async () => {
            process.env.GEMINI_API_KEY = 'test-key';

            fetchWithRetry.mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: async () => ({ error: { message: 'Bad request from gemini' } })
            });

            await expect(analyzeText(defaultParams)).rejects.toThrow('Bad request from gemini');
        });

        it('should substitute fallback error message if JSON parsing fails on error response', async () => {
            process.env.GEMINI_API_KEY = 'test-key';

            fetchWithRetry.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => { throw new Error('Not json') }
            });

            await expect(analyzeText(defaultParams)).rejects.toThrow('Gemini API request failed');
        });

        it('should allow custom model via GEMINI_MODEL env var', async () => {
            process.env.GEMINI_API_KEY = 'test-key';
            process.env.GEMINI_MODEL = 'custom-model-alpha';

            fetchWithRetry.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: '{"meaning": "test"}' }] } }]
                })
            });

            const { usage } = await analyzeText(defaultParams);

            expect(fetchWithRetry).toHaveBeenCalledWith(
                expect.stringContaining('models/custom-model-alpha:generateContent'),
                expect.any(Object)
            );
            expect(usage.model).toBe('custom-model-alpha');
        });
    });
});
