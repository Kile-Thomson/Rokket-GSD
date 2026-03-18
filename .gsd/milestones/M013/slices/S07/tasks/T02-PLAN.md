---
estimated_steps: 5
estimated_files: 4
---

# T02: Add tests for ui-updates and renderer

**Slice:** S07 — Webview Test Coverage (remediation)
**Milestone:** M013

## Description

Create test files for `ui-updates` and `renderer` — the state→DOM rendering modules. ui-updates reads model/cost/token/streaming values from `state` and updates header badges, footer stats, input state, and workflow badges. renderer creates chat entry elements, manages streaming text segments, renders tool cards, and finalizes turns. Both are testable by pre-seeding `state` then verifying DOM output via querySelector.

## Steps

1. **Read the source files** — `src/webview/ui-updates.ts` and `src/webview/renderer.ts` to understand exact exports, `init` signatures, DOM element IDs/classes they read/write, and dependencies. Also read `src/webview/state.ts` to know which state fields each module reads.

2. **Create `src/webview/__tests__/ui-updates.test.ts`** — jsdom pattern:
   - `// @vitest-environment jsdom` at top
   - Import `state`, import `* as uiUpdates` from `../ui-updates`
   - In `beforeEach`: reset `state` fields (model, costUsd, tokensIn, tokensOut, streaming, etc.), create DOM elements matching the IDs/classes that ui-updates queries (header area, footer stats, input area, etc.), create mock deps, call `uiUpdates.init(mockDeps)`
   - Test `updateHeaderUI` — set `state.model`, call it, verify header element shows model name
   - Test `updateFooterUI` — set `state.costUsd`/token counts, verify footer text
   - Test `updateInputUI` — set `state.streaming = true`, verify input disabled state
   - Test `updateInputUI` — streaming false, verify input enabled
   - Test `updateAllUI` calls all sub-updates (verify DOM changes for each section)
   - Test `updateOverlayIndicators` with various overlay states
   - Test `updateWorkflowBadge` with workflow active/idle/error states
   - Test `handleModelRouted` — verify toast or header update for model switch
   - Target: ~12 tests

3. **Create `src/webview/__tests__/renderer.test.ts`** — jsdom pattern:
   - Import `state`, import `* as renderer` from `../renderer`
   - In `beforeEach`: reset `state`, create DOM container (`.gsd-messages` div), mock deps (helpers, tool-grouping may need mocking), call `renderer.init(mockDeps)`
   - Test `renderNewEntry` with user role — verify DOM element has user class, text content
   - Test `renderNewEntry` with assistant role — verify assistant class
   - Test `renderNewEntry` with system role — verify system class
   - Test `clearMessages` — add entries then clear, verify container empty
   - Test `ensureCurrentTurnElement` — verify creates turn container if missing
   - Test `appendToTextSegment` — verify text segment element created/appended
   - Test `appendToolSegmentElement` — verify tool card DOM structure
   - Test `updateToolSegmentElement` — verify tool card updates (status, output)
   - Test `detectStaleEcho` — verify returns true/false correctly
   - Test `finalizeCurrentTurn` — verify class changes (streaming → finalized)
   - Test `resetStreamingState` — verify streaming state cleared
   - Note: `requestAnimationFrame` fires synchronously in jsdom — this is fine
   - Target: ~15 tests

4. **Run the new tests** — `npx vitest run src/webview/__tests__/ui-updates.test.ts src/webview/__tests__/renderer.test.ts` — fix any failures.

5. **Run full suite** — `npx vitest run` — confirm all existing + T01 + T02 tests pass.

## Must-Haves

- [ ] `src/webview/__tests__/ui-updates.test.ts` exists with ~12 tests covering header/footer/input/workflow state rendering
- [ ] `src/webview/__tests__/renderer.test.ts` exists with ~15 tests covering entry creation, streaming, tool cards, finalization
- [ ] Both files use `// @vitest-environment jsdom` directive
- [ ] All new tests pass
- [ ] All existing tests still pass

## Verification

- `npx vitest run src/webview/__tests__/ui-updates.test.ts` — all ui-updates tests pass
- `npx vitest run src/webview/__tests__/renderer.test.ts` — all renderer tests pass
- `npx vitest run` — full suite passes with 400+ tests

## Inputs

- `src/webview/ui-updates.ts` (400 lines) — source module
- `src/webview/renderer.ts` (713 lines) — source module
- `src/webview/state.ts` — shared `AppState`, fields read by both modules
- `src/webview/__tests__/auto-progress.test.ts` — reference pattern
- T01 test files (for pattern consistency, if needed)

## Expected Output

- `src/webview/__tests__/ui-updates.test.ts` — ~12 tests for state→DOM header/footer/input/workflow rendering
- `src/webview/__tests__/renderer.test.ts` — ~15 tests for entry creation, streaming segments, tool cards, finalization

## Observability Impact

Test-only task — no runtime signals change. Future agents inspect this task via:
- `npx vitest run src/webview/__tests__/ui-updates.test.ts src/webview/__tests__/renderer.test.ts` — verifies all test assertions still hold
- Vitest failure output includes source-mapped stack traces pointing to the exact broken assertion
- No production code changes, no new logs, no new error paths
