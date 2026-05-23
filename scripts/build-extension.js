const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(PROJECT_ROOT, 'dist-prod');
const ARCHIVE_NAME = 'lingocontext-production.zip';
const ARCHIVE_PATH = path.join(PROJECT_ROOT, 'releases', ARCHIVE_NAME);

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
    'icons'
];

function sanitizeManifestForProduction(manifest) {
    return {
        ...manifest,
        host_permissions: (manifest.host_permissions || []).filter(permission => !permission.includes('localhost'))
    };
}

function patchConfigForProduction(configContent) {
    return configContent
    .replace(/DEV_MODE:\s*true/, 'DEV_MODE: false')
    .replace(/^\s*BACKEND_URL:\s*["']http:\/\/localhost:3303\/api["'],?\s*\n?/m, '');
}

function ensureProductionBackend(configContent) {
    if (/^\s*BACKEND_URL:\s*["']https:\/\/lingo-context-api\.vercel\.app\/api["']/m.test(configContent)) {
        return configContent;
    }

    return configContent.replace(
        /\/\/\s*BACKEND_URL:\s*["']https:\/\/lingo-context-api\.vercel\.app\/api["']/,
        'BACKEND_URL: "https://lingo-context-api.vercel.app/api"'
    );
}

function patchBackgroundForProduction(backgroundContent) {
    const marker = '// Hot reload for development';
    const markerIndex = backgroundContent.indexOf(marker);
    if (markerIndex === -1) {
        return backgroundContent;
    }

    const blockStart = backgroundContent.indexOf('if (CONFIG.DEV_MODE)', markerIndex);
    if (blockStart === -1) {
        return backgroundContent.replace(marker, '').replace(/\n{3,}/g, '\n\n');
    }

    const openingBrace = backgroundContent.indexOf('{', blockStart);
    if (openingBrace === -1) {
        return backgroundContent;
    }

    let depth = 0;
    let blockEnd = -1;
    for (let i = openingBrace; i < backgroundContent.length; i++) {
        if (backgroundContent[i] === '{') depth++;
        if (backgroundContent[i] === '}') depth--;
        if (depth === 0) {
            blockEnd = i + 1;
            break;
        }
    }

    if (blockEnd === -1) {
        return backgroundContent;
    }

    return `${backgroundContent.slice(0, markerIndex)}${backgroundContent.slice(blockEnd)}`.replace(/\n{3,}/g, '\n\n');
}

function validateProductionBuild(buildDir) {
    const manifestPath = path.join(buildDir, 'manifest.json');
    const configPath = path.join(buildDir, 'config.js');
    const backgroundPath = path.join(buildDir, 'background.js');
    const requiredAssets = [
        manifestPath,
        configPath,
        backgroundPath,
        path.join(buildDir, 'icons', 'cursor.png')
    ];

    for (const assetPath of requiredAssets) {
        if (!fs.existsSync(assetPath)) {
            throw new Error(`Missing required production asset: ${path.relative(buildDir, assetPath)}`);
        }
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if ((manifest.host_permissions || []).some(permission => permission.includes('localhost'))) {
        throw new Error('Production manifest must not include localhost host permissions');
    }

    const configContent = fs.readFileSync(configPath, 'utf8');
    if (!configContent.includes('BACKEND_URL: "https://lingo-context-api.vercel.app/api"')) {
        throw new Error('Production config must use the hosted backend URL');
    }

    const backgroundContent = fs.readFileSync(backgroundPath, 'utf8');
    if (/HOT_RELOAD_URL|EventSource|connectHotReload/.test(backgroundContent)) {
        throw new Error('Production background worker must not include development hot reload code');
    }
}

function buildProductionArchive() {
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

    console.log('Patching manifest.json for production...');
    const manifestPath = path.join(BUILD_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, `${JSON.stringify(sanitizeManifestForProduction(manifest), null, 4)}\n`);

    console.log('Patching config.js for production...');
    const configPath = path.join(BUILD_DIR, 'config.js');
    let configContent = fs.readFileSync(configPath, 'utf8');
    configContent = ensureProductionBackend(patchConfigForProduction(configContent));
    fs.writeFileSync(configPath, configContent);

    console.log('Patching background.js for production...');
    const backgroundPath = path.join(BUILD_DIR, 'background.js');
    const backgroundContent = fs.readFileSync(backgroundPath, 'utf8');
    fs.writeFileSync(backgroundPath, patchBackgroundForProduction(backgroundContent));

    console.log('Validating production build...');
    validateProductionBuild(BUILD_DIR);

    console.log('Creating ZIP archive...');
    try {
        execSync(`cd "${BUILD_DIR}" && zip -r -q "../releases/${ARCHIVE_NAME}" ./*`);
        console.log(`Success! Production archive created at: releases/${ARCHIVE_NAME}`);

        console.log('Cleaning up temporary build directory...');
        fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    } catch (e) {
        console.error('Failed to create zip archive.', e.message);
        process.exit(1);
    }
}

if (require.main === module) {
    buildProductionArchive();
}

module.exports = {
    sanitizeManifestForProduction,
    patchConfigForProduction: (configContent) => ensureProductionBackend(patchConfigForProduction(configContent)),
    patchBackgroundForProduction,
    validateProductionBuild,
    buildProductionArchive
};
