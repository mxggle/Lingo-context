const { fetchWithRetry } = require('../fetchWithRetry');

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a mock Response object */
function mockResponse(status, body = {}) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
    };
}

/** Create a mock fetch that returns responses in sequence */
function createMockFetch(responses) {
    let callCount = 0;
    const fn = async () => {
        const item = responses[Math.min(callCount, responses.length - 1)];
        callCount++;
        if (item instanceof Error) throw item;
        return item;
    };
    fn.getCallCount = () => callCount;
    return fn;
}

// Use short delays in all tests to keep the suite fast
const FAST_RETRY = { initialDelay: 10, maxRetries: 4 };

// ── Tests ────────────────────────────────────────────────────────────

describe('fetchWithRetry', () => {

    // Suppress console.warn noise during tests
    beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => { }); });
    afterAll(() => { console.warn.mockRestore(); });

    describe('successful requests', () => {
        it('should return immediately on 200 without retrying', async () => {
            const mockFetch = createMockFetch([mockResponse(200, { ok: true })]);

            const res = await fetchWithRetry('http://test', {}, {
                ...FAST_RETRY, _fetch: mockFetch,
            });

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ ok: true });
            expect(mockFetch.getCallCount()).toBe(1);
        });

        it('should return immediately on 201', async () => {
            const mockFetch = createMockFetch([mockResponse(201)]);

            const res = await fetchWithRetry('http://test', {}, {
                ...FAST_RETRY, _fetch: mockFetch,
            });

            expect(res.status).toBe(201);
            expect(mockFetch.getCallCount()).toBe(1);
        });
    });

    describe('retryable HTTP errors', () => {
        it.each([429, 408, 500, 502, 503, 504])(
            'should retry on %i and succeed when next response is 200',
            async (statusCode) => {
                const mockFetch = createMockFetch([
                    mockResponse(statusCode),
                    mockResponse(200, { recovered: true }),
                ]);

                const res = await fetchWithRetry('http://test', {}, {
                    ...FAST_RETRY, _fetch: mockFetch,
                });

                expect(res.status).toBe(200);
                expect(mockFetch.getCallCount()).toBe(2);
            }
        );

        it('should retry multiple times before succeeding', async () => {
            const mockFetch = createMockFetch([
                mockResponse(429),
                mockResponse(429),
                mockResponse(429),
                mockResponse(200, { result: 'finally' }),
            ]);

            const res = await fetchWithRetry('http://test', {}, {
                ...FAST_RETRY, _fetch: mockFetch,
            });

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ result: 'finally' });
            expect(mockFetch.getCallCount()).toBe(4);
        });

        it('should return last error response when all retries exhausted', async () => {
            const mockFetch = createMockFetch([mockResponse(429)]);

            const res = await fetchWithRetry('http://test', {}, {
                ...FAST_RETRY, maxRetries: 2, _fetch: mockFetch,
            });

            expect(res.status).toBe(429);
            expect(mockFetch.getCallCount()).toBe(3); // 1 initial + 2 retries
        });
    });

    describe('non-retryable HTTP errors', () => {
        it.each([400, 401, 403, 404, 422])(
            'should NOT retry on %i — returns immediately',
            async (statusCode) => {
                const mockFetch = createMockFetch([
                    mockResponse(statusCode, { error: 'client error' }),
                ]);

                const res = await fetchWithRetry('http://test', {}, {
                    ...FAST_RETRY, _fetch: mockFetch,
                });

                expect(res.status).toBe(statusCode);
                expect(mockFetch.getCallCount()).toBe(1);
            }
        );
    });

    describe('network errors', () => {
        it('should retry on network error and succeed', async () => {
            const mockFetch = createMockFetch([
                new Error('ECONNRESET'),
                mockResponse(200, { recovered: true }),
            ]);

            const res = await fetchWithRetry('http://test', {}, {
                ...FAST_RETRY, _fetch: mockFetch,
            });

            expect(res.status).toBe(200);
            expect(mockFetch.getCallCount()).toBe(2);
        });

        it('should throw after exhausting retries on persistent network errors', async () => {
            const mockFetch = createMockFetch([new Error('ECONNREFUSED')]);

            await expect(
                fetchWithRetry('http://test', {}, {
                    ...FAST_RETRY, maxRetries: 1, _fetch: mockFetch,
                })
            ).rejects.toThrow('ECONNREFUSED');

            expect(mockFetch.getCallCount()).toBe(2); // 1 initial + 1 retry
        });
    });

    describe('backoff timing', () => {
        it('should use exponential backoff with increasing delays', async () => {
            const delays = [];
            const originalSetTimeout = global.setTimeout;
            jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
                delays.push(delay);
                return originalSetTimeout(fn, 0); // Execute immediately in tests
            });

            const mockFetch = createMockFetch([
                mockResponse(429),
                mockResponse(429),
                mockResponse(429),
                mockResponse(200),
            ]);

            // Use known seed-like values by fixing Math.random
            jest.spyOn(Math, 'random').mockReturnValue(0.5);

            await fetchWithRetry('http://test', {}, {
                initialDelay: 1000, maxRetries: 4, _fetch: mockFetch,
            });

            // Delays should increase: ~1500, ~2500, ~4500 (base * 2^attempt + jitter)
            expect(delays).toHaveLength(3);
            expect(delays[0]).toBe(1500);  // 1000 * 2^0 + 500
            expect(delays[1]).toBe(2500);  // 1000 * 2^1 + 500
            expect(delays[2]).toBe(4500);  // 1000 * 2^2 + 500

            global.setTimeout.mockRestore();
            Math.random.mockRestore();
        });

        it('should cap delay at maxDelay', async () => {
            const delays = [];
            const originalSetTimeout = global.setTimeout;
            jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
                delays.push(delay);
                return originalSetTimeout(fn, 0);
            });
            jest.spyOn(Math, 'random').mockReturnValue(0);

            const mockFetch = createMockFetch([mockResponse(429)]);

            await fetchWithRetry('http://test', {}, {
                initialDelay: 50000,
                maxDelay: 60000,
                maxRetries: 1,
                _fetch: mockFetch,
            });

            expect(delays[0]).toBe(50000); // 50000 * 2^0 + 0, capped at 60000

            global.setTimeout.mockRestore();
            Math.random.mockRestore();
        });
    });

    describe('configuration', () => {
        it('should respect maxRetries = 0 (no retries)', async () => {
            const mockFetch = createMockFetch([mockResponse(429)]);

            const res = await fetchWithRetry('http://test', {}, {
                ...FAST_RETRY, maxRetries: 0, _fetch: mockFetch,
            });

            expect(res.status).toBe(429);
            expect(mockFetch.getCallCount()).toBe(1);
        });

        it('should respect custom retryableStatusCodes', async () => {
            const mockFetch = createMockFetch([
                mockResponse(418), // "I'm a teapot" — not retryable by default
                mockResponse(200),
            ]);

            const res = await fetchWithRetry('http://test', {}, {
                ...FAST_RETRY, retryableStatusCodes: [418], _fetch: mockFetch,
            });

            expect(res.status).toBe(200);
            expect(mockFetch.getCallCount()).toBe(2);
        });

        it('should pass url and options through to fetch', async () => {
            const capturedArgs = [];
            const mockFetch = async (url, opts) => {
                capturedArgs.push({ url, opts });
                return mockResponse(200);
            };

            await fetchWithRetry('https://api.example.com/v1', { method: 'POST', body: '{}' }, {
                ...FAST_RETRY, _fetch: mockFetch,
            });

            expect(capturedArgs[0].url).toBe('https://api.example.com/v1');
            expect(capturedArgs[0].opts).toEqual({ method: 'POST', body: '{}' });
        });
    });

    describe('mixed error scenarios', () => {
        it('should handle network error → 429 → success', async () => {
            const mockFetch = createMockFetch([
                new Error('ETIMEDOUT'),
                mockResponse(429),
                mockResponse(200, { ok: true }),
            ]);

            const res = await fetchWithRetry('http://test', {}, {
                ...FAST_RETRY, _fetch: mockFetch,
            });

            expect(res.status).toBe(200);
            expect(mockFetch.getCallCount()).toBe(3);
        });
    });

    describe('default parameters', () => {
        it('should use default fetch and parameters when no options provided', async () => {
            const originalSetTimeout = global.setTimeout;
            jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
                return originalSetTimeout(fn, 0);
            });
            await expect(fetchWithRetry('invalid-url')).rejects.toThrow();
            global.setTimeout.mockRestore();
        });
    });
});
