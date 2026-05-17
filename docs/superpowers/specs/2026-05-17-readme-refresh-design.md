# README Refresh Design

## Goal
Bring `README.md` back in sync with the current product so a new reader understands what LingoContext is today, not what it was several releases ago.

## Scope
- Add the current logo near the top of the README using an existing repository asset.
- Refresh the product summary to reflect multi-provider AI support and the broader language-learning workflow.
- Update feature bullets to include the currently implemented capabilities:
  - context-aware analysis
  - adaptive explanations / grammar breakdowns
  - streaming responses
  - Gemini + DeepSeek provider selection
  - quick definitions
  - local furigana generation
  - Edge TTS with browser fallback
  - caching layers
  - resizable / pinnable popup UX
  - dashboard, i18n, authentication, packaging
- Update the technology stack and configuration guidance so it no longer implies Gemini-only operation.
- Fix stale or broken README wording while preserving the current README’s practical developer-oriented structure.

## Non-goals
- Do not turn the README into the long-form architecture article from `ARTICLE.md`.
- Do not introduce new product claims that are not implemented in the repository.
- Do not create new logo assets; reuse the project’s existing icon files.

## Approach
Keep the current README skeleton, but refresh the content section-by-section. Use `icons/icon.png` as the repository-native logo asset because it is the formal extension icon and already appears in the shipped manifest family.

## Verification
- Compare updated README claims against current source files, manifest, and recent commits.
- Ensure the referenced logo path exists.
- Review the final diff for stale Gemini-only language and malformed text.
