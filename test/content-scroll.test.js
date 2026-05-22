const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadContentScript() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    window: {
      location: { origin: 'https://example.com' },
      getSelection: () => null
    },
    document: {
      readyState: 'loading',
      addEventListener: () => {},
      getElementById: () => null,
      createElement: () => ({
        style: {},
        appendChild: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false }
      })
    },
    chrome: {
      storage: { local: { get: () => {}, set: () => {} }, onChanged: { addListener: () => {} } },
      runtime: { getURL: (file) => file, sendMessage: () => {} }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

test('popup contains scroll chaining inside itself', () => {
  const sandbox = loadContentScript();
  const styles = sandbox.getPopupStyles();

  assert.match(styles, /\.popup\s*\{[\s\S]*overscroll-behavior:\s*contain;/);
});

test('popup blocks wheel chaining only when it is already at a scroll boundary', () => {
  const sandbox = loadContentScript();

  assert.equal(sandbox.shouldContainPopupWheel({ scrollTop: 0, clientHeight: 200, scrollHeight: 500 }, -10), true);
  assert.equal(sandbox.shouldContainPopupWheel({ scrollTop: 300, clientHeight: 200, scrollHeight: 500 }, 10), true);
  assert.equal(sandbox.shouldContainPopupWheel({ scrollTop: 120, clientHeight: 200, scrollHeight: 500 }, 10), false);
  assert.equal(sandbox.shouldContainPopupWheel({ scrollTop: 120, clientHeight: 200, scrollHeight: 500 }, -10), false);
});
