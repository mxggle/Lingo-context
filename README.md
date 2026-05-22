# LingoContext 🌐

<p align="center">
  <img src="icons/icon.png" alt="LingoContext logo" width="128" height="128" />
</p>

**LingoContext** is a Chrome extension for language learners that turns selected text on any webpage into a context-aware study card: translation, adaptive explanation, grammar notes, pronunciation, and vocabulary capture in one flow.

It combines AI analysis, fast local Japanese helpers, and a review dashboard so learners can move from “what does this mean?” to “why does it mean that here?” without leaving the page.

![Version](https://img.shields.io/badge/version-1.2.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

- **📖 Context-aware analysis**: Understands selected text using the surrounding sentence and page context instead of translating in isolation.
- **🧠 Adaptive explanations**: Produces richer grammar and word-by-word explanations for shorter selections, while handling longer passages more naturally.
- **⚡ Streaming responses**: Uses server-sent events for responsive AI analysis flows.
- **🤖 Multi-provider AI**: Supports user-selectable **Gemini** and **DeepSeek** analysis providers, with a provider-agnostic backend architecture.
- **🔍 Quick definitions**: Fetches lightweight definitions for selected terms before the full analysis finishes.
- **🎌 Japanese study support**: Generates local furigana for Japanese text and filters ruby annotations down to Kanji where appropriate.
- **🔊 Better pronunciation**: Uses Edge TTS for high-quality audio with browser TTS fallback, plus optional auto-play.
- **🧠 Smart caching**: Caches AI analysis, quick definitions, and TTS audio to reduce repeated latency and token usage.
- **🪟 Refined in-page popup**: Draggable, pinnable, resizable popup UI with contained scrolling and updated cursor-trigger animations.
- **📊 Vocabulary dashboard**: Review saved words, search your collection, inspect usage, and manage preferences.
- **🌍 Internationalization**: Ships with English, Japanese, Simplified Chinese, and Traditional Chinese locales.
- **🔐 Google authentication**: Syncs user data and preferences across sessions.
- **🐳 Docker-ready backend**: Includes a containerized Node.js + MySQL stack for local or self-hosted deployment.

<img width="708" height="411" alt="LingoContext popup" src="https://github.com/user-attachments/assets/3f09385c-e3e7-4797-a26f-5e680fc08500" />
<img width="2148" height="1548" alt="LingoContext dashboard" src="https://github.com/user-attachments/assets/db53c6dd-8116-4bcf-beb2-9a9383c52659" />

## 🛠️ Technology Stack

- **Extension**: Vanilla JavaScript, Chrome Extension Manifest V3
- **Styling**: Tailwind CSS
- **Backend**: Node.js, Express 5, Server-Sent Events
- **Database**: MySQL
- **AI**: Gemini and DeepSeek, behind a pluggable provider layer
- **Speech**: Edge TTS with Web Speech API fallback
- **Japanese processing**: `kuromoji`
- **Deployment**: Docker Compose and Vercel-compatible server configuration

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Docker and Docker Compose
- Google Cloud Console project for OAuth
- At least one AI provider key:
  - `GEMINI_API_KEY`
  - or `DEEPSEEK_API_KEY`

### 1. Installation

```bash
# Install root dependencies
npm install

# Install server dependencies
cd server && npm install && cd ..
```

### 2. Configuration

#### Server (`server/.env`)

Create `server/.env` from the example file and fill in the values you need:

```env
AI_PROVIDER=gemini
AI_MAX_OUTPUT_TOKENS=2048

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-v4-flash

PORT=3303
DATABASE_URL=mysql://user:password@mysql:3306/LingoContext

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SESSION_SECRET=your_random_session_secret
```

Optional provider-related settings such as OpenRouter, Codex-compatible routing, Gemini explicit cache settings, CORS origins, and extension IDs are documented in `server/.env.example`.

#### Extension (`config.js`)

The extension uses `CONFIG.BACKEND_URL` as its API endpoint. For local development, point it at:

```js
http://localhost:3303/api
```

For local development, override `BACKEND_URL` in `chrome.storage.local` or use a temporary local build. The checked-in extension defaults to the hosted backend so store builds are safe by default.

### 3. Run Locally

#### Option A: Full stack with Docker

```bash
docker-compose up --build
```

#### Option B: Manual development

1. Start MySQL locally, or run only the MySQL service:
   ```bash
   docker-compose up mysql -d
   ```
2. Start the backend:
   ```bash
   cd server
   node index.js
   ```
3. Build extension styles:
   ```bash
   npm run build:css
   # or
   npm run watch:css
   ```

### 4. Load the Extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project root folder

## 🖥️ Usage

1. **Sign in** from the popup with Google.
2. **Select text** on any webpage to reveal the custom cursor trigger.
3. **Analyze** the selection to receive translation, grammar/explanation, furigana when relevant, and quick definitions.
4. **Listen** with the speaker control, optionally using auto-play pronunciation.
5. **Save** useful terms to your vocabulary list.
6. **Review** them later in the dashboard, where you can also change target language and AI provider preferences.

## 📦 Packaging for Release

### Quick build

```bash
npm run package
```

Creates the Chrome Web Store-ready `lingocontext-production.zip` in the repository root.

### Production build

```bash
npm run build:prod
```

Creates `lingocontext-production.zip` with production configuration applied.

## 🌐 Chrome Web Store Deployment

### Pre-submission checklist

1. Bump the version in `manifest.json` and `package.json`
2. Test selection flow, popup behavior, dashboard, sign-in, TTS, and provider switching
3. Prepare a privacy policy page
4. Prepare store screenshots
5. Fill in the listing copy and metadata

### Extension permissions

- `storage`: saves user preferences
- `tts`: enables browser text-to-speech fallback
- Host access to the configured backend API

## 📂 Project Structure

```text
.
├── manifest.json              # Chrome extension manifest
├── content.js                 # In-page selection flow and popup UI
├── background.js              # Background worker, streaming bridge, TTS routing
├── popup.html / popup.js      # Login and quick actions
├── dashboard.html / dashboard.js
│                              # Vocabulary dashboard and user preferences
├── icons/                     # Extension icons and cursor assets
├── _locales/                  # Translation files
├── server/                    # Express backend
│   ├── routes/                # Analyze, TTS, furigana, dictionary, auth routes
│   ├── services/              # AI, caching, TTS, furigana, normalization logic
│   └── schema.sql             # Database schema
└── docker-compose.yml         # Local stack orchestration
```

## 📄 License

MIT License.
