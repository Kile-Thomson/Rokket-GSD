---
estimated_steps: 5
estimated_files: 4
---

# T03: Add tests for message-handler and keyboard

**Slice:** S07 — Webview Test Coverage (remediation)
**Milestone:** M013

## Description

Create test files for `message-handler` (992 lines, 30+ message cases) and `keyboard` (384 lines, event wiring). These are the most complex modules — both require extensive `vi.mock` and `vi.spyOn` to isolate from sibling dependencies. message-handler tests dispatch `MessageEvent` objects and verify state mutation + module delegation. keyboard tests dispatch `KeyboardEvent` objects and verify correct module calls.

## Steps

1. **Read the source files** — `src/webview/message-handler.ts` and `src/webview/keyboard.ts` to understand: the `init` signature, which sibling modules are imported and called, the exact message type strings in the switch/dispatch, and the keyboard event handler structure. Pay special attention to the `window.addEventListener("message", ...)` registration in message-handler and which modules keyboard imports.

2. **Create `src/webview/__tests__/message-handler.test.ts`** — jsdom pattern with heavy mocking:
   - `// @vitest-environment jsdom` at top
   - Use `vi.mock("../renderer")`, `vi.mock("../ui-dialogs")`, `vi.mock("../ui-updates")`, etc. for all sibling modules that message-handler delegates to. This prevents needing their DOM setup.
   - Import `state`, import `* as messageHandler` (or the init function)
   - In `beforeEach`: reset `state` fields, create minimal DOM, create mock vscode, call `messageHandler.init(mockDeps)`. In `afterEach`: clean up the message event listener (either by removing it or by re-creating the jsdom environment).
   - Test dispatching `new MessageEvent("message", { data: { type: "config", ... } })` → verify `state` fields updated
   - Test `state` message → verify state fields populated
   - Test `agent_start` → verify streaming state set
   - Test `agent_end` → verify streaming state cleared
   - Test `turn_start` / `turn_end` → verify turn tracking
   - Test `message_update` → verify renderer called with correct args (via spy)
   - Test `tool_execution_start` / `update` / `end` → verify renderer tool methods called
   - Test `extension_ui_request` → verify ui-dialogs called
   - Test `commands` → verify `state.commands` populated
   - Test `error` → verify error entry rendered
   - Test `session_shutdown` → verify cleanup state
   - **Important**: listener accumulation — if `init` adds a listener, must ensure cleanup in `afterEach`. Check if the module exports a `dispose` or if you need to track and remove the handler.
   - Target: ~15 tests

3. **Create `src/webview/__tests__/keyboard.test.ts`** — jsdom pattern with heavy mocking:
   - `// @vitest-environment jsdom` at top
   - Mock all 7+ sibling imports: `vi.mock("../slash-menu")`, `vi.mock("../model-picker")`, `vi.mock("../thinking-picker")`, `vi.mock("../session-history")`, `vi.mock("../visualizer")`, `vi.mock("../toasts")`, `vi.mock("../renderer")`, etc.
   - Import `state`, import the mocked modules, import `* as keyboard`
   - In `beforeEach`: reset `state`, create DOM elements (prompt input textarea, buttons), create mock vscode, call `keyboard.init(mockDeps)`
   - Test Enter key on prompt input → verify postMessage called with send command
   - Test Ctrl+Enter when `state.useCtrlEnterToSend` → verify send behavior toggled
   - Test Escape during streaming → verify interrupt postMessage sent
   - Test ArrowDown when slash menu visible → verify `slashMenu.navigateDown` called
   - Test ArrowUp when slash menu visible → verify `slashMenu.navigateUp` called
   - Test Enter when slash menu visible → verify `slashMenu.selectCurrent` called
   - Test click on copy button → verify clipboard interaction
   - Test click on file link → verify postMessage with open_file
   - Test click on tool toggle → verify tool card expand/collapse
   - Test `handleNewConversation` function
   - Target: ~10 tests

4. **Run the new tests** — `npx vitest run src/webview/__tests__/message-handler.test.ts src/webview/__tests__/keyboard.test.ts` — fix any failures.

5. **Run full suite and build** — `npx vitest run` (all 418+ tests pass) and `npm run build` (build succeeds). Verify total test count meets 60+ new tests across all S07 tasks.

## Must-Haves

- [ ] `src/webview/__tests__/message-handler.test.ts` exists with ~15 tests covering the highest-value message dispatch cases
- [ ] `src/webview/__tests__/keyboard.test.ts` exists with ~10 tests covering key combos and click delegation
- [ ] Both files use `// @vitest-environment jsdom` directive
- [ ] Sibling modules properly mocked with `vi.mock` to prevent DOM dependency chains
- [ ] Message event listener cleaned up in `afterEach` to prevent accumulation
- [ ] All new tests pass
- [ ] Full suite: 418+ tests passing (358 existing + 60+ new across S07)
- [ ] `npm run build` succeeds

## Verification

- `npx vitest run src/webview/__tests__/message-handler.test.ts` — all message-handler tests pass
- `npx vitest run src/webview/__tests__/keyboard.test.ts` — all keyboard tests pass
- `npx vitest run` — full suite passes with 418+ tests total
- `npm run build` — build succeeds
- `npx vitest run --reporter=verbose 2>&1 | tail -5` — verify total test count ≥ 418

## Inputs

- `src/webview/message-handler.ts` (992 lines) — source module, check all message type cases
- `src/webview/keyboard.ts` (384 lines) — source module, check all sibling imports and event handlers
- `src/webview/state.ts` — shared state
- `src/webview/__tests__/auto-progress.test.ts` — reference pattern
- T01 and T02 test files — for pattern consistency

## Expected Output

- `src/webview/__tests__/message-handler.test.ts` — ~15 tests for message dispatch cases
- `src/webview/__tests__/keyboard.test.ts` — ~10 tests for keyboard events and click delegation
- Full test suite at 418+ tests, build green

## Observability Impact

Test-only task — no runtime signals change. A future agent inspects this task by running `npx vitest run src/webview/__tests__/message-handler.test.ts src/webview/__tests__/keyboard.test.ts`. No new error paths, logs, or failure states are introduced. The stderr warning about `applyTheme is not defined` in the config message test is expected and caught by the source's try/catch — it does not indicate a real failure.
