const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadContentScript(documentOverrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    window: {
      location: { hostname: 'note.com' },
      getSelection: () => null
    },
    document: {
      readyState: 'loading',
      title: 'AIに任せる時代は終わり?知らないと損する3つの真実｜ryosan💪',
      addEventListener: () => {},
      querySelector: (selector) => {
        if (selector === 'meta[name="description"]') {
          return { content: '「AIに頼めばコードも文章も一瞬で終わる」そう思って満足してないか?実はその使い方、すでに古い。' };
        }
        return null;
      },
      createElement: () => ({ style: {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {}, contains: () => false } }),
      ...documentOverrides
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

function makeSelection(selectedText, fullText) {
  const parent = { tagName: 'P', textContent: fullText };
  return {
    getRangeAt: () => ({
      startContainer: { parentElement: parent }
    }),
    toString: () => selectedText
  };
}

test('word context includes only page title and the sentence containing the selected word', () => {
  const sandbox = loadContentScript();
  const fullText = [
    'ソフトウェアは今、3つ目の時代に突入している。',
    'Vibe Coding(バイブコーディング):AIにざっくり「こんなの作って」と頼んで、出てきたコードを雰囲気で使うスタイル。',
    'スピード重視、多少雑でも動けばOK。'
  ].join('');

  const context = sandbox.getSurroundingContext(makeSelection('Vibe Coding', fullText));

  assert.match(context, /^\[Page Title: AIに任せる時代は終わり\?/);
  assert.ok(context.includes('Vibe Coding(バイブコーディング):AIにざっくり'));
  assert.ok(!context.includes('ソフトウェアは今'));
  assert.ok(!context.includes('スピード重視'));
  assert.ok(!context.includes('[Website:'));
  assert.ok(!context.includes('[Description:'));
  assert.ok(!context.includes('note.com'));
});

test('sentence context includes previous, selected, and next sentences', () => {
  const sandbox = loadContentScript();
  const selectedText = '実はその使い方、すでに古い。';
  const fullText = [
    '「AIに頼めばコードも文章も一瞬で終わる」そう思って満足してないか?',
    selectedText,
    '元Tesla AI責任者が語った本質を伝えるぜ。',
    '明日から仕事の景色が変わる。'
  ].join('');

  const context = sandbox.getSurroundingContext(makeSelection(selectedText, fullText));

  assert.ok(context.includes('そう思って満足してないか?'));
  assert.ok(context.includes(selectedText));
  assert.ok(context.includes('元Tesla AI責任者が語った本質を伝えるぜ。'));
  assert.ok(!context.includes('明日から仕事の景色が変わる。'));
  assert.ok(!context.includes('[Website:'));
  assert.ok(!context.includes('[Description:'));
});

test('furigana sanitizer only allows ruby annotation tags without attributes', () => {
  const sandbox = loadContentScript();

  const sanitized = sandbox.sanitizeFuriganaHtml(
    '<ruby onclick="alert(1)">漢<rt style="color:red">かん</rt></ruby><img src=x onerror=alert(1)>字<script>alert(1)</script>'
  );

  assert.equal(sanitized, '<ruby>漢<rt>かん</rt></ruby>字alert(1)');
  assert.doesNotMatch(sanitized, /onclick|style|img|script|onerror/);
});
