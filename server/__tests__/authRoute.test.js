const request = require('supertest');
const express = require('express');
const authRouter = require('../routes/auth');
const fs = require('fs');

// Mock Passport middleware entirely
jest.mock('../auth', () => ({
    authenticate: jest.fn((strategy, options) => {
        return (req, res, next) => {
            if (strategy === 'google') {
                if (req.query.fail === 'true') {
                    return res.redirect(options.failureRedirect);
                }
                // simulate successful passport auth callback
                req.user = { id: 1, email: 'test@example.com', display_name: 'Test User', avatar_url: 'avatar.png' };
                req.isAuthenticated = () => true;
                return next();
            }
            return next();
        };
    })
}));

const app = express();
app.use(express.json());

// Middleware to mock req.logout for testing /logout
app.use((req, res, next) => {
    req.logIn = (user, cb) => cb(); // Mock req.login
    req.login = (user, cb) => cb(); // Alias
    req.logout = (cb) => {
        if (req.query.fail_logout === 'true') {
            return cb(new Error('Logout failed'));
        }
        cb && cb();
    };
    req.isAuthenticated = () => req.headers.authorization === 'Bearer valid';
    if (req.isAuthenticated()) {
        req.user = { id: 1, email: 'test@example.com', display_name: 'Test User', avatar_url: 'avatar.png' };
    }
    next();
});

// We remove the fs.readFileSync mock so it can read the actual HTML template from views

app.use('/auth', authRouter);

describe('Auth Routes', () => {
    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('GET /auth/google', () => {
        it('should pass through passport.authenticate (mocked)', async () => {
            const res = await request(app).get('/auth/google');
            // Our mock just calls next(), express replies with 404 implicitly on GET without a response
            // but we mainly care it invoked the mocked passport.authenticate
            expect(res.status).toBe(404);
        });
    });

    describe('GET /auth/google/callback', () => {
        it('should redirect to /auth/success on successful auth', async () => {
            const res = await request(app).get('/auth/google/callback');
            // Our passport mock sets req.user and calls next()
            // Then the route handler does res.redirect('/auth/success');
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe('/auth/success');
        });

        it('should redirect to failureRedirect if auth fails', async () => {
            const res = await request(app).get('/auth/google/callback?fail=true');
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe('/login_failed');
        });
    });

    describe('GET /auth/success', () => {
        it('should return HTML with user data if authenticated', async () => {
            const res = await request(app)
                .get('/auth/success')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(200);
            expect(res.text).toContain('data-user="{&quot;id&quot;:1,&quot;email&quot;:&quot;test@example.com&quot;,&quot;display_name&quot;:&quot;Test User&quot;,&quot;avatar_url&quot;:&quot;avatar.png&quot;}"');
        });

        it('should return HTML with "null" if not authenticated', async () => {
            const res = await request(app).get('/auth/success');

            expect(res.status).toBe(200);
            expect(res.text).toContain('data-user="null"');
        });
    });
});

describe('GET /auth/logout', () => {
    it('should successfully log out and return success', async () => {
        const res = await request(app).get('/auth/logout');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
    });

    it('should handle logout errors', async () => {
        const appWithErrorMw = express();
        appWithErrorMw.use((req, res, next) => {
            req.logout = (cb) => cb(new Error('Logout failed'));
            next();
        });
        appWithErrorMw.use('/auth', authRouter);

        const res = await request(appWithErrorMw).get('/auth/logout');
        // Express default error handler catches it if we don't handle it
        expect(res.status).toBe(500);
    });
});
