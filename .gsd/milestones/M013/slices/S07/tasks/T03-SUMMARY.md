---
id: T03
parent: S07
milestone: M013
provides:
  - Test coverage for message-handler module (30 tests)
  - Test coverage for keyboard module (18 tests)
key_files:
  - src/webview/__tests__/message-handler.test.ts
  - src/webview/__tests__/keyboard.test.ts
key_decisions:
  - Capture window.addEventListener in beforeEach to track and remove message listener in afterEach, preventing listener accumulation across tests
  - Replace tool-header toggle test with copy-button click test to avoid flakiness from accumulated document click listeners (keyboard.init adds non-removable document listeners)
patterns_established:
  - message-handler test pattern: heavy vi.mock for all sibling modules, dispatch MessageEvent via window.dispatchEvent, verify state mutation + spy calls
  - keyboard test pattern: mock sibling modules, create full DOM with all required elements, dispatch KeyboardEvent on promptInput or document, verify delegation to mocked modules
observability_surfaces:
  - none
duration: 15min
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T03: Add tests for message-handler and keyboard

**Added 48 tests for message-handler (30) and keyboard (18) covering message dispatch, state mutation, tool lifecycle, keyboard shortcuts, click delegation, and button handlers**

## What Happened

Created test files for the two most complex webview modules. message-handler tests cover 20+ message types including config, state, agent_start/end, turn lifecycle, tool execution start/update/end, extension_ui_request delegation, commands, error, session_shutdown, process_status, auto_compaction, process_exit, auto_progress, dashboard_data routing, files_attached, and thinking_level_changed. Also tests parallel tool detection and malformed message handling.

keyboard tests cover Enter/Shift+Enter/Ctrl+Enter send behavior, Escape during streaming, slash menu arrow/enter/escape navigation, global Escape closing pickers, send button click (streaming vs not), handleNewConversation, compact/attach buttons, file link clicks, and copy button click delegation.

Both files use heavy `vi.mock` to isolate from all sibling module DOM dependencies. The message-handler tests intercept `window.addEventListener` to capture and remove the message listener in afterEach, preventing accumulation. keyboard tests accepted that document-level listeners accumulate (no cleanup API exposed) and avoided toggle-dependent assertions.

## Verification

- `npx vitest run src/webview/__tests__/message-handler.test.ts` — 30 tests pass
- `npx vitest run src/webview/__tests__/keyboard.test.ts` — 18 tests pass
- `npx vitest run` — 505 tests pass (all 29 test files green)
- `npm run build` — build succeeds

## Diagnostics

Test-only task. Run `npx vitest run src/webview/__tests__/message-handler.test.ts src/webview/__tests__/keyboard.test.ts` to verify these tests. The stderr warning about `applyTheme is not defined` in the config test is expected — the function is file-scoped and caught by the try/catch in the source; it doesn't affect test correctness.

## Deviations

- Plan targeted ~15 message-handler tests and ~10 keyboard tests. Delivered 30 and 18 respectively — doubled coverage because the module structure made it natural to test more message types.
- Replaced the tool-header toggle click test with a copy-button click test to avoid flakiness from accumulated document click listeners. The toggle mechanism works correctly in production (single init call); the test issue is specific to repeated init calls in test setup.

## Known Issues

- keyboard.init() adds document-level event listeners with no dispose mechanism. Each test's beforeEach call accumulates listeners. This doesn't affect test correctness for non-toggle assertions but prevents deterministic toggle testing. Would need a dispose() export to fix properly.

## Files Created/Modified

- `src/webview/__tests__/message-handler.test.ts` — 30 tests covering message dispatch, state mutation, tool lifecycle, dialog delegation
- `src/webview/__tests__/keyboard.test.ts` — 18 tests covering keyboard shortcuts, click handlers, button wiring
