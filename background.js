// LingoContext - Background Service Worker
// Handles Gemini API requests and TTS playback

import { CONFIG, getConfig } from './config.js';
import { saveWord } from './db-hook.js';

// FORCE RESET CONFIG ON STARTUP if it's localhost (migration fix)
chrome.runtime.onInstalled.addListener(async () => {
    const stored = await chrome.storage.local.get('BACKEND_URL');
    if (stored.BACKEND_URL && stored.BACKEND_URL.includes('localhost')) {
        console.log('Detected localhost config, clearing to force default...');
        await chrome.storage.local.remove('BACKEND_URL');
    }
});

// System instruction for Gemini to return JSON
const SYSTEM_INSTRUCTION = `You are a language learning assistant. Analyze text selections and return ONLY valid JSON in this exact format:
{
  "meaning": "Definition or translation of the text",
  "grammar": "Grammar breakdown or explanation",
  "furigana": "For Japanese text, provide HTML with ruby tags like <ruby>漢字<rt>かんじ</rt></ruby>. For English, return the original text.",
  "audio_text": "Clean text for TTS (no HTML tags, just the pronunciation)",
  "language": "ja or en"
}
Do not include any text outside the JSON object.`;

// Handle Gemini API request (via Backend Streaming)
// Replaced classic handleGeminiRequest with streaming logic inside onConnect listener.

// Play TTS using chrome.tts API
function playFreeTTS(text, lang = 'en') {
    return new Promise((resolve, reject) => {
        // Stop any currently playing speech
        chrome.tts.stop();

        const options = {
            lang: lang === 'ja' ? 'ja-JP' : 'en-US',
            rate: CONFIG.TTS_RATE,
            pitch: CONFIG.TTS_PITCH,
            onEvent: (event) => {
                if (event.type === 'end') {
                    resolve();
                } else if (event.type === 'error') {
                    reject(new Error(event.errorMessage));
                }
            }
        };

        // Try to find a high-quality voice
        chrome.tts.getVoices((voices) => {
            const targetLang = lang === 'ja' ? 'ja' : 'en';
            const preferredVoice = voices.find(v =>
                v.lang?.startsWith(targetLang) &&
                (v.voiceName?.includes('Google') || v.remote)
            );

            if (preferredVoice) {
                options.voiceName = preferredVoice.voiceName;
            }

            chrome.tts.speak(text, options);
        });
    });
}



chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'analyze-stream') {
        port.onMessage.addListener(async (msg) => {
            if (msg.type === 'START_ANALYZE_STREAM') {
                try {
                    const backendUrl = await getConfig('BACKEND_URL');
                    if (!backendUrl) {
                        port.postMessage({ error: true, message: 'Please start the backend server or configure the BACKEND_URL in settings.' });
                        port.disconnect();
                        return;
                    }

                    const response = await fetch(`${backendUrl}/analyze/stream`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            text: msg.text,
                            context: msg.context,
                            mode: msg.mode,
                            targetLanguage: msg.targetLanguage
                        }),
                        credentials: 'include'
                    });

                    if (!response.ok) {
                        const error = await response.json().catch(() => ({}));
                        port.postMessage({ error: true, message: error.message || `Backend Error: ${response.status}` });
                        port.disconnect();
                        return;
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder('utf-8');
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop(); // Keep the incomplete line for the next chunk

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const dataStr = line.replace('data: ', '').trim();
                                if (!dataStr) continue;
                                if (dataStr === '[DONE]') {
                                    port.postMessage({ type: 'DONE' });
                                } else {
                                    try {
                                        const parsed = JSON.parse(dataStr);
                                        if (parsed.error) {
                                            port.postMessage({ error: true, message: parsed.message });
                                        } else if (parsed.text) {
                                            port.postMessage({ type: 'CHUNK', text: parsed.text });
                                        }
                                    } catch (e) {
                                        // Ignore incomplete JSON chunks from split
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    port.postMessage({ error: true, message: error.message || 'Stream connection failed' });
                } finally {
                    port.disconnect();
                }
            }
        });
    }
});

// Message listener for content script communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.type === 'PLAY_TTS') {
        playFreeTTS(message.text, message.lang)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ error: true, message: error.message }));
        return true;
    }

    if (message.type === 'STOP_TTS') {
        chrome.tts.stop();
        sendResponse({ success: true });
    }

    if (message.type === 'SAVE_WORD') {
        saveWord(message.data)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ error: true, message: error.message }));
        return true;
    }

    if (message.type === 'GET_CONFIG') {
        getConfig(message.key)
            .then(value => sendResponse({ value }))
            .catch(error => sendResponse({ error: true, message: error.message }));
        return true;
    }

    if (message.type === 'OPEN_LOGIN') {
        getConfig('BACKEND_URL').then(backendUrl => {
            if (backendUrl) {
                const rootUrl = backendUrl.replace('/api', '');
                chrome.tabs.create({ url: `${rootUrl}/auth/google` });
            } else {
                chrome.tabs.create({ url: 'dashboard.html' });
            }
            sendResponse({ success: true });
        });
        return true;
    }
});

// Hot reload for development
if (CONFIG.DEV_MODE) {
    const HOT_RELOAD_URL = 'http://localhost:35729/events';

    function connectHotReload() {
        try {
            const es = new EventSource(HOT_RELOAD_URL);

            es.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'reload') {
                    console.log('🔄 Hot reload triggered, reloading extension...');
                    chrome.runtime.reload();
                }
            };

            es.onerror = () => {
                es.close();
                // Retry connection after 5 seconds
                setTimeout(connectHotReload, 5000);
            };

            console.log('🔌 Connected to hot reload server');
        } catch (e) {
            console.log('Hot reload server not available');
        }
    }

    connectHotReload();
}

console.log('LingoContext background service worker loaded');
