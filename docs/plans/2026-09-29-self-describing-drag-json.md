# Self-Describing Drag JSON Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade newly exported drag events to a self-describing v3 JSON structure while preserving v1/v2 input compatibility.

**Architecture:** The content script supplies explicit coordinate and replay metadata, the shared core validates and canonicalizes it, and the converter preserves the canonical structure in generated workflows. Legacy fields are normalized at the core and converter boundaries rather than duplicated throughout the UI.

**Tech Stack:** Chrome MV3 JavaScript, Node.js assertions, Python standard-library converter and unittest.

---

### Task 1: Lock the canonical drag schema with failing tests

**Files:**
- Modify: `tests/core.test.cjs`
- Modify: `tests/test_converter.py`
- Modify: `tests/browser-smoke.cjs`

1. Assert `coordinateSystem`, point `relativeTo`, `targetValue`, and `replayStrategy` for every drag type.
2. Assert legacy `value` input becomes `targetValue`.
3. Assert invalid units, origins, references, and strategies are rejected.
4. Run `node tests/core.test.cjs` and the focused Python converter test; expect failures before implementation.

### Task 2: Emit and normalize v3 drag events

**Files:**
- Modify: `extension/content.js`
- Modify: `extension/core.js`
- Modify: `extension/background.js`

1. Add canonical coordinate metadata and reference names during capture.
2. Rename newly captured range `value` to `targetValue`.
3. Canonicalize legacy inputs and reject contradictory metadata.
4. Start new recordings at schema v3 and avoid downgrading them when branches are created.
5. Run the pure core test and JavaScript syntax checks; expect success.

### Task 3: Preserve schema meaning through UI and conversion

**Files:**
- Modify: `extension/popup.js`
- Modify: `scripts/recording_to_skill.py`
- Modify: `skills/windows-record-replay/SKILL.md`

1. Display `targetValue`, with a fallback to legacy `value`.
2. Validate v3 and preserve explicit coordinate metadata and strategies.
3. Infer canonical metadata for legacy drag steps during conversion.
4. Update replay instructions to follow the declared strategy and coordinate references.
5. Run converter tests; expect all to pass.

### Task 4: Version, document, and verify

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/popup.html`
- Modify: `.codex-plugin/plugin.json`
- Modify: `README.md`
- Modify: `项目说明.md`

1. Set extension version to 0.8.0 and plugin version to 0.4.0.
2. Document schema v3 and include a complete example.
3. Run unit tests, JavaScript syntax checks, metadata parsing, and `git diff --check`.
4. Commit the completed feature on `feature/drag-recognition`.
