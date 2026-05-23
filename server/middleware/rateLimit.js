// Per-user (or per-IP) rate limiting for cost-bearing endpoints.
//
// Defaults are conservative — they should never bother a real human user
// but make abuse of the AI/TTS endpoints economically unattractive.
//
// Override via env:
//   RATE_LIMIT_AI_PER_MIN, RATE_LIMIT_AI_PER_DAY
//   RATE_LIMIT_TTS_PER_MIN
//   RATE_LIMIT_PUBLIC_PER_MIN
//   RATE_LIMIT_DISABLED=1   (turn everything off — useful for tests)

const rateLimit = require('express-rate-limit');

const DISABLED = process.env.RATE_LIMIT_DISABLED === '1';

// Keyed by authenticated user id; falls back to the request IP for
// unauthenticated requests (which the auth gate will already reject,
// but the limiter is mounted before the gate on a couple of routes).
function keyByUserOrIp(req) {
    if (req.user && req.user.id != null) {
        return `u:${req.user.id}`;
    }
    return `ip:${req.ip || 'unknown'}`;
}

function makeLimiter({ windowMs, max, name }) {
    if (DISABLED) {
        return (_req, _res, next) => next();
    }
    return rateLimit({
        windowMs,
        max,
        keyGenerator: keyByUserOrIp,
        standardHeaders: true,
        legacyHeaders: false,
        // Don't double-count if a request bubbles through to multiple limiters
        // on the same window (express-rate-limit increments per-call by default).
        validate: { trustProxy: false },
        handler: (req, res, _next, opts) => {
            const retryAfter = Math.ceil(opts.windowMs / 1000);
            res.set('Retry-After', String(retryAfter));
            res.status(429).json({
                error: 'rate_limited',
                message: `You're sending requests too quickly. Please wait a moment and try again.`,
                code: 'RATE_LIMITED',
                limiter: name,
                retry_after_seconds: retryAfter
            });
        }
    });
}

// AI analysis (expensive) — short-window burst + daily ceiling
const aiPerMinute = makeLimiter({
    name: 'ai_per_minute',
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_AI_PER_MIN) || 30
});

const aiPerDay = makeLimiter({
    name: 'ai_per_day',
    windowMs: 24 * 60 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_AI_PER_DAY) || 1500
});

// TTS audio (Edge TTS bandwidth)
const ttsPerMinute = makeLimiter({
    name: 'tts_per_minute',
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_TTS_PER_MIN) || 60
});

// Public/low-cost endpoints (furigana, dictionary lookup) — keyed by IP
// for unauthenticated callers; just enough to stop scrape loops.
const publicPerMinute = makeLimiter({
    name: 'public_per_minute',
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_PUBLIC_PER_MIN) || 60
});

module.exports = {
    aiPerMinute,
    aiPerDay,
    ttsPerMinute,
    publicPerMinute,
};
