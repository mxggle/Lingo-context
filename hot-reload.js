#!/usr/bin/env node

/**
 * Linguist Pro - Hot Reload for Development
 * 
 * This script watches for file changes and triggers extension reload.
 * Run with: npm run dev
 * 
 * Setup:
 * 1. Load the extension in Chrome (chrome://extensions/)
 * 2. Enable "Developer mode"
 * 3. Run this script
 * 4. Changes will auto-reload the extension
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const WATCH_DIR = __dirname;
const PORT = 35729;
const DEBOUNCE_MS = 300;

// Files to watch
const WATCH_EXTENSIONS = ['.js', '.html', '.css', '.json'];
const IGNORE_PATTERNS = [
    'node_modules',
    '.git',
    'package-lock.json',
    'hot-reload.js'
];

// Track connected clients
const clients = new Set();
let debounceTimeout = null;

// Color codes for console
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    dim: '\x1b[2m'
};

// Log with colors
function log(message, color = 'reset') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${colors.dim}[${timestamp}]${colors.reset} ${colors[color]}${message}${colors.reset}`);
}

// Check if file should be watched
function shouldWatch(filename) {
    if (IGNORE_PATTERNS.some(p => filename.includes(p))) {
        return false;
    }
    return WATCH_EXTENSIONS.some(ext => filename.endsWith(ext));
}

// Notify all connected clients
function notifyClients() {
    const message = JSON.stringify({ type: 'reload' });
    clients.forEach(client => {
        try {
            client.write(`data: ${message}\n\n`);
        } catch (e) {
            clients.delete(client);
        }
    });
}

// Handle file changes
function handleChange(eventType, filename) {
    if (!filename || !shouldWatch(filename)) {
        return;
    }

    // Debounce rapid changes
    if (debounceTimeout) {
        clearTimeout(debounceTimeout);
    }

    debounceTimeout = setTimeout(() => {
        log(`File changed: ${filename}`, 'yellow');
        notifyClients();
        log(`Reload triggered (${clients.size} client${clients.size === 1 ? '' : 's'} connected)`, 'green');
    }, DEBOUNCE_MS);
}

// Create SSE server
const server = http.createServer((req, res) => {
    if (req.url === '/events') {
        // SSE endpoint
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        clients.add(res);
        log(`Client connected (${clients.size} total)`, 'cyan');

        req.on('close', () => {
            clients.delete(res);
            log(`Client disconnected (${clients.size} remaining)`, 'dim');
        });

        // Send initial connection message
        res.write('data: {"type": "connected"}\n\n');
    } else if (req.url === '/reload') {
        // Manual reload trigger
        notifyClients();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// Start watching and server
function start() {
    console.log('\n' + colors.bright + colors.cyan + '  📚 Linguist Pro - Hot Reload Server' + colors.reset + '\n');

    // Start server
    server.listen(PORT, () => {
        log(`Server running on http://localhost:${PORT}`, 'green');
        log('Watching for file changes...', 'dim');
        console.log('');
    });

    // Watch directory
    fs.watch(WATCH_DIR, { recursive: true }, handleChange);

    // Handle shutdown
    process.on('SIGINT', () => {
        console.log('\n');
        log('Shutting down...', 'yellow');
        server.close();
        process.exit(0);
    });

    // Print instructions
    console.log(colors.dim + '  ─────────────────────────────────────────────────' + colors.reset);
    console.log(colors.dim + '  To enable hot reload in the extension, add this' + colors.reset);
    console.log(colors.dim + '  to your background.js or inject via content.js:' + colors.reset);
    console.log('');
    console.log(colors.yellow + '  const es = new EventSource("http://localhost:' + PORT + '/events");' + colors.reset);
    console.log(colors.yellow + '  es.onmessage = (e) => {' + colors.reset);
    console.log(colors.yellow + '    if (JSON.parse(e.data).type === "reload") {' + colors.reset);
    console.log(colors.yellow + '      chrome.runtime.reload();' + colors.reset);
    console.log(colors.yellow + '    }' + colors.reset);
    console.log(colors.yellow + '  };' + colors.reset);
    console.log('');
    console.log(colors.dim + '  ─────────────────────────────────────────────────' + colors.reset);
    console.log('');
}

start();
