const { requestLogger } = require('../middleware/requestLogger');

describe('requestLogger middleware', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should log 200 response with console.log', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

        const req = { method: 'GET', originalUrl: '/test' };
        const res = {
            statusCode: 200,
            on: jest.fn((event, callback) => {
                if (event === 'finish') {
                    // Advance time by 50ms before triggering the finish event
                    jest.advanceTimersByTime(50);
                    callback();
                }
            })
        };
        const next = jest.fn();

        requestLogger(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
        expect(consoleSpy).toHaveBeenCalledWith('[REQ] GET /test 200 50ms');

        consoleSpy.mockRestore();
    });

    it('should log 400 client error with console.warn', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

        const req = { method: 'POST', originalUrl: '/api/data' };
        const res = {
            statusCode: 404,
            on: jest.fn((event, callback) => {
                if (event === 'finish') {
                    jest.advanceTimersByTime(15);
                    callback();
                }
            })
        };
        const next = jest.fn();

        requestLogger(req, res, next);

        expect(warnSpy).toHaveBeenCalledWith('[REQ] POST /api/data 404 15ms');
        warnSpy.mockRestore();
    });

    it('should log 500 server error with console.error', () => {
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const req = { method: 'DELETE', originalUrl: '/api/items/1' };
        const res = {
            statusCode: 502,
            on: jest.fn((event, callback) => {
                if (event === 'finish') {
                    jest.advanceTimersByTime(120);
                    callback();
                }
            })
        };
        const next = jest.fn();

        requestLogger(req, res, next);

        expect(errSpy).toHaveBeenCalledWith('[REQ] DELETE /api/items/1 502 120ms');
        errSpy.mockRestore();
    });
});
