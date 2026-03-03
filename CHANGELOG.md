# Changelog

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
