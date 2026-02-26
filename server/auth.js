const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('./db');

// --- Simple in-memory session cache to avoid DB hits on every request ---
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const sessionCache = new Map();

function getCachedUser(id) {
    const entry = sessionCache.get(id);
    if (entry && Date.now() - entry.timestamp < SESSION_CACHE_TTL) {
        return entry.user;
    }
    sessionCache.delete(id);
    return null;
}

function setCachedUser(id, user) {
    sessionCache.set(id, { user, timestamp: Date.now() });
    // Prevent unbounded growth — evict oldest entries if cache gets too large
    if (sessionCache.size > 1000) {
        const firstKey = sessionCache.keys().next().value;
        sessionCache.delete(firstKey);
    }
}

function invalidateCachedUser(id) {
    sessionCache.delete(id);
}

// --- Passport serialization ---
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        // Check cache first
        const cached = getCachedUser(id);
        if (cached) {
            return done(null, cached);
        }

        const res = await db.query('SELECT id, email, display_name, avatar_url, target_language, last_login FROM users WHERE id = ?', [id]);
        if (res.rows.length > 0) {
            setCachedUser(id, res.rows[0]);
            done(null, res.rows[0]);
        } else {
            done(new Error('User not found'), null);
        }
    } catch (err) {
        done(err, null);
    }
});

// --- Google OAuth Strategy ---
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.BASE_URL ? `${process.env.BASE_URL}/auth/google/callback` : '/auth/google/callback',
    scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let res = await db.query('SELECT id, email, display_name, avatar_url, target_language, last_login FROM users WHERE google_id = ?', [profile.id]);

        if (res.rows.length > 0) {
            await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [res.rows[0].id]);
            invalidateCachedUser(res.rows[0].id); // Bust cache after login update
            return done(null, res.rows[0]);
        } else {
            const email = profile.emails[0].value;
            const displayName = profile.displayName;
            const avatarUrl = profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null;

            await db.query(
                'INSERT INTO users (google_id, email, display_name, avatar_url) VALUES (?, ?, ?, ?)',
                [profile.id, email, displayName, avatarUrl]
            );
            res = await db.query('SELECT id, email, display_name, avatar_url, target_language, last_login FROM users WHERE google_id = ?', [profile.id]);
            return done(null, res.rows[0]);
        }
    } catch (err) {
        return done(err, null);
    }
}));

module.exports = passport;
// Export cache utils for use in routes that update user data
module.exports.invalidateCachedUser = invalidateCachedUser;
