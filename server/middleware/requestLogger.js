// Simple request logger middleware

function requestLogger(req, res, next) {
    const start = Date.now();

    // Hook into res.finish to log after response
    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;

        if (res.statusCode >= 500) {
            console.error(`[REQ] ${log}`);
        } else if (res.statusCode >= 400) {
            console.warn(`[REQ] ${log}`);
        } else {
            console.log(`[REQ] ${log}`);
        }
    });

    next();
}

module.exports = { requestLogger };
