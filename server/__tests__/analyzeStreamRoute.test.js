const request = require('supertest');
const express = require('express');
const analyzeStreamRouter = require('../routes/analyzeStream');
const { analyzeTextStream } = require('../services/geminiStream');
const db = require('../db');

jest.mock('../services/geminiStream', () => ({
    analyzeTextStream: jest.fn()
}));

jest.mock('../db', () => ({
    query: jest.fn()
}));

jest.mock('../middleware/auth', () => ({
    ensureAuthenticated: (req, res, next) => {
        if (req.headers.authorization === 'Bearer valid-token') {
            req.user = { id: 1, target_language: 'French' };
            return next();
        }
        return res.status(401).json({ error: 'Unauthorized. Please login.' });
    }
}));

const app = express();
app.use(express.json());
app.use('/analyze/stream', analyzeStreamRouter);

describe('POST /analyze/stream', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('logs usage when stream returns usage data', async () => {
        analyzeTextStream.mockImplementation(async (_params, res) => {
            res.write('data: {"text":"ok"}\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return {
                model: 'gemini-test',
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
                cost: 0.05
            };
        });
        db.query.mockResolvedValue({});

        const res = await request(app)
            .post('/analyze/stream')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: 'hello' });

        expect(res.status).toBe(200);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO usage_logs'),
            [1, 'gemini-test', 10, 20, 30, 0.05]
        );
    });

    it('does not log usage when stream returns no usage data', async () => {
        analyzeTextStream.mockImplementation(async (_params, res) => {
            res.write('data: {"text":"ok"}\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return null;
        });

        const res = await request(app)
            .post('/analyze/stream')
            .set('Authorization', 'Bearer valid-token')
            .send({ text: 'hello' });

        expect(res.status).toBe(200);
        expect(db.query).not.toHaveBeenCalled();
    });
});
