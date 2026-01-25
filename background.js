// Linguist Pro - Background Service Worker
// Handles Gemini API requests and TTS playback

import { CONFIG, getConfig } from './config.js';
import { saveWord } from './db-hook.js';

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

// Handle Gemini API request
// Handle Gemini API request (via Backend or Direct)
async function handleGeminiRequest(text, context, mode, targetLanguage) {
    const backendUrl = await getConfig('BACKEND_URL');

    // 1. Try Backend Proxy (Preferred)
    if (backendUrl) {
        try {
            const response = await fetch(`${backendUrl}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, context, mode, targetLanguage })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || `Backend Error: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.warn('Backend request failed, falling back to direct API if configured:', error);
            // Fallthrough to direct API
        }
    }

    // 2. Direct API Fallback (Legacy/Dev)
    const apiKey = await getConfig('GEMINI_API_KEY');

    if (!apiKey) {
        return {
            error: true,
            message: 'Please start the backend server or set your Gemini API key in settings'
        };
    }

    const model = await getConfig('GEMINI_MODEL');
    const apiUrl = `${CONFIG.GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;

    const prompt = mode === 'word'
        ? `Analyze this word or short phrase: "${text}"\nContext: "${context}"\nProvide definition, grammar notes, and pronunciation.`
        : `Analyze this sentence or phrase: "${text}"\nContext: "${context}"\nExplain the meaning, grammar structure, and provide pronunciation guide.`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: SYSTEM_INSTRUCTION + '\n\n' + prompt }]
                    }
                ],
                generationConfig: {
                    temperature: 0.3,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1024,
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!content) {
            throw new Error('No response from Gemini');
        }

        // Parse the JSON response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Invalid response format');
        }

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error('Gemini API error:', error);
        return {
            error: true,
            message: error.message
        };
    }
}

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



// Message listener for content script communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ANALYZE_TEXT') {
        handleGeminiRequest(message.text, message.context, message.mode, message.targetLanguage)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ error: true, message: error.message }));
        return true; // Keep channel open for async response
    }

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

console.log('Linguist Pro background service worker loaded');
