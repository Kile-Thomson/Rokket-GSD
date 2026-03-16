---
id: S05
parent: M008
milestone: M008
provides:
  - index.ts decomposed from 2416 to 696 lines
  - 5 new focused modules extracted (dashboard, file-handling, message-handler, keyboard, ui-updates)
  - All modules follow init() pattern with dependency injection
  - Zero behavioral changes — pure refactor
requires: []
affects: []
key_files:
  - src/webview/index.ts (696 lines — orchestration shell)
  - src/webview/dashboard.ts (323 lines — dashboard rendering, welcome screen)
  - src/webview/file-handling.ts (243 lines — paste, drop, file attachments)
  - src/webview/message-handler.ts (884 lines — extension event handler)
  - src/webview/keyboard.ts (304 lines — keyboard, click handlers, ARIA)
  - src/webview/ui-updates.ts (362 lines — header, footer, input, overlay UI)
key_decisions:
  - All modules receive element refs and callbacks via init() — matches existing model-picker/slash-menu pattern
  - message-handler.ts allowed to exceed 500 lines (884) since it's a single dense switch statement that shouldn't be split further
  - UI update functions destructured at module scope in index.ts for backward-compatible call sites
  - Fixed insertDroppedPaths undefined reference by aliasing to addFileAttachments in file-handling.ts
patterns_established:
  - Module extraction pattern: export init(deps) + export individual functions
  - State imported directly from state.ts; element refs passed via init
observability_surfaces:
  - Module line counts verifiable with wc -l
  - All 140 tests serve as regression safety net
duration: ~30min
verification_result: passed
completed_at: 2026-03-14
---

# S05: index.ts decomposition

**index.ts decomposed from 2416 lines to 696 lines across 5 new modules. All 140 tests pass. Zero behavioral changes.**

## What Happened

Extracted 5 modules from index.ts in order of isolation:
1. **dashboard.ts** (323 lines) — renderDashboard, formatTokenCount, updateWelcomeScreen
2. **file-handling.ts** (243 lines) — paste/drop handlers, file attachments, image previews
3. **message-handler.ts** (884 lines) — the window "message" event handler with all case branches
4. **keyboard.ts** (304 lines) — keyboard handlers, click delegation, button handlers, ARIA support
5. **ui-updates.ts** (362 lines) — updateAllUI, updateHeaderUI, updateFooterUI, updateInputUI, updateOverlayIndicators, updateWorkflowBadge

## Verification

- `npx vitest run` — 140 tests pass (7 test files)
- `wc -l src/webview/index.ts` → 696 (target: <700) ✅
- All new modules under 500 lines except message-handler (884 — acceptable)

## Deviations

- Added ui-updates.ts extraction (not in original plan) to hit the 700-line target
- Fixed pre-existing bug: `insertDroppedPaths` was called but never defined — aliased to `addFileAttachments`

## Files Created/Modified

- `src/webview/index.ts` — reduced from 2416 to 696 lines
- `src/webview/dashboard.ts` — new (323 lines)
- `src/webview/file-handling.ts` — new (243 lines)
- `src/webview/message-handler.ts` — new (884 lines)
- `src/webview/keyboard.ts` — new (304 lines)
- `src/webview/ui-updates.ts` — new (362 lines)
