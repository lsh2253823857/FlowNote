# Drag And Scroll Recognition Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record sliders, sortable/ordinary element drags, canvas pointer paths, and page/container scrolling as reusable workflow steps.

**Architecture:** Use semantic-first pointer capture in the content script. Record stable element metadata and normalized coordinates, add a bounded path only for canvas, and represent scrolling separately as a coalesced final-position action. Validate every field in the extension core and Python converter; generated Skills prefer live semantic targets and use coordinates only when necessary.

**Tech Stack:** Chrome Extension Manifest V3, DOM Pointer/Drag/Scroll Events, JavaScript, HTML/CSS, Python 3 standard library, Node.js/Playwright smoke tests.

---

### Task 1: Define and validate drag/scroll actions

**Files:**
- Modify: `extension/core.js`
- Modify: `tests/browser-smoke.cjs`
- Modify: `tests/test_converter.py`

1. Add failing tests for `drag` types `range`, `sort`, `element`, and `canvas`.
2. Require normalized `{x, y}` points in the inclusive 0..1 range.
3. Limit canvas paths to 24 normalized points.
4. Validate `scrollX`, `scrollY`, `xRatio`, and `yRatio`; merge consecutive scrolls on the same target.
5. Verify malformed coordinates, paths, drag types, and scroll values are rejected.

### Task 2: Capture pointer drags

**Files:**
- Modify: `extension/content.js`
- Test: `tests/browser-smoke.cjs`

1. Track trusted primary-pointer gestures from pointer down through pointer up.
2. Ignore movement under 8 CSS pixels so clicks are not misclassified.
3. Classify `input[type=range]`, canvas, draggable/sortable, and ordinary element drags.
4. Store source and destination element metadata plus relative start/end points.
5. Sample canvas paths and simplify them to at most 24 points.
6. Suppress the click and range-input duplicates immediately produced by a completed drag.
7. Convert unsupported Shadow DOM drags to a manual step.

### Task 3: Capture HTML drag/drop and scrolling

**Files:**
- Modify: `extension/content.js`
- Modify: `extension/core.js`
- Test: `tests/browser-smoke.cjs`

1. Capture native `dragstart`, `drop`, and `dragend` for sortable/HTML5 drag-and-drop pages.
2. Do not record local file contents or paths when files are dragged into a page.
3. Debounce document and element scroll events for 300 milliseconds.
4. Save final absolute and normalized positions; merge subsequent scroll steps on the same target.
5. Cover browser-native page scrollbar movement through the resulting document scroll event.

### Task 4: Convert and display the new actions

**Files:**
- Modify: `extension/popup.js`
- Modify: `scripts/recording_to_skill.py`
- Modify: `skills/windows-record-replay/SKILL.md`
- Test: `tests/test_converter.py`

1. Render concise Chinese descriptions for sliders, sorting, canvas paths, element drags, and scrolling.
2. Preserve validated drag/scroll data in `workflow.json`.
3. Parameterize range final values when ordinary input capture is off; keep captured values as examples, not defaults.
4. Tell replay agents to resolve live source/destination elements first, then use normalized coordinates only if supported.
5. Fall back to a manual step when the available browser tool cannot drag or draw.

### Task 5: Documentation, versioning, and verification

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/popup.html`
- Modify: `.codex-plugin/plugin.json`
- Modify: `README.md`
- Modify: `项目说明.md`

1. Bump the extension to v0.7.0 and the bundled Codex plugin to v0.3.0.
2. Document the 8-pixel threshold, scroll coalescing, normalized coordinates, canvas limitations, and privacy behavior.
3. Run Python unit tests, JavaScript syntax/core tests, metadata parsing, and `git diff --check`.
4. Run the Playwright extension smoke suite if the browser runtime is available; otherwise report the environment limitation explicitly.
5. Commit the feature locally without pushing it.
