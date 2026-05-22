# Changelog

## [2.0.0] - 2026-05-22

### Features

- Added provider selection support for Gemini, DeepSeek, OpenRouter, and Codex-compatible analysis providers
- Added faster local dictionary, furigana, and Edge TTS-backed pronunciation flows
- Improved contextual AI output with target-language enforcement, word-level explanations, and larger token-limit configuration
- Updated the extension cursor, popup interactions, audio replay behavior, and production packaging flow

### Fixes

- Removed localhost permissions and development hot-reload code from production extension builds
- Hardened user preference persistence, database initialization, privacy copy, and production configuration defaults
- Made furigana tokenizer initialization lazy so server tests and runtime requests do not race background startup work

### Release

- Bumped extension and package metadata to version `2.0.0`
- Refreshed the Chrome Web Store production archive

## [1.2.1] - 2026-03-10

### Features

- Added a resizable and pinnable in-page analysis popup with improved layout handling
- Introduced instant popup auth-state transitions, richer popup animations, and a visible extension version label
- Added auto-play audio support for pronunciations
- Refactored selection handling around `activeSelection` to improve popup interaction flow
- Expanded internationalization support and updated locale message files

### Fixes

- Restored the production backend as the shipped default configuration
- Disabled development mode in shipped production defaults
- Fixed stale avatar state when switching to an account without a profile image
- Included i18n fixes made on this branch

### Release

- Bumped extension and package metadata to version `1.2.1`
- Updated production packaging logic and release documentation to match the current production configuration

## [1.2.0] - 2026-02-28

### Features

- **Internationalization (i18n)**
  - Added multi-language support with locales for English, Japanese, Simplified Chinese, and Traditional Chinese
  - Implemented language selection in settings modal
  - Added native language names to translation language options

- **Dashboard Enhancements**
  - Introduced activity contribution graph with date filtering
  - Added toast notifications for user feedback
  - Implemented settings modal for preferences
  - Auto-save language preferences on selection change
  - Added production build script for extension packaging
  - Enabled word deletion with animated DOM removal

- **AI Analysis Improvements**
  - Implemented streaming AI text analysis via Gemini API with Server-Sent Events (SSE)
  - Added in-memory caching for Gemini API responses
  - Enhanced AI context with page title, URL, and description for improved term interpretation

- **UI/UX Improvements**
  - Replaced native browser confirm with custom delete confirmation modal
  - Refined translation fallback to return empty string

### Configuration & Infrastructure

- Added local development mode with configurable backend URL
- Enforced backend proxy for all AI requests (removed direct Gemini API configuration)
- Configured server-side route for analyze stream
- Added tests for analyze stream route and Gemini service
