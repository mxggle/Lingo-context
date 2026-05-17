# README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh `README.md` so it accurately describes the current LingoContext product and includes the project logo.

**Architecture:** Keep the existing developer-friendly README structure, but update its content in place. Reuse the existing repository logo asset and derive claims from current source files, manifest metadata, changelog, and recent commits.

**Tech Stack:** Markdown, repository-local assets, Chrome Extension MV3 documentation

---

## File Map
- Modify: `README.md` — project overview, logo placement, feature list, tech stack, configuration, usage, and structure text.

### Task 1: Refresh README content

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Audit current claims**
  - Compare README wording against `manifest.json`, `CHANGELOG.md`, current source files, and recent commits.

- [ ] **Step 2: Update the document**
  - Add the logo using `icons/icon.png`.
  - Refresh the intro and feature list to reflect implemented capabilities.
  - Update stack/configuration text so it reflects multi-provider AI support and Edge TTS.
  - Fix stale or malformed wording.

- [ ] **Step 3: Verify the diff**
  - Confirm every feature claim is supported by existing code or project metadata.
  - Confirm the logo path exists.
  - Review the final Markdown for clarity and regressions.

- [ ] **Step 4: Commit**
  ```bash
  git add README.md
  git commit -m "docs: refresh README for current features"
  ```
