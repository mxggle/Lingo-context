const { requestLogger } = require('../middleware/requestLogger');

jest.mock('../logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

const { logger } = require('../logger');

describe('requestLogger middleware', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-01-01T00:00:00.000Z'));
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should log 200 response with logger.info', () => {
        const req = { method: 'GET', originalUrl: '/test', ip: '::1' };
        const res = {
            statusCode: 200,
            on: jest.fn((event, callback) => {
                if (event === 'finish') {
                    jest.advanceTimersByTime(50);
                    callback();
                }
            })
        };
        const next = jest.fn();

        requestLogger(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
        expect(logger.info).toHaveBeenCalledWith({
            method: 'GET',
            url: '/test',
            status: 200,
            duration: 50,
            ip: '::1',
            userAgent: undefined
        });
    });

    it('should log 400 client error with logger.warn', () => {
        const req = { method: 'POST', originalUrl: '/api/data', ip: '::1' };
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

        expect(logger.warn).toHaveBeenCalledWith({
            method: 'POST',
            url: '/api/data',
            status: 404,
            duration: 15,
            ip: '::1',
            userAgent: undefined
        });
    });

    it('should log 500 server error with logger.error', () => {
        const req = { method: 'DELETE', originalUrl: '/api/items/1', ip: '::1' };
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

        expect(logger.error).toHaveBeenCalledWith({
            method: 'DELETE',
            url: '/api/items/1',
            status: 502,
            duration: 120,
            ip: '::1',
            userAgent: undefined
        });
    });
});
