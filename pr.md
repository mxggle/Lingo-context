# 📄 Implementation Document: Linguist Pro (Free Tier)

**Project Goal:** A Chrome Extension for English/Japanese learners that provides instant context, grammar, and pronunciation using Gemini and built-in browser TTS.

## 1. Technical Stack

* **AI:** Gemini 1.5 Flash (Fast, generous free tier).
* **TTS:** `chrome.tts` API (Utilizes high-quality system/Google voices for free).
* **Logic:** JavaScript (Manifest V3).
* **UI:** Tailwind CSS (via Shadow DOM to prevent site styling leaks).
* **Database/Auth:** Custom SQL Backend (Developer to implement `POST /save`).

## 2. Core Logic Workflow

### Selection Logic (The "Brain")

* **Trigger:** `window.getSelection()` on `mouseup`.
* **Decision Tree:**
* **Words (≤ 3):** Fetches definition from Jisho API (Japanese) + Gemini for grammar/furigana.
* **Phrases (> 3):** Skips dictionary; sends selection + 150 chars of context to Gemini for analysis.



### Gemini "Context-Aware" Prompt

The developer must use a **System Instruction** to force a JSON response:

> "Analyze the selected text: [TEXT] within context: [CONTEXT].
> Return JSON: { 'meaning': '...', 'grammar': '...', 'furigana': '<ruby>...', 'audio_text': '...' }"

### Free TTS Implementation

Instead of paid APIs, we use `chrome.tts.speak()`.

* **Japanese:** Target voice `ja-JP`.
* **English:** Target voice `en-US` or `en-GB`.
* **Optimization:** Use the `audio_text` from the Gemini response (which removes furigana tags) for the cleanest pronunciation.

---

# 🚀 Pull Request: Linguist-Pro-Scaffold

**Title:** `feat: core-engine-with-gemini-and-free-tts`

## 📝 Summary

Initializes the Manifest V3 architecture. Implements the text selection engine, Gemini API integration, and the free browser-based TTS playback.

## ✨ Key Changes

* **`manifest.json`**: Added `tts`, `storage`, and `contextMenus` permissions.
* **`background.js`**:
* Implemented `handleGeminiRequest()` using the Google Generative AI SDK.
* Added `playFreeTTS()` wrapper using the `chrome.tts` API.


* **`content.js`**:
* Created a "Word vs. Sentence" detector based on word count.
* Injected a **Shadow DOM** popup to ensure the UI looks consistent on every website.


* **`db-hook.js`**: Created a placeholder service to send data to your custom SQL backend.

## 🛠 Developer Notes

* **Furigana:** Gemini is tasked with returning valid HTML `<ruby>` tags for Japanese selections.
* **SQL Integration:** The `saveWord()` function expects a `POST` endpoint. Update the `BACKEND_URL` in `config.js`.
* **Free TTS:** We prioritize "Google Native" voices within the `chrome.tts` engine for the highest quality.

---

## 💻 Core Code Snippet (Selection & TTS)

Here is the logic for the developer to handle the "Free TTS" and Selection threshold:

```javascript
// content.js - Selection Logic
document.onmouseup = () => {
  const selection = window.getSelection().toString().trim();
  if (!selection) return;

  const wordCount = selection.split(/\s+/).length;
  const context = getSurroundingContext(); // Helper to grab ~150 chars

  if (wordCount <= 3) {
    // Word Logic: Dictionary + Gemini
    triggerLookup(selection, context, "word");
  } else {
    // Phrase Logic: Gemini Context only
    triggerLookup(selection, context, "phrase");
  }
};

// background.js - Free TTS Implementation
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PLAY_TTS") {
    chrome.tts.speak(msg.text, {
      lang: msg.lang === 'ja' ? 'ja-JP' : 'en-US',
      rate: 0.9, // Slightly slower for learners
      pitch: 1.0
    });
  }
});

```