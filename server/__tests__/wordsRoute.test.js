const request = require('supertest');
const express = require('express');
const wordsRouter = require('../routes/words');
const db = require('../db');

jest.mock('../db', () => ({ query: jest.fn() }));

// Mock standard auth middleware
jest.mock('../middleware/auth', () => ({
    ensureAuthenticated: (req, res, next) => {
        if (req.headers.authorization === 'Bearer valid') {
            req.user = { id: 1 };
            return next();
        }
        return res.status(401).json({ error: 'Unauthorized' });
    }
}));

const app = express();
app.use(express.json());
app.use('/words', wordsRouter);

describe('Words Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /', () => {
        const defaultPayload = {
            text: 'hello',
            meaning: 'hola',
            grammar: 'noun',
            context: 'say hello',
            language: 'English',
            url: 'http://example.com'
        };

        it('should return 401 if unauthenticated', async () => {
            const res = await request(app).post('/words').send(defaultPayload);
            expect(res.status).toBe(401);
        });

        it('should return 400 if text is missing or invalid', async () => {
            const res1 = await request(app)
                .post('/words')
                .set('Authorization', 'Bearer valid')
                .send({ ...defaultPayload, text: undefined });
            expect(res1.status).toBe(400);

            const res2 = await request(app)
                .post('/words')
                .set('Authorization', 'Bearer valid')
                .send({ ...defaultPayload, text: 123 });
            expect(res2.status).toBe(400);

            const res3 = await request(app)
                .post('/words')
                .set('Authorization', 'Bearer valid')
                .send({ ...defaultPayload, text: 'a'.repeat(5001) });
            expect(res3.status).toBe(400);
        });

        it('should handle exactly duplicate word and context (lift)', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ id: 10, lookup_count: 1 }] }) // existing word
                .mockResolvedValueOnce({ rows: [{ id: 100 }] }) // exact duplicate context
                .mockResolvedValueOnce({}); // update word

            const res = await request(app)
                .post('/words')
                .set('Authorization', 'Bearer valid')
                .send(defaultPayload);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, action: 'lifted', id: 10 });
            expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE words SET saved_at = NOW(), lookup_count = lookup_count + 1'), [10]);
        });

        it('should handle existing word with new context (add context)', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ id: 10, lookup_count: 1 }] }) // existing word
                .mockResolvedValueOnce({ rows: [] }) // no duplicate context
                .mockResolvedValueOnce({}) // insert new context
                .mockResolvedValueOnce({}); // update word

            const res = await request(app)
                .post('/words')
                .set('Authorization', 'Bearer valid')
                .send(defaultPayload);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, action: 'context_added', id: 10 });
            expect(db.query).toHaveBeenNthCalledWith(
                3,
                expect.stringContaining('INSERT INTO word_contexts'),
                [10, 'say hello', 'http://example.com']
            );
            expect(db.query).toHaveBeenNthCalledWith(
                4,
                expect.stringContaining('UPDATE words SET saved_at = NOW()'),
                ['hola', 'noun', 10]
            );
        });

        it('should handle completely new word creation', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] }) // word does not exist
                .mockResolvedValueOnce({ rows: { insertId: 99 } }) // insert word
                .mockResolvedValueOnce({}); // insert first context

            const res = await request(app)
                .post('/words')
                .set('Authorization', 'Bearer valid')
                .send(defaultPayload);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, action: 'created', id: 99 });

            expect(db.query).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining('INSERT INTO words'),
                [1, 'hello', 'hola', 'noun', 'English']
            );
            expect(db.query).toHaveBeenNthCalledWith(
                3,
                expect.stringContaining('INSERT INTO word_contexts'),
                [99, 'say hello', 'http://example.com']
            );
        });

        it('should return 500 on db error', async () => {
            db.query.mockRejectedValue(new Error('DB connection failed'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const res = await request(app)
                .post('/words')
                .set('Authorization', 'Bearer valid')
                .send(defaultPayload);

            expect(res.status).toBe(500);
            expect(res.body.error).toBe(true);
            expect(res.body.message).toBe('DB connection failed');

            consoleErrorSpy.mockRestore();
        });
    });

    describe('GET /', () => {
        it('should return 401 if unauthenticated', async () => {
            const res = await request(app).get('/words');
            expect(res.status).toBe(401);
        });

        it('should return empty array if user has no words', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            const res = await request(app)
                .get('/words')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT id, text, meaning, grammar, language, lookup_count, saved_at FROM words WHERE user_id = ? ORDER BY saved_at DESC'),
                [1]
            );
        });

        it('should return words with aggregated contexts', async () => {
            const mockWords = [
                { id: 10, text: 'hello', meaning: 'hola' },
                { id: 20, text: 'world', meaning: 'mundo' }
            ];

            const mockContexts = [
                { id: 101, word_id: 10, context: 'say hello', url: 'A.com', created_at: '2023-01-01' },
                { id: 102, word_id: 10, context: 'hello there', url: 'B.com', created_at: '2023-01-02' },
                { id: 201, word_id: 20, context: 'hello world', url: 'C.com', created_at: '2023-01-03' }
            ];

            db.query
                .mockResolvedValueOnce({ rows: mockWords })
                .mockResolvedValueOnce({ rows: mockContexts });

            const res = await request(app)
                .get('/words')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);

            const word10 = res.body.find(w => w.id === 10);
            expect(word10.contexts).toHaveLength(2);
            expect(word10.contexts[0]).toEqual({
                id: 101, context: 'say hello', url: 'A.com', created_at: '2023-01-01'
            });

            const word20 = res.body.find(w => w.id === 20);
            expect(word20.contexts).toHaveLength(1);
        });

        it('should handle words that have no contexts assigned to them', async () => {
            const mockWords = [
                { id: 99, text: 'lonely', meaning: 'solo' }
            ];

            db.query
                .mockResolvedValueOnce({ rows: mockWords })
                .mockResolvedValueOnce({ rows: [] }); // NO contexts

            const res = await request(app)
                .get('/words')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(200);
            expect(res.body[0].contexts).toEqual([]);
        });

        it('should handle query parameters limit and language', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            await request(app)
                .get('/words?limit=10&language=Spanish')
                .set('Authorization', 'Bearer valid');

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('AND language = ? ORDER BY saved_at DESC LIMIT ?'),
                [1, 'Spanish', 10]
            );
        });

        it('should return 500 on db error', async () => {
            db.query.mockRejectedValue(new Error('DB Error'));

            const res = await request(app)
                .get('/words')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(500);
        });
    });

    describe('DELETE /:id', () => {
        it('should return 401 if unauthenticated', async () => {
            const res = await request(app).delete('/words/10');
            expect(res.status).toBe(401);
        });

        it('should successfully delete word', async () => {
            db.query.mockResolvedValueOnce({ rowCount: 1 });

            const res = await request(app)
                .delete('/words/10')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true });
            expect(db.query).toHaveBeenCalledWith(
                'DELETE FROM words WHERE id = ? AND user_id = ?',
                ['10', 1]
            );
        });

        it('should return 404 if word not found', async () => {
            db.query.mockResolvedValueOnce({ rowCount: 0 });

            const res = await request(app)
                .delete('/words/99')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Word not found');
        });

        it('should return 500 on db error', async () => {
            db.query.mockRejectedValue(new Error('DB Error'));

            const res = await request(app)
                .delete('/words/10')
                .set('Authorization', 'Bearer valid');

            expect(res.status).toBe(500);
        });
    });
});
