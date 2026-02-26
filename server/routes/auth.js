// Auth routes — OAuth, success page, logout
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const passport = require('../auth');

// Load the auth success HTML template once at startup
const successTemplate = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'auth-success.html'),
    'utf8'
);

// Google OAuth entry point
router.get('/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback
router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/login_failed' }),
    (req, res) => {
        res.redirect('/auth/success');
    }
);

// Success page — serves HTML with user data for extension to pick up
router.get('/success', (req, res) => {
    const user = req.isAuthenticated() ? req.user : null;
    const userData = user ? JSON.stringify({
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url
    }) : 'null';

    // Inject user data into template (HTML-attribute safe)
    const html = successTemplate.replace('__USER_DATA__', userData.replace(/'/g, '&#39;').replace(/"/g, '&quot;'));
    res.send(html);
});

// Logout
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.json({ success: true });
    });
});

module.exports = router;
