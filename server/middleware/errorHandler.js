// Centralized error handling middleware

// Standardized error response helper (can be used in routes)
function sendError(res, status, message) {
    return res.status(status).json({ error: true, message });
}

// Express error handler (must have 4 args to be recognized as error middleware)
function errorHandler(err, req, res, _next) {
    console.error(`[Error] ${req.method} ${req.path}:`, err.message || err);

    // CORS errors
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({ error: true, message: 'Not allowed by CORS' });
    }

    // Default server error
    const status = err.status || err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message || 'Internal server error';

    return res.status(status).json({ error: true, message });
}

module.exports = { sendError, errorHandler };
