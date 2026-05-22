const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  sanitizeManifestForProduction,
  patchConfigForProduction,
  patchBackgroundForProduction,
  validateProductionBuild
} = require('../build-extension');

test('checked-in extension manifest does not request localhost access', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

  assert.deepEqual(manifest.host_permissions, ['https://lingo-context-api.vercel.app/*']);
});

test('checked-in extension config defaults to hosted production backend', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');

  assert.match(config, /BACKEND_URL:\s*"https:\/\/lingo-context-api\.vercel\.app\/api"/);
  assert.doesNotMatch(config, /BACKEND_URL:\s*"http:\/\/localhost:3303\/api"/);
});

test('removes localhost host permissions from production manifest', () => {
  const manifest = {
    host_permissions: [
      'https://lingo-context-api.vercel.app/*',
      'http://localhost:*/*'
    ]
  };

  const result = sanitizeManifestForProduction(manifest);

  assert.deepEqual(result.host_permissions, ['https://lingo-context-api.vercel.app/*']);
});

test('patches config to the hosted production backend', () => {
  const source = 'BACKEND_URL: "http://localhost:3303/api",\n// BACKEND_URL: "https://lingo-context-api.vercel.app/api",\nDEV_MODE: true,';

  const result = patchConfigForProduction(source);

  assert.match(result, /BACKEND_URL: "https:\/\/lingo-context-api\.vercel\.app\/api"/);
  assert.doesNotMatch(result, /BACKEND_URL: "http:\/\/localhost:3303\/api"/);
  assert.match(result, /DEV_MODE: false/);
});

test('removes development hot reload code from production background worker', () => {
  const source = `
console.log('before');
// Hot reload for development
if (CONFIG.DEV_MODE) {
    const HOT_RELOAD_URL = 'http://localhost:35729/events';
    function connectHotReload() {}
    connectHotReload();
}

console.log('after');
`;

  const result = patchBackgroundForProduction(source);

  assert.match(result, /console\.log\('before'\);/);
  assert.match(result, /console\.log\('after'\);/);
  assert.doesNotMatch(result, /localhost/);
  assert.doesNotMatch(result, /EventSource|HOT_RELOAD_URL|connectHotReload/);
});

test('rejects a build directory that is missing required production assets', () => {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-build-'));
  fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify({ host_permissions: ['https://lingo-context-api.vercel.app/*'] }));
  fs.writeFileSync(path.join(tempDir, 'config.js'), 'BACKEND_URL: "https://lingo-context-api.vercel.app/api";');
  fs.writeFileSync(path.join(tempDir, 'background.js'), "console.log('production');");

  assert.throws(() => validateProductionBuild(tempDir), /icons\/cursor\.png/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
