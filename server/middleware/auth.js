// Authentication & CSRF middleware

// Ensure user is authenticated
const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized. Please login.' });
};

// CSRF Protection for mutating requests
function createCsrfMiddleware(isAllowedOrigin) {
    return (req, res, next) => {
        // Skip for non-mutating methods
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return next();
        }

        const origin = req.headers.origin;
        const referer = req.headers.referer;

        // effectiveOrigin is the origin we validate against
        let effectiveOrigin = origin;
        if (!effectiveOrigin && referer) {
            try {
                effectiveOrigin = new URL(referer).origin;
            } catch (e) {
                // Invalid referer URL
            }
        }

        if (effectiveOrigin && isAllowedOrigin(effectiveOrigin)) {
            return next();
        }

        console.warn(`Blocked CSRF attempt from: Origin=${origin}, Referer=${referer}`);
        return res.status(403).json({ error: 'CSRF Check Failed: Origin not allowed' });
    };
}

module.exports = { ensureAuthenticated, createCsrfMiddleware };
