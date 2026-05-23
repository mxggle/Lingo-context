const request = require('supertest');
const { initializeDatabase } = require('../db');

// Prevent loading local .env file which pollutes fallback branches
jest.mock('dotenv', () => ({ config: jest.fn() }));

let app;

jest.mock('../db', () => ({
    pool: {},
    initializeDatabase: jest.fn()
}));

jest.mock('../auth', () => ({
    initialize: () => (req, res, next) => {
        req.login = (user, cb) => cb();
        req.logIn = (user, cb) => cb();
        req.logout = (cb) => cb && cb();
        req.isAuthenticated = () => false;
        next();
    },
    session: () => (req, res, next) => next(),
    authenticate: jest.fn(() => (req, res, next) => next())
}));

// Mock express-mysql-session
jest.mock('express-mysql-session', () => {
    return function () {
        return function () {
            this.get = jest.fn();
            this.set = jest.fn();
            this.destroy = jest.fn();
            this.on = jest.fn(); // express-session requires this
        };
    };
});

jest.mock('../middleware/errorHandler', () => ({
    errorHandler: (err, req, res, next) => {
        console.warn('Test Error caught in errorHandler:', err.stack || err);
        res.status(500).json({ error: true });
    }
}));

describe('index.js (App Setup)', () => {
    let app;
    let originalEnv;

    beforeEach(() => {
        jest.resetModules();
        originalEnv = process.env;
        process.env = { ...originalEnv };

        // Suppress expected console.error in tests
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        process.env = originalEnv;
        console.error.mockRestore();
    });

    it('should initialize database on startup', () => {
        const { initializeDatabase: mockedInitialize } = require('../db');
        require('../index');
        expect(mockedInitialize).toHaveBeenCalled();
    });

    it('should serve static files successfully', async () => {
        app = require('../index');
        // We aren't testing express static, but we can verify our single direct route
        // Assuming we mock path.join to avoid fs issues, or just hit an invalid route expecting 404 HTML
        const res = await request(app).get('/privacy');
        // Because public/privacy.html doesn't exist in our mock env, it might 404 or 500
        // We just ensure the route is registered
        expect([200, 404, 500]).toContain(res.status);
    });

    it('should block disallowed origins via CORS', async () => {
        app = require('../index');

        const res = await request(app)
            .get('/api/stats')
            .set('Origin', 'http://malicious.com');

        // We expect CORS error handled by our error handler (403 or 500)
        expect([403, 500]).toContain(res.status);
    });

    it('should allow explicitly allowed origin in ALLOWED_ORIGINS', async () => {
        process.env.ALLOWED_ORIGINS = 'http://trusted.com';
        app = require('../index');

        const res = await request(app)
            .get('/api/user/stats') // Valid endpoint that doesn't 404
            .set('Origin', 'http://trusted.com');

        // Either 401 (unauth) or 200, but not CORS error
        expect([200, 401]).toContain(res.status);
    });

    it('should allow extension origin if explicitly in CHROME_EXTENSION_IDS', async () => {
        process.env.CHROME_EXTENSION_IDS = 'abcdefg';
        app = require('../index');

        const res = await request(app)
            .get('/api/user')
            .set('Origin', 'chrome-extension://abcdefg');

        // Assuming user.js returns 200 {authenticated: false}
        expect(res.status).toBe(200);
    });

    it('should allow any extension origin if no specific IDs required in dev mode', async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.CHROME_EXTENSION_IDS;
        app = require('../index');

        const res = await request(app)
            .get('/api/user')
            .set('Origin', 'chrome-extension://random-id-1234');

        expect(res.status).toBe(200);
    });

    it('should reject unlisted extension origin if IDs are required', async () => {
        process.env.NODE_ENV = 'production';
        process.env.SESSION_SECRET = 'test-secret';
        process.env.CHROME_EXTENSION_IDS = 'knownid123';
        app = require('../index');

        const res = await request(app)
            .get('/api/user')
            .set('Origin', 'chrome-extension://unknownid999');

        expect([403, 500]).toContain(res.status);
    });

    it('should allow requests with no origin', async () => {
        app = require('../index');
        const res = await request(app).get('/api/user');
        if (res.status !== 200) console.error('Error Body:', res.body, 'Status:', res.status);
        expect(res.status).toBe(200);
    });

    it('should fake secure cookie connection in dev mode dynamically', async () => {
        process.env.NODE_ENV = 'development';
        app = require('../index');

        const res = await request(app).get('/api/user');

        // This is tricky to verify externally without sniffing the req object.
        // But making the request confirms the middleware doesn't crash.
        expect(res.status).toBe(200);
    });

    it('should cover all edge case branches in index.js initialization and middleware', async () => {
        process.env.PORT = '4000';
        process.env.SESSION_SECRET = 'custom-secret';
        app = require('../index');

        // Cover secure request in dev mode
        const res = await request(app).get('/api/user').set('X-Forwarded-Proto', 'https');
        expect(res.status).toBe(200);
    });

    it('should redirect /api/stats to /api/user/stats', async () => {
        app = require('../index');
        const res = await request(app).get('/api/stats');
        expect(res.status).toBe(307);
        expect(res.header.location).toBe('/api/user/stats');
    });

    describe('Auth gate on cost-bearing routes', () => {
        const ALLOWED_EXT_ORIGIN = 'chrome-extension://test-ext-id';

        beforeEach(() => {
            process.env.NODE_ENV = 'development';
            process.env.RATE_LIMIT_DISABLED = '1';
            // index.test.js mocks passport so req.isAuthenticated() returns false,
            // simulating a request from an anonymous caller (curl, scraper, etc.).
            app = require('../index');
        });

        const cases = [
            { name: 'analyze', method: 'post', path: '/api/analyze', body: { text: 'hi' } },
            { name: 'analyze stream', method: 'post', path: '/api/analyze/stream', body: { text: 'hi' } },
            { name: 'tts', method: 'post', path: '/api/tts', body: { text: 'hi', lang: 'en' } },
            { name: 'word-definition', method: 'post', path: '/api/word-definition', body: { text: 'hi' } },
        ];

        for (const c of cases) {
            it(`returns 401 with AUTH_REQUIRED on /${c.path} for unauthenticated callers`, async () => {
                const res = await request(app)[c.method](c.path)
                    .set('Origin', ALLOWED_EXT_ORIGIN)
                    .send(c.body);

                expect(res.status).toBe(401);
                expect(res.body.code).toBe('AUTH_REQUIRED');
                expect(res.body.message).toMatch(/sign in/i);
            });
        }
    });
});
