# Chrome Web Store Readiness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the extension safer to submit to Chrome Web Store without altering the product's user-facing flows.

**Architecture:** Keep functional behavior unchanged and harden the edges: documentation reflects existing data flow, the release build emits a production-only package, and focused tests guard those invariants. Existing backend tests are repaired where they have drifted from the current implementation.

**Tech Stack:** Manifest V3, Node.js, Jest, Express, Chrome extension packaging scripts.

---

### Task 1: Lock production packaging behavior with tests

**Files:**
- Create: `test/build-extension.test.js`
- Modify later: `build-extension.js`

- [ ] Write failing tests asserting production manifests exclude localhost access, production config uses the hosted API, and required runtime assets are present.
- [ ] Run the new test file and confirm failure against current build behavior.
- [ ] Implement the smallest build-script change that makes the tests pass.
- [ ] Re-run the focused test file.

### Task 2: Align privacy policy with current product behavior

**Files:**
- Modify: `server/public/privacy.html`

- [ ] Update the policy copy to disclose selected text, limited surrounding context, page title, saved source URL/context, configured AI providers, retention/deletion, and Limited Use language.
- [ ] Manually inspect the rendered HTML structure for consistency.

### Task 3: Repair stale backend tests without changing intended behavior

**Files:**
- Modify: `server/__tests__/db.test.js`
- Modify: `server/__tests__/userRoute.test.js`
- Modify only if genuinely needed: relevant production files under `server/`

- [ ] Re-run the failing suites and capture the exact drift.
- [ ] Update tests/mocks to match intended current implementation, keeping behavioral assertions meaningful.
- [ ] Re-run the focused suites until green.

### Task 4: Verify release readiness end-to-end

**Files:**
- Modify if needed: `package.json`

- [ ] Run root tests.
- [ ] Run backend full test suite.
- [ ] Run `npm run build:prod`.
- [ ] Inspect the fresh archive for production-only config and required assets.
- [ ] Summarize residual risks, if any.
