const codexProvider = require('../services/providers/codex');
const { fetchWithRetry } = require('../fetchWithRetry');
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../fetchWithRetry');
jest.mock('fs');

describe('codex.js', () => {
    const originalEnv = process.env;
    const originalHome = os.homedir;

    beforeEach(() => {
        process.env = { ...originalEnv };
        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(false);
    });

    afterAll(() => {
        process.env = originalEnv;
        os.homedir = originalHome;
    });

    describe('getCachedAuthToken', () => {
        it('should return null if auth file does not exist', () => {
            fs.existsSync.mockReturnValue(false);
            const token = codexProvider.getCachedAuthToken();
            expect(token).toBeNull();
        });

        it('should extract access_token from auth file', () => {
            const mockAuthData = { access_token: 'test-token-123' };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockAuthData));

            const token = codexProvider.getCachedAuthToken();
            expect(token).toBe('test-token-123');
        });

        it('should extract chatgpt.access_token from auth file', () => {
            const mockAuthData = { chatgpt: { access_token: 'chatgpt-token-456' } };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockAuthData));

            const token = codexProvider.getCachedAuthToken();
            expect(token).toBe('chatgpt-token-456');
        });

        it('should extract api_key from auth file', () => {
            const mockAuthData = { api_key: 'api-key-789' };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockAuthData));

            const token = codexProvider.getCachedAuthToken();
            expect(token).toBe('api-key-789');
        });

        it('should extract tokens.access_token from auth file (new format)', () => {
            const mockAuthData = { tokens: { access_token: 'tokens-token-999' } };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockAuthData));

            const token = codexProvider.getCachedAuthToken();
            expect(token).toBe('tokens-token-999');
        });

        it('should extract OPENAI_API_KEY from auth file', () => {
            const mockAuthData = { OPENAI_API_KEY: 'file-api-key' };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockAuthData));

            const token = codexProvider.getCachedAuthToken();
            expect(token).toBe('file-api-key');
        });

        it('should return null if auth file is invalid JSON', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('invalid json');

            const token = codexProvider.getCachedAuthToken();
            expect(token).toBeNull();
        });

        it('should return null if no valid token fields exist', () => {
            const mockAuthData = { some_other_field: 'value' };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockAuthData));

            const token = codexProvider.getCachedAuthToken();
            expect(token).toBeNull();
        });
    });

    describe('getAuthToken', () => {
        it('should return OPENAI_API_KEY from environment if set', () => {
            process.env.OPENAI_API_KEY = 'env-api-key';
            const token = codexProvider.getAuthToken();
            expect(token).toBe('env-api-key');
        });

        it('should return cached token if no env var', () => {
            delete process.env.OPENAI_API_KEY;
            const mockAuthData = { access_token: 'cached-token' };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockAuthData));

            const token = codexProvider.getAuthToken();
            expect(token).toBe('cached-token');
        });

        it('should throw error if no token available', () => {
            delete process.env.OPENAI_API_KEY;
            fs.existsSync.mockReturnValue(false);

            expect(() => codexProvider.getAuthToken()).toThrow(
                'Codex authentication required'
            );
        });
    });

    describe('isConfigured', () => {
        it('should return true if OPENAI_API_KEY is set', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            expect(codexProvider.isConfigured()).toBe(true);
        });

        it('should return true if cached token exists', () => {
            delete process.env.OPENAI_API_KEY;
            const mockAuthData = { access_token: 'cached-token' };
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockAuthData));

            expect(codexProvider.isConfigured()).toBe(true);
        });

        it('should return false if no token available', () => {
            delete process.env.OPENAI_API_KEY;
            fs.existsSync.mockReturnValue(false);

            expect(codexProvider.isConfigured()).toBe(false);
        });
    });

    describe('callAPI', () => {
        const systemInstruction = 'You are a helpful assistant';
        const prompt = 'Hello';

        beforeEach(() => {
            process.env.OPENAI_API_KEY = 'test-key';
            process.env.CODEX_MODEL = 'codex';
        });

        it('should successfully call API and return parsed response', async () => {
            const mockResponse = {
                ok: true,
                json: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: 'Hello there!' } }],
                    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
                })
            };
            fetchWithRetry.mockResolvedValue(mockResponse);

            const result = await codexProvider.callAPI(systemInstruction, prompt);

            expect(fetchWithRetry).toHaveBeenCalledWith(
                'https://api.openai.com/v1/chat/completions',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-key'
                    })
                })
            );

            expect(result).toEqual({
                contentText: 'Hello there!',
                usage: {
                    model: 'codex',
                    promptTokens: 10,
                    completionTokens: 20,
                    totalTokens: 30
                }
            });
        });

        it('should include OpenAI-Organization header if set', async () => {
            process.env.OPENAI_ORGANIZATION = 'org-123';
            const mockResponse = {
                ok: true,
                json: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: 'Hi' } }],
                    usage: {}
                })
            };
            fetchWithRetry.mockResolvedValue(mockResponse);

            await codexProvider.callAPI(systemInstruction, prompt);

            expect(fetchWithRetry).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'OpenAI-Organization': 'org-123'
                    })
                })
            );
        });

        it('should include OpenAI-Project header if set', async () => {
            process.env.OPENAI_PROJECT = 'proj-456';
            const mockResponse = {
                ok: true,
                json: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: 'Hi' } }],
                    usage: {}
                })
            };
            fetchWithRetry.mockResolvedValue(mockResponse);

            await codexProvider.callAPI(systemInstruction, prompt);

            expect(fetchWithRetry).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'OpenAI-Project': 'proj-456'
                    })
                })
            );
        });

        it('should throw 429 error on rate limit', async () => {
            const mockResponse = {
                ok: false,
                status: 429,
                json: jest.fn().mockResolvedValue({ error: { message: 'Rate limit exceeded' } })
            };
            fetchWithRetry.mockResolvedValue(mockResponse);

            await expect(codexProvider.callAPI(systemInstruction, prompt))
                .rejects.toMatchObject({
                    message: 'AI service is busy. Please try again in a few seconds.',
                    status: 429
                });
        });

        it('should throw 401 error on authentication failure', async () => {
            const mockResponse = {
                ok: false,
                status: 401,
                json: jest.fn().mockResolvedValue({ error: { message: 'Invalid token' } })
            };
            fetchWithRetry.mockResolvedValue(mockResponse);

            await expect(codexProvider.callAPI(systemInstruction, prompt))
                .rejects.toMatchObject({
                    message: 'Codex authentication failed. Please run "codex login" again.',
                    status: 401
                });
        });

        it('should throw error on other API failures', async () => {
            const mockResponse = {
                ok: false,
                status: 500,
                json: jest.fn().mockResolvedValue({ error: { message: 'Server error' } })
            };
            fetchWithRetry.mockResolvedValue(mockResponse);

            await expect(codexProvider.callAPI(systemInstruction, prompt))
                .rejects.toThrow('Server error');
        });

        it('should throw error if no content in response', async () => {
            const mockResponse = {
                ok: true,
                json: jest.fn().mockResolvedValue({
                    choices: [],
                    usage: {}
                })
            };
            fetchWithRetry.mockResolvedValue(mockResponse);

            await expect(codexProvider.callAPI(systemInstruction, prompt))
                .rejects.toThrow('No content in response');
        });
    });

    describe('callStreamAPI', () => {
        const systemInstruction = 'You are a helpful assistant';
        const prompt = 'Hello';

        beforeEach(() => {
            process.env.OPENAI_API_KEY = 'test-key';
            process.env.CODEX_MODEL = 'codex';
        });

        it('should successfully call streaming API', async () => {
            const mockResponse = {
                ok: true,
                body: 'stream body'
            };
            fetchWithRetry.mockResolvedValue(mockResponse);

            const result = await codexProvider.callStreamAPI(systemInstruction, prompt);

            expect(fetchWithRetry).toHaveBeenCalledWith(
                'https://api.openai.com/v1/chat/completions',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-key'
                    })
                })
            );

            expect(result).toEqual({
                response: mockResponse,
                model: 'codex'
            });
        });

        it('should set stream=true in request body', async () => {
            const mockResponse = { ok: true };
            fetchWithRetry.mockResolvedValue(mockResponse);

            await codexProvider.callStreamAPI(systemInstruction, prompt);

            const callArgs = fetchWithRetry.mock.calls[0][1];
            const body = JSON.parse(callArgs.body);
            expect(body.stream).toBe(true);
        });

        it('should pass signal for abort controller', async () => {
            const mockSignal = { aborted: false };
            const mockResponse = { ok: true };
            fetchWithRetry.mockResolvedValue(mockResponse);

            await codexProvider.callStreamAPI(systemInstruction, prompt, { signal: mockSignal });

            expect(fetchWithRetry).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    signal: mockSignal
                })
            );
        });

        it('should throw 401 error on authentication failure', async () => {
            const mockResponse = {
                ok: false,
                status: 401,
                json: jest.fn().mockResolvedValue({ error: { message: 'Invalid token' } })
            };
            fetchWithRetry.mockResolvedValue(mockResponse);

            await expect(codexProvider.callStreamAPI(systemInstruction, prompt))
                .rejects.toMatchObject({
                    message: 'Codex authentication failed. Please run "codex login" again.',
                    status: 401
                });
        });
    });

    describe('parseSSEData', () => {
        it('should return null for [DONE] marker', () => {
            expect(codexProvider.parseSSEData('[DONE]')).toBeNull();
        });

        it('should parse text from delta content', () => {
            const data = JSON.stringify({
                choices: [{ delta: { content: 'Hello' } }]
            });

            const result = codexProvider.parseSSEData(data);
            expect(result).toEqual({ text: 'Hello', usage: null });
        });

        it('should parse usage from final chunk', () => {
            const data = JSON.stringify({
                choices: [{ delta: {} }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 20,
                    total_tokens: 30
                }
            });

            const result = codexProvider.parseSSEData(data);
            expect(result).toEqual({
                text: null,
                usage: {
                    promptTokens: 10,
                    completionTokens: 20,
                    totalTokens: 30
                }
            });
        });

        it('should parse both text and usage in same chunk', () => {
            const data = JSON.stringify({
                choices: [{ delta: { content: 'World' } }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 20,
                    total_tokens: 30
                }
            });

            const result = codexProvider.parseSSEData(data);
            expect(result).toEqual({
                text: 'World',
                usage: {
                    promptTokens: 10,
                    completionTokens: 20,
                    totalTokens: 30
                }
            });
        });

        it('should return null for invalid JSON', () => {
            expect(codexProvider.parseSSEData('invalid json')).toBeNull();
        });

        it('should handle missing delta gracefully', () => {
            const data = JSON.stringify({ choices: [{}] });
            const result = codexProvider.parseSSEData(data);
            expect(result).toEqual({ text: null, usage: null });
        });
    });
});
