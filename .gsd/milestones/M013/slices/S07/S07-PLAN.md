# S07: Webview Test Coverage (remediation)

**Goal:** Add test coverage for the 6 untested webview modules: ui-dialogs, slash-menu, ui-updates, renderer, message-handler, and keyboard.
**Demo:** `npx vitest run` shows 60+ new webview tests passing alongside all 358 existing tests.

## Must-Haves

- Test files for all 6 modules: `ui-dialogs.test.ts`, `slash-menu.test.ts`, `ui-updates.test.ts`, `renderer.test.ts`, `message-handler.test.ts`, `keyboard.test.ts`
- All tests use `// @vitest-environment jsdom` directive
- Each test file follows the established pattern: DOM setup in `beforeEach`, `state` pre-seeding, `init(mockDeps)` call, `mockVscode` with `postMessage`
- 60+ new tests total
- All 358 existing tests continue to pass
- Build still succeeds (`npm run build`)

## Verification

- `npx vitest run` — all 418+ tests pass (358 existing + 60+ new)
- `npx vitest run src/webview/__tests__/ui-dialogs.test.ts src/webview/__tests__/slash-menu.test.ts` — T01 tests pass
- `npx vitest run src/webview/__tests__/ui-updates.test.ts src/webview/__tests__/renderer.test.ts` — T02 tests pass
- `npx vitest run src/webview/__tests__/message-handler.test.ts src/webview/__tests__/keyboard.test.ts` — T03 tests pass
- `npm run build` — build succeeds

## Tasks

- [x] **T01: Add tests for ui-dialogs and slash-menu** `est:1h`
  - Why: These are the cleanest input→output modules — they prove the test pattern works for DOM-heavy webview code. ui-dialogs renders confirm/select/input dialogs; slash-menu manages a filterable command palette. Both have clear `init(deps)` + exercise + assert cycles.
  - Files: `src/webview/__tests__/ui-dialogs.test.ts`, `src/webview/__tests__/slash-menu.test.ts`, `src/webview/ui-dialogs.ts`, `src/webview/slash-menu.ts`
  - Do: Create both test files following the established jsdom pattern (see `auto-progress.test.ts` as reference). For ui-dialogs: test `handleRequest` for confirm/select/input/multi-select dialog types, button click dispatching postMessage, dedup fingerprinting, linked dialog resolution, `expireAllPending`, `hasPending`. For slash-menu: test `show`/`hide` visibility, filtering by name/description, `navigateDown`/`navigateUp` index tracking, `selectCurrent` dispatching correct postMessage or callback. Each module needs `init(mockDeps)` called in `beforeEach` with fresh mocks. Reset `state` fields in `beforeEach`.
  - Verify: `npx vitest run src/webview/__tests__/ui-dialogs.test.ts src/webview/__tests__/slash-menu.test.ts`
  - Done when: ~25 tests passing across both files, covering core behaviors of both modules

- [x] **T02: Add tests for ui-updates and renderer** `est:1h`
  - Why: These modules handle state→DOM rendering — the core visual update loop. ui-updates renders header badges, footer stats, and input state from the `state` object. renderer manages chat entry creation, streaming segments, tool cards, and turn finalization. Both are testable by pre-seeding `state` then verifying DOM output.
  - Files: `src/webview/__tests__/ui-updates.test.ts`, `src/webview/__tests__/renderer.test.ts`, `src/webview/ui-updates.ts`, `src/webview/renderer.ts`
  - Do: Create both test files using jsdom pattern. For ui-updates: pre-seed `state` with model/cost/token/streaming values, call `updateHeaderUI`/`updateFooterUI`/`updateInputUI`/`updateWorkflowBadge`/`handleModelRouted`, verify DOM element textContent/classList. For renderer: test `renderNewEntry` for user/assistant/system entries (verify DOM structure), `appendToTextSegment` (segment element creation), `appendToolSegmentElement`/`updateToolSegmentElement` (tool card DOM), `detectStaleEcho` (return value), `finalizeCurrentTurn` (class changes), `clearMessages`. Note: renderer uses `requestAnimationFrame` — jsdom stubs this to fire synchronously, which works fine.
  - Verify: `npx vitest run src/webview/__tests__/ui-updates.test.ts src/webview/__tests__/renderer.test.ts`
  - Done when: ~27 tests passing across both files, covering state→DOM rendering and streaming

- [x] **T03: Add tests for message-handler and keyboard** `est:1h`
  - Why: These are the most complex modules — message-handler is the central dispatch (992 lines, 30+ cases) and keyboard wires all input handling. Testing the highest-value message cases and key combos closes the coverage gap. Both require extensive `vi.mock` usage for sibling module dependencies.
  - Files: `src/webview/__tests__/message-handler.test.ts`, `src/webview/__tests__/keyboard.test.ts`, `src/webview/message-handler.ts`, `src/webview/keyboard.ts`
  - Do: Create both test files. For message-handler: `init` registers `window.addEventListener("message", ...)` — tests dispatch `new MessageEvent("message", { data: {...} })`. Test ~15 highest-value cases: `config`, `state`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_update`, `tool_execution_start`/`update`/`end`, `extension_ui_request`, `commands`, `error`, `session_shutdown`. Use `vi.spyOn` on renderer/uiDialogs/etc. to verify delegation without full DOM. Must `removeEventListener` or re-init cleanly in `afterEach` to prevent listener accumulation. For keyboard: mock 7+ sibling modules via `vi.mock("../slash-menu")` etc., create mock DOM elements, call `init`, dispatch `KeyboardEvent` → verify correct module function called. Test: Enter sends, Escape interrupts, ArrowDown/Up in slash menu, Ctrl+Enter toggle, click delegation for copy/file links/tool toggles.
  - Verify: `npx vitest run src/webview/__tests__/message-handler.test.ts src/webview/__tests__/keyboard.test.ts` && `npx vitest run` (full suite)
  - Done when: ~25 tests passing across both files, full suite at 418+ tests, `npm run build` succeeds

## Observability / Diagnostics

- **Test pass/fail**: `npx vitest run` — single command shows all test results with pass/fail counts. Test file names map 1:1 to source modules for easy triage.
- **Failure inspection**: Vitest output includes stack traces with source-mapped line numbers pointing to the exact assertion or source line that failed.
- **Coverage delta**: Compare `Tests: N passed` count before (358) and after (418+) to confirm new tests were added.
- **No runtime observability impact**: This slice adds only test files — no production code changes, no new logs, no new error paths.

## Files Likely Touched

- `src/webview/__tests__/ui-dialogs.test.ts` (new)
- `src/webview/__tests__/slash-menu.test.ts` (new)
- `src/webview/__tests__/ui-updates.test.ts` (new)
- `src/webview/__tests__/renderer.test.ts` (new)
- `src/webview/__tests__/message-handler.test.ts` (new)
- `src/webview/__tests__/keyboard.test.ts` (new)
