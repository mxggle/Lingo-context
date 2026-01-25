# Linguist Pro

A Chrome Extension for English/Japanese learners that provides instant context, grammar, and pronunciation using Gemini AI and browser TTS.

## Features

- 📖 **Smart Selection Detection**: Words (≤3) get dictionary lookup, phrases get contextual analysis
- 🤖 **Gemini AI Integration**: Context-aware grammar and meaning explanations
- 🔊 **Free TTS**: Uses Chrome's built-in text-to-speech with high-quality voices
- 🎌 **Japanese Support**: Furigana (ruby text) for kanji readings
- 💾 **Word Saving**: Save words to your custom backend (optional)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Load Extension in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `word-cursor` folder

### 3. Configure API Key

1. Click the extension icon in Chrome toolbar
2. Enter your [Gemini API key](https://makersuite.google.com/app/apikey)
3. Click "Save Settings"

## Development with Hot Reload

Start the hot reload server:

```bash
npm run dev
```

The extension will automatically reload when you modify any `.js`, `.html`, `.css`, or `.json` file.

## Usage

1. Select any text on a webpage
2. A popup appears with:
   - **Meaning**: Definition or translation
   - **Grammar**: Grammar breakdown
   - **Furigana**: Ruby text for Japanese
3. Click 🔊 to hear pronunciation
4. Click 💾 to save the word (requires backend configuration)

## File Structure

```
word-cursor/
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker (Gemini API + TTS)
├── content.js         # Selection detection + popup UI
├── config.js          # Configuration settings
├── popup.html/js      # Extension popup (settings)
├── db-hook.js         # Backend integration placeholder
├── hot-reload.js      # Development hot reload server
├── styles.css         # Minimal styles (Shadow DOM handles popup)
└── icons/             # Extension icons
```

## Configuration

Edit `config.js` to customize:

- `GEMINI_API_KEY`: Your Gemini API key
- `GEMINI_MODEL`: Model to use (default: gemini-1.5-flash)
- `BACKEND_URL`: Your backend endpoint for saving words
- `TTS_RATE`: Speech rate (0.9 = slightly slower)
- `WORD_THRESHOLD`: Max words for "word mode" (default: 3)

## Backend Integration

To save words to your database, implement a POST endpoint that accepts:

```json
{
  "text": "selected text",
  "meaning": "definition",
  "grammar": "grammar notes",
  "context": "surrounding text",
  "language": "ja",
  "url": "source URL",
  "savedAt": "ISO timestamp"
}
```

Set your endpoint URL in the extension settings.

## License

MIT
