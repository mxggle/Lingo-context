const { logger } = require('../logger');

function requestLogger(req, res, next) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            duration,
            ip: req.ip,
            userAgent: req.get?.('user-agent')
        };

        if (res.statusCode >= 500) {
            logger.error(logData);
        } else if (res.statusCode >= 400) {
            logger.warn(logData);
        } else {
            logger.info(logData);
        }
    });

    next();
}

module.exports = { requestLogger };
