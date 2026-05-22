const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadContentScript() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const pendingMessages = [];
  const audioInstances = [];
  const revokedUrls = [];
  let nextUrlId = 0;

  class FakeAudio {
    constructor(url) {
      this.url = url;
      this.pauseCalls = 0;
      this.playCalls = 0;
      audioInstances.push(this);
    }

    play() {
      this.playCalls += 1;
      return Promise.resolve();
    }

    pause() {
      this.pauseCalls += 1;
    }
  }

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    Blob,
    URL: {
      createObjectURL: () => `blob:audio-${++nextUrlId}`,
      revokeObjectURL: (url) => revokedUrls.push(url)
    },
    Audio: FakeAudio,
    SpeechSynthesisUtterance: class {},
    window: {
      location: { origin: 'https://example.com' },
      getSelection: () => null,
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [],
        addEventListener: () => {},
        speak: () => {}
      }
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
      runtime: {
        getURL: (file) => file,
        sendMessage: (message, callback) => pendingMessages.push({ message, callback })
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { sandbox, pendingMessages, audioInstances, revokedUrls };
}

function makeAudioResponse(text = 'audio') {
  return { audio: Buffer.from(text).toString('base64') };
}

test('starting a new pronunciation stops the currently playing audio', async () => {
  const { sandbox, pendingMessages, audioInstances, revokedUrls } = loadContentScript();

  sandbox.speakText('first', 'en');
  pendingMessages.shift().callback(makeAudioResponse('first'));
  await Promise.resolve();

  assert.equal(audioInstances.length, 1);
  assert.equal(audioInstances[0].playCalls, 1);

  sandbox.speakText('second', 'en');

  assert.equal(audioInstances[0].pauseCalls, 1);
  assert.deepEqual(revokedUrls, ['blob:audio-1']);
});

test('stale async responses cannot start playback after a newer request', async () => {
  const { sandbox, pendingMessages, audioInstances } = loadContentScript();

  sandbox.speakText('first', 'en');
  sandbox.speakText('second', 'en');

  const firstRequest = pendingMessages.shift();
  const secondRequest = pendingMessages.shift();

  secondRequest.callback(makeAudioResponse('second'));
  firstRequest.callback(makeAudioResponse('first'));
  await Promise.resolve();

  assert.equal(audioInstances.length, 1);
  assert.equal(audioInstances[0].playCalls, 1);
});
