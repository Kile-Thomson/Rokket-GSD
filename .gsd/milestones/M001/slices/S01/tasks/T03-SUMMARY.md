---
id: T03
parent: S01
milestone: M001
provides:
  - model-picker.ts module (162 lines) with model selection overlay
  - Public API: init(), show(), hide(), toggle(), isVisible(), render()
  - Click-outside-to-close handled internally via init()
  - Button/badge click handlers wired internally
key_files:
  - src/webview/model-picker.ts
  - src/webview/index.ts
key_decisions:
  - "Model picker init() wires its own click handlers (modelPickerBtn, modelBadge, click-outside) — keeps all picker event logic co-located"
  - "Renamed DOM ref from modelPicker to modelPickerEl to avoid name collision with module import"
  - "Removed unused AvailableModel import from index.ts"
patterns_established:
  - "Same init(deps) pattern as slash-menu — consistent module extraction approach"
drill_down_paths:
  - .gsd/milestones/M001/slices/S01/tasks/T03-PLAN.md
duration: 8min
verification_result: pass
completed_at: 2026-03-12T08:35:00Z
---

# T03: Extract model picker module

**Model picker extracted to model-picker.ts (162 lines) — self-contained overlay with init()-based wiring, build passes**

## What Happened

Extracted all model picker code from index.ts: state (visibility), toggle/show/hide/render functions, click handlers (button, badge, click-outside-to-close), and model selection with state updates. The module uses the same init(deps) pattern as slash-menu. Callbacks for updateHeaderUI/updateFooterUI injected as deps.

## Deviations
None.

## Files Created/Modified
- `src/webview/model-picker.ts` — New module: model picker overlay (162 lines)
- `src/webview/index.ts` — Removed ~100 lines of model picker code, added import and init() call
