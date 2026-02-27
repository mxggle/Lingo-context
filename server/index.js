require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const db = require('./db');
const passport = require('./auth');

// Middleware
const { createCsrfMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');

// Routes
const authRoutes = require('./routes/auth');
const analyzeRoutes = require('./routes/analyze');
const wordsRoutes = require('./routes/words');
const userRoutes = require('./routes/user');

// --- Fail fast if SESSION_SECRET is not set in production ---
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('FATAL: SESSION_SECRET environment variable is required in production');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Trust first proxy (Vercel)

// --- Static files ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// --- CORS ---
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:3000', 'https://lingo-context-api.vercel.app'];

const ALLOWED_EXTENSION_IDS = process.env.CHROME_EXTENSION_IDS
    ? process.env.CHROME_EXTENSION_IDS.split(',').map(id => id.trim())
    : [];

const isAllowedOrigin = (origin) => {
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    if (origin.startsWith('chrome-extension://')) {
        if (ALLOWED_EXTENSION_IDS.length === 0) {
            return process.env.NODE_ENV !== 'production';
        }
        const extensionId = origin.replace('chrome-extension://', '').replace('/', '');
        return ALLOWED_EXTENSION_IDS.includes(extensionId);
    }
    return false;
};

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (isAllowedOrigin(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// --- Core middleware ---
app.use(requestLogger);
app.use(createCsrfMiddleware(isAllowedOrigin));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Secure cookie trick for local dev ---
app.use((req, res, next) => {
    if (process.env.NODE_ENV !== 'production' && !req.secure) {
        Object.defineProperty(req, 'secure', { value: true, writable: false });
        req.headers['x-forwarded-proto'] = 'https';
    }
    next();
});

// --- Session ---
const sessionStore = new MySQLStore({
    clearExpired: true,
    checkExpirationInterval: 900000,
    expiration: 30 * 24 * 60 * 60 * 1000,
    createDatabaseTable: true
}, db.pool);

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'keyboard cat',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        secure: true,
        sameSite: 'none'
    }
}));

// --- Passport ---
app.use(passport.initialize());
app.use(passport.session());

// --- Initialize DB schema ---
db.initializeDatabase();

// --- Routes ---
app.use('/auth', authRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/words', wordsRoutes);
app.use('/api/user', userRoutes);

// Note: /api/stats was previously at /api/stats, now at /api/user/stats
// Add a redirect for backward compatibility
app.get('/api/stats', (req, res) => res.redirect(307, '/api/user/stats'));

// --- Centralized error handler (must be last) ---
app.use(errorHandler);

// --- Start server (local dev only) ---
/* istanbul ignore if */
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Backend server running on http://localhost:${PORT}`);
    });
}

module.exports = app;
