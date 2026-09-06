# Poster Visual Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the preview sticky, preserve each ranking mode independently, and add a reusable same-computer visual-plan library containing image + crop + brightness.

**Architecture:** Keep binary assets in the existing `.local/poster-assets/<scope>/` store. Add a small JSON visual index per scope and mode-specific project state files. The browser editor resolves visual plans into the existing item rendering shape, so Canvas/TMDB/image caching code stays largely intact.

**Tech Stack:** Browser ES modules, Canvas 2D, Node.js local HTTP server, JSON files under `.local/`.

**Spec:** `docs/superpowers/specs/2026-09-06-poster-visual-library-design.md`

## Global Constraints

- No image binaries in project JSON.
- Existing UUID asset files remain valid and are not renamed.
- Visual plan = source asset + crop + brightness + readable label + anime identity.
- Ranking modes choose visual plans independently; switching modes must restore the previous state for that mode.
- Existing project JSON without visual-plan metadata must remain readable.

---

### Task 1: Make the preview actually sticky

**Files:** Modify `poster.css`; test `tests/poster-page.test.mjs`.

- [ ] Add a failing source-level assertion that desktop stickiness belongs to `.poster-preview-column`, not a child constrained by a same-height parent.
- [ ] Change desktop CSS so `.poster-preview-column` is the sticky grid item with `top: 16px`; keep the narrow breakpoint static.
- [ ] Re-read the resulting CSS and confirm the mobile override remains intact.

### Task 2: Add mode-specific poster state storage

**Files:** Modify `scripts/poster-asset-store.mjs`, `scripts/poster-api.mjs`, `src/poster-persistence.js`; tests `tests/poster-persistence.test.mjs`, `tests/poster-store.test.mjs` or existing equivalents.

**Interfaces:** `loadPosterWorkspace(scope, mode)`, `savePosterWorkspace(scope, mode, project)`; state API accepts `mode=red|black|controversy|favorite`.

- [ ] Write tests for distinct red/favorite state paths and legacy fallback.
- [ ] Extend server/store path resolution to include mode while preserving legacy `<scope>.json` reads.
- [ ] Update browser persistence helpers to send mode.

### Task 3: Add persistent visual-plan index

**Files:** Modify `scripts/poster-asset-store.mjs`, `scripts/poster-api.mjs`, `src/poster-persistence.js`; add tests.

**Interfaces:** `loadPosterVisuals(scope) -> visual[]`, `savePosterVisuals(scope, visuals)`; API `GET/PUT /api/poster/visuals?scope=...`.

- [ ] Write tests for visual index round-trip and invalid scope handling.
- [ ] Add `.local/poster-visuals/<scope>.json` store helpers.
- [ ] Add GET/PUT API routes and browser helpers.

### Task 4: Model visual references and anime matching

**Files:** Modify `src/poster-model.js`; tests `tests/poster-model.test.mjs`.

**Interfaces:** item field `visualId`; helpers normalize visual entries and match by TMDB id or normalized title.

- [ ] Write tests for `visualId` normalization and title/TMDB matching.
- [ ] Add minimal normalization/helpers without changing existing render fields.

### Task 5: Add visual-plan browser UI and lifecycle

**Files:** Modify `poster.html`, `poster.css`, `src/poster-editor.js`, `src/tmdb-picker.js`; tests `tests/poster-page.test.mjs` plus a focused source test.

- [ ] Add a failing wiring test for `已有视觉方案`, modal markup/classes, and TMDB label metadata forwarding.
- [ ] Add a visual library modal that filters plans for the selected anime and previews the final crop.
- [ ] On local/TMDB image import, create a plan with readable default label and set `item.visualId`.
- [ ] On crop/zoom/brightness changes, update the active plan and persist the visual index.
- [ ] On choosing an existing plan, copy its asset/crop/brightness into the item, set `visualId`, load the cached image, and persist the current ranking state.
- [ ] Add rename support for the readable label.

### Task 6: Switch ranking modes without overwriting each other

**Files:** Modify `src/poster-editor.js`; tests focused on source/state behavior.

- [ ] Replace direct `project.mode = ...` switching with save-current/load-target behavior.
- [ ] Make built-in buttons reset only their own mode slot.
- [ ] Remember the last active mode locally so reopening returns to the same mode when possible.
- [ ] When restoring an item with `visualId`, refresh its image/crop snapshot from the current visual library before rendering.

### Task 7: Regression verification and PR documentation

**Files:** Update PR body only if behavior changed materially from its description.

- [ ] Verify all touched remote files contain the intended interfaces and no accidental removal of red/black/controversy/favorite behavior.
- [ ] Run repository tests when an execution environment is available; otherwise state clearly that only remote-source verification was possible.
- [ ] Keep the PR Draft.
