const request = require('supertest');
const express = require('express');
const userRouter = require('../routes/user');
const db = require('../db');
const { invalidateCachedUser } = require('../auth');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../auth', () => ({ invalidateCachedUser: jest.fn() }));

// Mock generic ensureAuthenticated middleware
jest.mock('../middleware/auth', () => ({
    ensureAuthenticated: (req, res, next) => {
        if (req.headers.authorization === 'Bearer valid') {
            req.user = { id: 1, target_language: 'Spanish' };
            return next();
        }
        return res.status(401).json({ error: 'Unauthorized' });
    }
}));

const app = express();
app.use(express.json());

// For GET / mock isAuthenticated explicitly
app.use((req, res, next) => {
    req.isAuthenticated = () => req.headers.authorization === 'Bearer valid';
    if (req.isAuthenticated()) req.user = { id: 1, name: 'Test' };
    next();
});

app.use('/user', userRouter);

describe('User Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /', () => {
        it('should return authenticated user data', async () => {
            const res = await request(app)
                .get('/user')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ authenticated: true, user: { id: 1, name: 'Test' } });
        });

        it('should return authenticated: false if not logged in', async () => {
            const res = await request(app).get('/user');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ authenticated: false });
        });
    });

    describe('PATCH /preferences', () => {
        it('should return 401 if unauthenticated', async () => {
            const res = await request(app)
                .patch('/user/preferences')
                .send({ targetLanguage: 'French' });

            expect(res.status).toBe(401);
        });

        it('should return 400 if targetLanguage is missing', async () => {
            const res = await request(app)
                .patch('/user/preferences')
                .set('Authorization', 'Bearer valid')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('targetLanguage is required');
        });

        it('should update preferences, update session, invalidate cache, and return success', async () => {
            db.query.mockResolvedValue({});

            const res = await request(app)
                .patch('/user/preferences')
                .set('Authorization', 'Bearer valid')
                .send({ targetLanguage: 'French' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, targetLanguage: 'French' });

            expect(db.query).toHaveBeenCalledWith(
                'UPDATE users SET target_language = ? WHERE id = ?',
                ['French', 1]
            );
            expect(invalidateCachedUser).toHaveBeenCalledWith(1);
        });

        it('should return 500 on db error', async () => {
            db.query.mockRejectedValue(new Error('DB connection failed'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const res = await request(app)
                .patch('/user/preferences')
                .set('Authorization', 'Bearer valid')
                .send({ targetLanguage: 'French' });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('DB connection failed');

            consoleErrorSpy.mockRestore();
        });
    });

    describe('GET /stats', () => {
        it('should return 401 if unauthenticated', async () => {
            const res = await request(app).get('/user/stats');
            expect(res.status).toBe(401);
        });

        it('should successfully fetch usage and storage stats', async () => {
            const mockUsage = { total_requests: 10, total_tokens: 500, total_cost: 0.02 };
            const mockWords = { saved_words: 5 };

            db.query.mockResolvedValueOnce({ rows: [mockUsage] }); // Usage stats
            db.query.mockResolvedValueOnce({ rows: [mockWords] }); // Word stats

            const res = await request(app)
                .get('/user/stats')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ usage: mockUsage, storage: mockWords });
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        it('should return 500 on db error', async () => {
            db.query.mockRejectedValue(new Error('DB disconnected'));

            const res = await request(app)
                .get('/user/stats')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(500);
        });
    });
});
