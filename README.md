# LingoContext 🌐

**LingoContext** is a powerful Chrome Extension designed for language learners (English/Japanese). It provides instant, context-aware definitions, grammar explanations, and pronunciation guides using Google's **Gemini AI** and browser-native Text-to-Speech.

It comes with a full-featured **Dashboard** to track your vocabulary, view usage statistics, and manage your learning history.

![Version](https://img.shields.io/badge/version-1.2.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

- **📖 Context-Aware Analysis**: Select text to get definitions, translations, and grammar breakdowns based on the surrounding sentence context.
- **🤖 Gemini AI Powered**: utilizes `gemini-2.0-flash-lite` for fast and accurate linguistic analysis.
- **🔊 Native High-Quality TTS**: Uses the browser's built-in text-to-speech engine.
- **🎌 Furigana Support**: automatically generates Ruby text (furigana) for Japanese Kanji.
- **📊 Vocabulary Dashboard**: A dedicated interface to review saved words, search by language, and manage your collection.
- **� Usage Tracking**: Monitors your API usage and token costs.
- **🔐 Google Authentication**: Secure login to sync your data across devices.
- **🐳 Docker Ready**: Full backend stack containerized for easy deployment.
<img width="708" height="411" alt="image" src="https://github.com/user-attachments/assets/3f09385c-e3e7-4797-a26f-5e680fc08500" />
<img width="2148" height="1548" alt="CleanShot 2026-01-25 at 14 10 00@2x" src="https://github.com/user-attachments/assets/db53c6dd-8116-4bcf-beb2-9a9383c52659" />


## 🛠️ Technology Stack

- **Extension**: Vanilla JavaScript (ES Module), Chrome Extension MV3
- **Styling**: TailwindCSS
- **Backend**: Node.js, Express.js
- **Database**: MySQL (via Docker)
- **AI**: Google Gemini API

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- Docker & Docker Compose (for backend)
- Google Cloud Console Project (for OAuth)
- Gemini API Key

### 1. Installation

Clone the repository and install dependencies:

```bash
# Install root dependencies (for Tailwind and Scripts)
npm install

# Install server dependencies
cd server && npm install && cd ..
```

### 2. Configuration

#### Server (.env)

Create a `.env` file in the `server/` directory:

```env
# server/.env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash-lite
PORT=3303
DATABASE_URL=mysql://user:password@localhost:3306/LingoContext
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SESSION_SECRET=your_random_session_secret
```

*Note: For Docker, the `DATABASE_URL` host is automatically handled, but you need to pass these variables in `docker-compose.yml` or a root `.env`.*

#### Extension (config.js)

The extension ships with the production backend URL by default. For local development, override `BACKEND_URL` in `chrome.storage.local` or temporarily update `config.js` to your local API endpoint.

### 3. Running Locally

#### Option A: Full Stack with Docker (Recommended)

This starts both the MySQL database and the Node.js server.

```bash
docker-compose up --build
```

#### Option B: Local Development (Manual)

1. **Start Database**: Ensure you have a MySQL instance running or use `docker-compose up mysql -d`.
2. **Start Server**:
   ```bash
   cd server
   node index.js
   ```
3. **Build CSS**:
   ```bash
   npm run build:css
   # or watch for changes
   npm run watch:css
   ```

### 4. Load Extension in Chrome

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project root folder (`word-cursor` / `lingo-context`).

## 📦 Packaging for Release

### Option 1: Quick Build

```bash
npm run package
```

This creates `extension.zip` in the root directory.

### Option 2: Production Build

```bash
npm run build:prod
```

This creates `lingocontext-production.zip` with all production configurations applied.

## 🌐 Chrome Web Store Deployment

### Pre-submission Checklist

1. **Update Version**: Bump version in `manifest.json` and `package.json`
2. **Test the Extension**:
   - Load unpacked extension in Chrome
   - Test all features: text selection, popup, dashboard, login
3. **Privacy Policy**: Required for store submission
   - Host at: `https://your-domain.com/privacy.html`
   - Include: data collection, storage, third-party services
4. **Screenshots**: Prepare 1-4 screenshots (1280x800 or 640x400)
5. **Store Listing**:
   - Short description: Max 132 characters
   - Long description: Max 10000 characters

### Publishing Steps

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Create new item and upload the `.zip` file
3. Fill in store listing details
4. Submit for review

### Extension Permissions

- `storage`: For saving user preferences
- `tts`: For text-to-speech functionality
- Host access to the production backend API

## 🖥️ Usage

1. **Login**: Click the extension icon and sign in with Google.
2. **Analyze**: Select text on any webpage. A popup will appear with:
   - Meaning & Translation
   - Grammar Breakdown
   - Furigana (for Japanese)
3. **Listen**: Click the Speaker icon 🔊 for pronunciation.
4. **Save**: Click the Save icon 💾 to store it in your dashboard.
5. **Review**: Right-click the extension icon and select "Options", or open the Dashboard from the popup to view your saved vocabulary.

## 📂 Project Structure

```
.
├── manifest.json       # Chrome Extension Manifest
├── content.js          # Main content script (UI injection)
├── background.js       # Background service worker
├── dashboard.html/js   # Vocabulary Manager Dashboard
├── popup.html/js       # Login & Quick Actions
├── styles.css          # Generated Tailwind CSS
├── server/             # Express Backend
│   ├── index.js        # API Routes
│   ├── db.js           # Database Connection
│   └── schema.sql      # Database Schema
└── docker-compose.yml  # Container Orchestration
```

## 📄 License

MIT License.
