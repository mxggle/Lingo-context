const { ensureAuthenticated, createCsrfMiddleware } = require('../middleware/auth');

describe('auth middleware', () => {
    describe('ensureAuthenticated', () => {
        it('should call next if user is authenticated', () => {
            const req = { isAuthenticated: jest.fn().mockReturnValue(true) };
            const res = {};
            const next = jest.fn();

            ensureAuthenticated(req, res, next);

            expect(req.isAuthenticated).toHaveBeenCalled();
            expect(next).toHaveBeenCalled();
        });

        it('should return 401 if user is not authenticated', () => {
            const req = { isAuthenticated: jest.fn().mockReturnValue(false) };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();

            ensureAuthenticated(req, res, next);

            expect(req.isAuthenticated).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized. Please login.' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('createCsrfMiddleware', () => {
        const isAllowedOrigin = jest.fn((origin) => origin === 'https://allowed.com');
        const csrfMiddleware = createCsrfMiddleware(isAllowedOrigin);

        beforeEach(() => {
            jest.clearAllMocks();
            jest.spyOn(console, 'warn').mockImplementation(() => { });
        });

        afterEach(() => {
            console.warn.mockRestore();
        });

        it('should skip check for GET requests', () => {
            const req = { method: 'GET' };
            const res = {};
            const next = jest.fn();

            csrfMiddleware(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should skip check for HEAD requests', () => {
            const req = { method: 'HEAD' };
            const res = {};
            const next = jest.fn();

            csrfMiddleware(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should skip check for OPTIONS requests', () => {
            const req = { method: 'OPTIONS' };
            const res = {};
            const next = jest.fn();

            csrfMiddleware(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should allow request if origin header matches allowed origin', () => {
            const req = {
                method: 'POST',
                headers: { origin: 'https://allowed.com' }
            };
            const res = {};
            const next = jest.fn();

            csrfMiddleware(req, res, next);

            expect(isAllowedOrigin).toHaveBeenCalledWith('https://allowed.com');
            expect(next).toHaveBeenCalled();
        });

        it('should fallback to referer if origin header is missing', () => {
            const req = {
                method: 'POST',
                headers: { referer: 'https://allowed.com/some/path' }
            };
            const res = {};
            const next = jest.fn();

            csrfMiddleware(req, res, next);

            expect(isAllowedOrigin).toHaveBeenCalledWith('https://allowed.com');
            expect(next).toHaveBeenCalled();
        });

        it('should fail if referer URL parsing throws error and origin missing', () => {
            const req = {
                method: 'POST',
                headers: { referer: 'not-a-valid-url' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();

            csrfMiddleware(req, res, next);

            expect(isAllowedOrigin).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'CSRF Check Failed: Origin not allowed' });
            expect(console.warn).toHaveBeenCalledWith('Blocked CSRF attempt from: Origin=undefined, Referer=not-a-valid-url');
        });

        it('should fail if effective origin is not allowed', () => {
            const req = {
                method: 'POST',
                headers: { origin: 'https://malicious.com' }
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();

            csrfMiddleware(req, res, next);

            expect(isAllowedOrigin).toHaveBeenCalledWith('https://malicious.com');
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'CSRF Check Failed: Origin not allowed' });
            expect(console.warn).toHaveBeenCalledWith('Blocked CSRF attempt from: Origin=https://malicious.com, Referer=undefined');
            expect(next).not.toHaveBeenCalled();
        });

        it('should handle undefined origin and referer safely', () => {
            const req = {
                method: 'POST',
                headers: {}
            };
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            const next = jest.fn();

            csrfMiddleware(req, res, next);

            expect(isAllowedOrigin).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        });
    });
});
