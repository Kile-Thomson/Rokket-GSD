# S07: Webview Test Coverage (remediation) — UAT

**Milestone:** M013
**Written:** 2026-03-18

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice adds only test files — no production code changes, no runtime behavior changes. Verification is fully automated via `npx vitest run`.

## Preconditions

- Working directory is the M013 worktree
- Node modules installed (`npm install` has been run)
- No dev server required — tests run standalone

## Smoke Test

Run `npx vitest run` — expect 505 tests passing across 29 test files with 0 failures.

## Test Cases

### 1. All 6 new test files exist and pass

1. Run `npx vitest run src/webview/__tests__/ui-dialogs.test.ts src/webview/__tests__/slash-menu.test.ts src/webview/__tests__/ui-updates.test.ts src/webview/__tests__/renderer.test.ts src/webview/__tests__/message-handler.test.ts src/webview/__tests__/keyboard.test.ts`
2. **Expected:** All 147 tests pass (24 + 23 + 29 + 23 + 30 + 18)

### 2. Full suite regression check

1. Run `npx vitest run`
2. **Expected:** 505 tests pass across 29 test files, 0 failures

### 3. Build still succeeds

1. Run `npm run build`
2. **Expected:** Build completes without errors. Webview bundle ~327KB, extension bundle unchanged.

### 4. ui-dialogs covers dialog types and lifecycle

1. Run `npx vitest run src/webview/__tests__/ui-dialogs.test.ts`
2. **Expected:** 24 tests pass covering: confirm dialog (Yes/No buttons dispatch postMessage), single-select (option click, Skip button), input dialog (Submit/Cancel/Enter/Escape), multi-select (toggle + confirm), dedup fingerprinting, expireAllPending, hasPending

### 5. slash-menu covers visibility, filtering, navigation

1. Run `npx vitest run src/webview/__tests__/slash-menu.test.ts`
2. **Expected:** 23 tests pass covering: show/hide toggle, filter by name and description, empty filter hides menu, extension commands from state, navigation up/down/clamp, selection dispatch for sendOnSelect and webview commands, click-to-select

### 6. ui-updates covers state→DOM rendering

1. Run `npx vitest run src/webview/__tests__/ui-updates.test.ts`
2. **Expected:** 29 tests pass covering: updateHeaderUI (model/thinking/cost/context badges), updateFooterUI (cwd, token stats), updateInputUI (streaming toggle, placeholder, Ctrl+Enter hint), updateOverlayIndicators (compacting/retry/crashed/unresponsive + button wiring), updateWorkflowBadge, handleModelRouted

### 7. renderer covers entry creation and streaming

1. Run `npx vitest run src/webview/__tests__/renderer.test.ts`
2. **Expected:** 23 tests pass covering: renderNewEntry (user/assistant/system/stale-echo), clearMessages, ensureCurrentTurnElement, appendToTextSegment (text + thinking via rAF), tool segments, detectStaleEcho (6 branches), finalizeCurrentTurn, resetStreamingState

### 8. message-handler covers dispatch for 20+ message types

1. Run `npx vitest run src/webview/__tests__/message-handler.test.ts`
2. **Expected:** 30 tests pass covering: config, state, agent_start/end, turn_start/end, message_update, tool_execution_start/update/end, extension_ui_request, commands, error, session_shutdown, process_status, auto_compaction, process_exit, auto_progress, dashboard_data, files_attached, thinking_level_changed, parallel tool detection, malformed messages

### 9. keyboard covers shortcuts and click delegation

1. Run `npx vitest run src/webview/__tests__/keyboard.test.ts`
2. **Expected:** 18 tests pass covering: Enter/Shift+Enter/Ctrl+Enter send, Escape during streaming, slash menu arrow/enter/escape, global Escape, send button click, handleNewConversation, compact/attach buttons, file link clicks, copy button click

## Edge Cases

### No listener accumulation corruption

1. Run `npx vitest run src/webview/__tests__/message-handler.test.ts` twice in sequence
2. **Expected:** Both runs produce 30 passing tests — listener cleanup in afterEach prevents accumulation

### jsdom scrollIntoView stub

1. Run `npx vitest run src/webview/__tests__/slash-menu.test.ts`
2. **Expected:** No errors from scrollIntoView — the stub in beforeEach handles the missing jsdom method

## Failure Signals

- Any test count below 505 indicates a regression or missing test file
- Test file count below 29 means a file was lost
- Build failure after test changes would indicate an accidental production code modification
- `applyTheme is not defined` stderr warning is expected and benign — not a failure signal

## Not Proven By This UAT

- Runtime behavior of the webview modules themselves — this slice adds tests only, no production code changes
- Visual rendering correctness — tests verify DOM structure, not pixel-level appearance
- keyboard.ts toggle behavior under repeated init — known limitation due to document listener accumulation

## Notes for Tester

- All verification is automated. Run `npx vitest run` as the single comprehensive check.
- The stderr warning about `applyTheme is not defined` is expected and can be ignored.
- Test counts may increase slightly if future tasks add tests, but should never decrease below 505.
