const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = __dirname;
const BUILD_DIR = path.join(PROJECT_ROOT, 'dist-prod');
const ARCHIVE_NAME = 'lingocontext-production.zip';
const ARCHIVE_PATH = path.join(PROJECT_ROOT, ARCHIVE_NAME);

const INCLUDE_PATHS = [
    'manifest.json',
    'background.js',
    'config.js',
    'content.js',
    'dashboard.html',
    'dashboard.js',
    'db-hook.js',
    'i18n.js',
    'popup.html',
    'popup.js',
    'styles.css',
    '_locales',
    'icons',
    'README.md'
];

console.log('Starting production build for Chrome Web Store...');

if (fs.existsSync(BUILD_DIR)) {
    console.log('Cleaning old build directory...');
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
if (fs.existsSync(ARCHIVE_PATH)) {
    fs.unlinkSync(ARCHIVE_PATH);
}

fs.mkdirSync(BUILD_DIR, { recursive: true });

console.log('Copying extension files...');
for (const item of INCLUDE_PATHS) {
    const sourcePath = path.join(PROJECT_ROOT, item);
    const destPath = path.join(BUILD_DIR, item);

    if (fs.existsSync(sourcePath)) {
        const stats = fs.statSync(sourcePath);
        if (stats.isDirectory()) {
            execSync(`cp -R "${sourcePath}" "${BUILD_DIR}"`);
        } else {
            fs.copyFileSync(sourcePath, destPath);
        }
    } else {
        console.warn(`Warning: ${item} not found.`);
    }
}

console.log('Patching config.js for production...');
const configPath = path.join(BUILD_DIR, 'config.js');
let configContent = fs.readFileSync(configPath, 'utf8');

configContent = configContent
    .replace(/DEV_MODE:\s*true/, 'DEV_MODE: false')
    .replace(/BACKEND_URL:\s*'http:\/\/localhost:.*\/api'/, "// BACKEND_URL: 'http://localhost:3000/api'")
    .replace(/\/\/\s*BACKEND_URL:/, 'BACKEND_URL:');

if (configContent.includes('BACKEND_URL:') && !configContent.includes('BACKEND_URL:')) {
    configContent = configContent.replace(/BACKEND_URL:/, '// BACKEND_URL:');
}

fs.writeFileSync(configPath, configContent);

console.log('Creating ZIP archive...');
try {
    execSync(`cd "${BUILD_DIR}" && zip -r -q "../${ARCHIVE_NAME}" ./*`);
    console.log(`Success! Production archive created at: ${ARCHIVE_NAME}`);

    console.log('Cleaning up temporary build directory...');
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
} catch (e) {
    console.error('Failed to create zip archive.', e.message);
    process.exit(1);
}
