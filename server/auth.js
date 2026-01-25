const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('./db');

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const res = await db.query('SELECT * FROM users WHERE id = ?', [id]);
        if (res.rows.length > 0) {
            done(null, res.rows[0]);
        } else {
            done(new Error('User not found'), null);
        }
    } catch (err) {
        done(err, null);
    }
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback',
    scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Check if user exists
        let res = await db.query('SELECT * FROM users WHERE google_id = ?', [profile.id]);

        if (res.rows.length > 0) {
            // Update last login
            await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [res.rows[0].id]);
            return done(null, res.rows[0]);
        } else {
            // Create new user
            const email = profile.emails[0].value;
            const displayName = profile.displayName;
            const avatarUrl = profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null;

            await db.query(
                'INSERT INTO users (google_id, email, display_name, avatar_url) VALUES (?, ?, ?, ?)',
                [profile.id, email, displayName, avatarUrl]
            );
            // MySQL doesn't support RETURNING, so we fetch the inserted user
            res = await db.query('SELECT * FROM users WHERE google_id = ?', [profile.id]);
            return done(null, res.rows[0]);
        }
    } catch (err) {
        return done(err, null);
    }
}));

module.exports = passport;
