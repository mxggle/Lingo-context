# Chrome Web Store Readiness Hardening Design

## Goal
Prepare the extension for a safer Chrome Web Store submission without changing the user-facing product flow.

## Scope
- Align privacy-policy language with the data the product already handles.
- Ensure production packaging removes development-only host access and validates release artifacts.
- Restore trust in the existing test suite by fixing stale tests that no longer reflect current implementation.
- Add focused regression coverage around release packaging rules.

## Non-goals
- No redesign of the popup, dashboard, auth flow, AI flow, vocabulary flow, or TTS behavior.
- No broad refactor of extension architecture.
- No new product capabilities.

## Approach
1. Treat store-readiness issues as boundary hardening rather than feature work.
2. Keep current runtime behavior intact; prefer build-time transforms and tests over in-product changes.
3. Update documentation only where current behavior is under-described.
4. Fix tests to match intended current behavior, and only change production logic when a test exposes a real defect.

## Components
### Privacy policy
`server/public/privacy.html` will explicitly disclose that analysis requests may include the selected text, limited surrounding context, and page title; that saved vocabulary may store source URL and saved context; and that AI processing may use the configured Gemini or DeepSeek provider. It will add clearer retention/deletion language and a Limited Use statement suitable for Chrome Web Store data disclosures.

### Production packaging
`build-extension.js` will become the single trusted release path. It will produce a production-only manifest/config, then validate the generated archive before keeping it as a release artifact. The validation will reject localhost host permissions, missing production API configuration, and missing runtime resources such as the cursor icon.

### Tests
- Root-level release tests will cover production-manifest sanitization and archive validation.
- Server tests will be updated where mocks or expectations drifted from current code, without weakening business rules.

## Risk controls
- Preserve the current development config in source so local work still functions.
- Keep production-only rewriting inside the build step, not runtime code.
- Use tests to freeze release invariants before changing build logic.
- Re-run backend tests and production build after changes.
