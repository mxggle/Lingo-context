const request = require('supertest');
const express = require('express');
const analyzeRouter = require('../routes/analyze');
const { analyzeText } = require('../services/gemini');
const db = require('../db');

jest.mock('../services/gemini', () => ({
    analyzeText: jest.fn()
}));

jest.mock('../db', () => ({
    query: jest.fn()
}));

// Mock authentication middleware
jest.mock('../middleware/auth', () => ({
    ensureAuthenticated: (req, res, next) => {
        if (req.headers.authorization === 'Bearer valid-token') {
            req.user = { id: 1, target_language: 'French' };
            return next();
        }
        if (req.headers.authorization === 'Bearer valid-token-no-lang') {
            req.user = { id: 2 }; // No target_language
            return next();
        }
        return res.status(401).json({ error: 'Unauthorized. Please login.' });
    }
}));

const app = express();
app.use(express.json());
app.use('/analyze', analyzeRouter);

describe('POST /analyze', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return 401 if unauthenticated', async () => {
        const res = await request(app)
            .post('/analyze')
            .send({ text: 'hello' });

        expect(res.status).toBe(401);
    });

    it('should return 400 if text is missing or not a string', async () => {
        const res1 = await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token')
            .send({});

        expect(res1.status).toBe(400);
        expect(res1.body.error).toBe(true);

        const res2 = await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: 123 });

        expect(res2.status).toBe(400);
    });

    it('should return 400 if text is over 5000 characters', async () => {
        const longText = 'a'.repeat(5001);
        const res = await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: longText });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('5000 characters or fewer');
    });

    it('should use targetLanguage from request over user preference', async () => {
        analyzeText.mockResolvedValue({
            result: { meaning: 'hola' },
            usage: { model: 'test', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.1 }
        });
        db.query.mockResolvedValue({});

        await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: 'hello', targetLanguage: 'Spanish' });

        expect(analyzeText).toHaveBeenCalledWith({
            text: 'hello',
            context: undefined,
            targetLanguage: 'Spanish' // Should use from req.body
        });
    });

    it('should use user preference if targetLanguage not in request', async () => {
        analyzeText.mockResolvedValue({
            result: { meaning: 'bonjour' },
            usage: { model: 'test', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.1 }
        });
        db.query.mockResolvedValue({});

        await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: 'hello' });

        expect(analyzeText).toHaveBeenCalledWith({
            text: 'hello',
            context: undefined,
            targetLanguage: 'French' // Should use from req.user
        });
    });

    it('should fallback to English if neither request nor user specify target language', async () => {
        analyzeText.mockResolvedValue({
            result: { meaning: 'bonjour' },
            usage: { model: 'test', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.1 }
        });
        db.query.mockResolvedValue({});

        await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token-no-lang')
            .send({ text: 'hello' });

        expect(analyzeText).toHaveBeenCalledWith({
            text: 'hello',
            context: undefined,
            targetLanguage: 'English' // Fallback to English
        });
    });

    it('should successfully analyze text and log usage', async () => {
        const mockResult = { meaning: 'bonjour' };
        const mockUsage = { model: 'test-model', promptTokens: 10, completionTokens: 20, totalTokens: 30, cost: 0.05 };

        analyzeText.mockResolvedValue({
            result: mockResult,
            usage: mockUsage
        });
        db.query.mockResolvedValue({});

        const res = await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: 'hello' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual(mockResult);

        // Check usage logging
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO usage_logs'),
            [1, 'test-model', 10, 20, 30, 0.05]
        );
    });

    it('should succeed even if db usage logging fails', async () => {
        analyzeText.mockResolvedValue({
            result: { meaning: 'bonjour' },
            usage: { model: 'test', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.1 }
        });
        // Mock db failure
        db.query.mockRejectedValue(new Error('DB connection failed'));

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const res = await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: 'hello' });

        expect(res.status).toBe(200);
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to log usage:', expect.any(Error));

        consoleErrorSpy.mockRestore();
    });

    it('should return errors from analyzeText with correct status code', async () => {
        const error = new Error('AI busy');
        error.status = 429;
        analyzeText.mockRejectedValue(error);

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const res = await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: 'hello' });

        expect(res.status).toBe(429);
        expect(res.body.message).toBe('AI busy');
        expect(res.body.error).toBe(true);

        consoleErrorSpy.mockRestore();
    });

    it('should return 500 if error status not specified', async () => {
        const error = new Error('Generic failure');
        analyzeText.mockRejectedValue(error);

        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const res = await request(app)
            .post('/analyze')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: 'hello' });

        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Generic failure');

        consoleErrorSpy.mockRestore();
    });
});
