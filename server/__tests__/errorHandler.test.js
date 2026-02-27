const { sendError, errorHandler } = require('../middleware/errorHandler');

describe('errorHandler middleware', () => {
    describe('sendError', () => {
        it('should send standardized error response', () => {
            const res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            sendError(res, 404, 'Not found');

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: true, message: 'Not found' });
        });
    });

    describe('errorHandler', () => {
        let mockReq;
        let mockRes;
        let originalEnv;

        beforeEach(() => {
            jest.spyOn(console, 'error').mockImplementation(() => { });
            mockReq = { method: 'GET', path: '/api/test' };
            mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            originalEnv = process.env.NODE_ENV;
        });

        afterEach(() => {
            console.error.mockRestore();
            process.env.NODE_ENV = originalEnv;
        });

        it('should log error and path', () => {
            const err = new Error('Test error');
            errorHandler(err, mockReq, mockRes, jest.fn());
            expect(console.error).toHaveBeenCalledWith('[Error] GET /api/test:', 'Test error');
        });

        it('should log entire error if err.message missing', () => {
            const err = 'String error';
            errorHandler(err, mockReq, mockRes, jest.fn());
            expect(console.error).toHaveBeenCalledWith('[Error] GET /api/test:', 'String error');
        });

        it('should handle CORS errors with 403', () => {
            const err = new Error('Not allowed by CORS');
            errorHandler(err, mockReq, mockRes, jest.fn());

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: true, message: 'Not allowed by CORS' });
        });

        it('should use error status or statusCode if provided', () => {
            const err = Object.assign(new Error('Custom error'), { status: 400 });
            errorHandler(err, mockReq, mockRes, jest.fn());

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: true, message: 'Custom error' });
        });

        it('should fallback from status to statusCode', () => {
            const err = Object.assign(new Error('Custom error'), { statusCode: 422 });
            errorHandler(err, mockReq, mockRes, jest.fn());

            expect(mockRes.status).toHaveBeenCalledWith(422);
        });

        it('should return default 500 status if no status provided', () => {
            const err = new Error('Random error');
            errorHandler(err, mockReq, mockRes, jest.fn());

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: true, message: 'Random error' });
        });

        it('should mask error message in production mode', () => {
            process.env.NODE_ENV = 'production';
            const err = new Error('Secret database failure details');

            errorHandler(err, mockReq, mockRes, jest.fn());

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: true, message: 'Internal server error' });
        });

        it('should mask error string without err.message safely in dev mode', () => {
            process.env.NODE_ENV = 'development';
            const err = {};

            errorHandler(err, mockReq, mockRes, jest.fn());
            expect(mockRes.json).toHaveBeenCalledWith({ error: true, message: 'Internal server error' });
        });
    });
});
