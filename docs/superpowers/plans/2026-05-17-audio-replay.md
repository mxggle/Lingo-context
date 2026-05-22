# Audio Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeated pronunciation clicks restart the latest audio instead of layering multiple playbacks.

**Architecture:** Keep the change inside the existing `content.js` playback path. Introduce content-script playback ownership state plus request tokens, then guard async Edge TTS responses so only the latest request may create audible output.

**Tech Stack:** Chrome extension content script, Node built-in test runner, VM-based content-script tests.

---

### Task 1: Add playback regression coverage

**Files:**
- Create: `test/content-audio.test.js`
- Read: `content.js`

- [ ] Write a failing test showing a second `speakText()` call pauses the first `Audio` instance.
- [ ] Run `node --test test/content-audio.test.js` and verify it fails for missing playback ownership.
- [ ] Write a failing test showing an older async TTS response is ignored after a newer request is made.
- [ ] Run `node --test test/content-audio.test.js` and verify the stale-response test fails.

### Task 2: Implement replay-safe ownership

**Files:**
- Modify: `content.js`
- Test: `test/content-audio.test.js`

- [ ] Add current-audio state, URL cleanup state, and a monotonically increasing request token.
- [ ] Stop and clean up the prior MP3 when a new `speakText()` starts.
- [ ] Ignore stale Edge TTS callbacks whose token is no longer current.
- [ ] Keep existing Web Speech fallback behavior, but only for the latest request.
- [ ] Run `node --test test/content-audio.test.js` and verify both regression tests pass.

### Task 3: Verify the touched area

**Files:**
- Read: `test/content-context.test.js`
- Read: `test/content-scroll.test.js`

- [ ] Run `node --test test/content-context.test.js test/content-scroll.test.js test/content-audio.test.js`.
- [ ] Inspect the diff for unintended changes and summarize the behavior change.
