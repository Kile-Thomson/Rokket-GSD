---
id: S07
parent: M013
milestone: M013
provides:
  - Test coverage for 6 webview modules: ui-dialogs (24), slash-menu (23), ui-updates (29), renderer (23), message-handler (30), keyboard (18)
  - 147 new webview tests total (target was 60+)
  - jsdom-based test patterns for DOM-heavy webview code
requires: []
affects: []
key_files:
  - src/webview/__tests__/ui-dialogs.test.ts
  - src/webview/__tests__/slash-menu.test.ts
  - src/webview/__tests__/ui-updates.test.ts
  - src/webview/__tests__/renderer.test.ts
  - src/webview/__tests__/message-handler.test.ts
  - src/webview/__tests__/keyboard.test.ts
key_decisions:
  - Stub Element.prototype.scrollIntoView in slash-menu tests (jsdom doesn't implement it)
  - Mock dashboard.updateWelcomeScreen in ui-updates tests to isolate from full DOM
  - Mock helpers and tool-grouping in renderer tests to isolate DOM rendering from formatting
  - Capture window.addEventListener in message-handler beforeEach to track and remove listeners in afterEach
  - Replace tool-header toggle test with copy-button click test in keyboard to avoid flakiness from accumulated document listeners
patterns_established:
  - ui-dialogs test pattern: init with mock vscode + container, call handleRequest, assert DOM and postMessage
  - slash-menu test pattern: init with full deps mock, stub scrollIntoView, pre-seed state.commands
  - ui-updates test pattern: create element deps, init(deps), seed state, call update fn, assert textContent/classList/style
  - renderer test pattern: mock helpers+tool-grouping, init with messagesContainer+welcomeScreen, flush rAF for text segments
  - message-handler test pattern: heavy vi.mock for sibling modules, dispatch MessageEvent, verify state mutation + spy calls
  - keyboard test pattern: mock sibling modules, create full DOM with required elements, dispatch KeyboardEvent, verify delegation
observability_surfaces:
  - none (test-only slice)
drill_down_paths:
  - .gsd/milestones/M013/slices/S07/tasks/T01-SUMMARY.md
  - .gsd/milestones/M013/slices/S07/tasks/T02-SUMMARY.md
  - .gsd/milestones/M013/slices/S07/tasks/T03-SUMMARY.md
duration: 40m
verification_result: passed
completed_at: 2026-03-18
---

# S07: Webview Test Coverage (remediation)

**147 new tests covering all 6 untested webview modules — ui-dialogs, slash-menu, ui-updates, renderer, message-handler, keyboard — bringing the full suite to 505 tests across 29 test files**

## What Happened

Three tasks systematically covered the webview layer from simplest to most complex:

**T01** tackled ui-dialogs (24 tests) and slash-menu (23 tests) — the cleanest input→output modules. ui-dialogs tests cover confirm/select/input/multi-select dialog rendering, button dispatch via postMessage, dedup fingerprinting, linked dialog resolution, expireAllPending, and hasPending tracking. slash-menu tests cover show/hide, filtering by name and description, navigation index tracking, selection dispatch for sendOnSelect vs webview commands, and click-to-select.

**T02** covered the state→DOM rendering pipeline: ui-updates (29 tests) and renderer (23 tests). ui-updates tests verify header badges, footer stats, input state, overlay indicators (compacting/retry/crashed/unresponsive with button wiring), workflow badge, and handleModelRouted. renderer tests cover entry creation for user/assistant/system types, streaming text and thinking segments (via rAF flush), tool card append/update, all 6 detectStaleEcho branches, finalizeCurrentTurn, and clearMessages.

**T03** handled the two most complex modules: message-handler (30 tests) and keyboard (18 tests). message-handler tests dispatch MessageEvents for 20+ message types including config, state, agent lifecycle, turn lifecycle, tool execution lifecycle, extension_ui_request delegation, commands, errors, and session_shutdown. keyboard tests cover Enter/Shift+Enter/Ctrl+Enter send behavior, Escape during streaming, slash menu arrow/enter/escape navigation, global Escape closing pickers, send button click, and click delegation for copy/file links.

All tests use the `// @vitest-environment jsdom` directive and follow consistent patterns: DOM setup in beforeEach, state pre-seeding, init(mockDeps) call, and mockVscode with postMessage.

## Verification

- `npx vitest run` — 505 tests pass across 29 test files ✅
- `npx vitest run src/webview/__tests__/ui-dialogs.test.ts src/webview/__tests__/slash-menu.test.ts` — 47 tests pass ✅
- `npx vitest run src/webview/__tests__/ui-updates.test.ts src/webview/__tests__/renderer.test.ts` — 52 tests pass ✅
- `npx vitest run src/webview/__tests__/message-handler.test.ts src/webview/__tests__/keyboard.test.ts` — 48 tests pass ✅
- `npm run build` — build succeeds, webview bundle 327.2KB, extension bundle unchanged ✅

## Deviations

- 147 new tests instead of 60+ target — every module had more testable surface than estimated. This is strictly additive, no downside.
- Added Element.prototype.scrollIntoView stub in slash-menu tests — standard jsdom workaround for unimplemented DOM method.
- Replaced tool-header toggle test with copy-button click test in keyboard — document-level listeners accumulate across test runs (no dispose API), making toggle assertions non-deterministic.

## Known Limitations

- keyboard.init() adds document-level event listeners with no dispose mechanism. Each test beforeEach accumulates listeners. This doesn't affect test correctness for non-toggle assertions but prevents deterministic toggle testing. Would need a dispose() export to fix properly.
- The `applyTheme is not defined` stderr warning in config-related tests is expected — the function is file-scoped and caught by try/catch in source. Doesn't affect correctness.

## Follow-ups

- Consider adding a `dispose()` export to keyboard.ts for cleaner test isolation if keyboard tests need expansion.

## Files Created/Modified

- `src/webview/__tests__/ui-dialogs.test.ts` — 24 tests for dialog rendering, interaction, dedup, expiry
- `src/webview/__tests__/slash-menu.test.ts` — 23 tests for menu visibility, filtering, navigation, selection
- `src/webview/__tests__/ui-updates.test.ts` — 29 tests for header/footer/input/overlay/workflow badge rendering
- `src/webview/__tests__/renderer.test.ts` — 23 tests for entry creation, streaming segments, tool cards, stale echo, turn finalization
- `src/webview/__tests__/message-handler.test.ts` — 30 tests for message dispatch, state mutation, tool lifecycle, dialog delegation
- `src/webview/__tests__/keyboard.test.ts` — 18 tests for keyboard shortcuts, click handlers, button wiring

## Forward Intelligence

### What the next slice should know
- All 6 webview modules now have test coverage. The milestone's test count target (350+) is exceeded at 505. Module coverage stands at 29/31 test files (the remaining untested modules, if any, are minor utilities).
- The jsdom test patterns established here are reusable for any future webview module tests — see any of the 6 test files for the template.

### What's fragile
- keyboard.ts document listener accumulation — if a future slice adds more keyboard tests, they must avoid assertions that depend on toggle state from accumulated listeners. The workaround is to test non-toggle behaviors only, or add a dispose() export.

### Authoritative diagnostics
- `npx vitest run` — single command shows all 505 tests with per-file pass/fail counts. Test file names map 1:1 to source modules.

### What assumptions changed
- Estimated 60+ new tests — actual was 147. Every module had 2-3x more testable surface than planned. The plan's time estimates were accurate despite the higher test counts.
