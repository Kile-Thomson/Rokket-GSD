# S07: Webview Test Coverage (remediation) — Research

**Date:** 2026-03-18

## Summary

Six webview modules lack test coverage: `ui-dialogs` (449 lines), `slash-menu` (299), `ui-updates` (400), `keyboard` (384), `renderer` (713), and `message-handler` (992). All follow the same architecture: module-level state, `init(deps)` for dependency injection, and exported functions that manipulate DOM elements via jsdom-compatible APIs.

The existing webview test suite (9 files, ~194 tests) establishes a clean pattern: `// @vitest-environment jsdom`, DOM setup in `beforeEach`, direct `state` import for pre-seeding, and a `mockVscode` object with `postMessage`. No new infrastructure is needed — every target module can be tested by following this exact pattern.

The current test count is 358. Target is 60+ new tests to exceed the milestone goal. The largest modules (message-handler at 992 lines with 30+ message cases, renderer at 713 lines with streaming/DOM logic) will produce the most tests. The smaller modules (slash-menu, keyboard) are straightforward input→output.

## Recommendation

Follow the established jsdom test pattern exactly. Test each module independently by calling `init(mockDeps)` and then exercising exports. Priority order:

1. **ui-dialogs** — pure DOM rendering with clear input→output (confirm/select/input dialogs, dedup, expiry)
2. **slash-menu** — menu visibility, filtering, navigation, selection
3. **ui-updates** — header/footer/input state rendering from `state` object
4. **renderer** — entry rendering, streaming segments, tool cards, finalization
5. **message-handler** — message dispatch for all 30+ cases (large but formulaic: receive message → verify state mutation + DOM effect)
6. **keyboard** — event handler wiring (verify correct actions fire for key combos)

## Implementation Landscape

### Key Files

- `src/webview/ui-dialogs.ts` (449 lines) — Renders inline confirm/select/input dialogs in chat. Exports: `init`, `handleRequest`, `expireAllPending`, `hasPending`. Key behaviors: dialog dedup via fingerprinting, linked dialog resolution, focus trapping, multi-select, expiry. Dependencies: `helpers` (escapeHtml, escapeAttr, scrollToBottom), `vscode.postMessage`.
- `src/webview/slash-menu.ts` (299 lines) — Slash command palette. Exports: `init`, `show`, `hide`, `navigateDown`, `navigateUp`, `selectCurrent`, `isVisible`, `getIndex`, `getFilteredItems`. Key behaviors: filtering by name/description, sendOnSelect auto-dispatch, custom webview commands (/compact, /export, /model, etc.). Dependencies: `state.commands`, `state.commandsLoaded`, `vscode.postMessage`, callback injections.
- `src/webview/ui-updates.ts` (400 lines) — Updates header badges, footer stats, input state, overlay indicators, workflow badge. Exports: `init`, `updateAllUI`, `updateHeaderUI`, `updateFooterUI`, `updateInputUI`, `updateOverlayIndicators`, `updateWorkflowBadge`, `handleModelRouted`. Dependencies: `state` object (reads model, cost, tokens, streaming status, etc.), `dashboard`, DOM elements.
- `src/webview/keyboard.ts` (384 lines) — Keyboard event handlers and click delegation. Exports: `init`, `handleNewConversation`. `init` wires up: prompt keydown (slash menu nav, Enter/Ctrl+Enter send, Escape interrupt), global keydown (overlay dismissal), click handlers (copy, file links, tool toggles, version badge). Dependencies: many module imports (`slashMenu`, `modelPicker`, `thinkingPicker`, `sessionHistory`, `visualizer`, `toasts`, `renderer`), `state`, `vscode.postMessage`.
- `src/webview/renderer.ts` (713 lines) — DOM rendering for chat entries and streaming. Exports: `init`, `clearMessages`, `renderNewEntry`, `ensureCurrentTurnElement`, `appendToTextSegment`, `appendToolSegmentElement`, `updateToolSegmentElement`, `detectStaleEcho`, `finalizeCurrentTurn`, `resetStreamingState`. Key behaviors: entry element creation, streaming segment management, tool card rendering, elapsed timer, stale echo detection. Dependencies: `state`, `helpers` (many), `tool-grouping`.
- `src/webview/message-handler.ts` (992 lines) — Central message dispatch. Exports: `init`, `addSystemEntry`. `init` registers `window.addEventListener("message", handleMessage)` with a 30+ case switch. Each case reads message data, mutates `state`, calls renderer/other modules, and updates UI. Dependencies: nearly every other webview module.
- `src/webview/state.ts` — Shared `AppState` object. Directly mutable, imported by all modules. Tests pre-seed it in `beforeEach`.
- `src/webview/__tests__/auto-progress.test.ts` — Best reference for the test pattern: jsdom environment, DOM setup, `state` pre-seeding, mock vscode.
- `src/webview/__tests__/visualizer.test.ts` — Good reference for complex DOM + state interaction testing.
- `vitest.config.ts` — Default environment is `node`; webview tests override with `// @vitest-environment jsdom`.

### Build Order

1. **ui-dialogs.test.ts** — Start here. Cleanest input→output: call `handleRequest(data)` → verify DOM output. Tests confirm/select/input/multi-select rendering, button clicks sending postMessage, dedup fingerprinting, linked dialog resolution, `expireAllPending`. ~15 tests. Proves the pattern works for DOM-heavy modules.

2. **slash-menu.test.ts** — `show(filter)` → verify `filteredItems`, `isVisible`, DOM rendering. `navigateDown`/`navigateUp` → verify `getIndex`. `selectCurrent` → verify prompt insertion or callback dispatch. ~10 tests.

3. **ui-updates.test.ts** — Pre-seed `state` with model/cost/token/streaming values → call `updateHeaderUI`/`updateFooterUI`/`updateInputUI` → verify DOM element textContent/classList. `updateWorkflowBadge` with various workflow states. `handleModelRouted` toast. ~12 tests.

4. **renderer.test.ts** — `renderNewEntry` for user/assistant/system entries → verify DOM structure. `appendToTextSegment` → verify segment element creation. `appendToolSegmentElement`/`updateToolSegmentElement` → verify tool card DOM. `detectStaleEcho` → verify return value. `finalizeCurrentTurn` → verify class changes. ~15 tests.

5. **message-handler.test.ts** — Test the highest-value message cases: `config`, `state`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_update`, `tool_execution_start`/`update`/`end`, `extension_ui_request`, `commands`, `error`, `session_shutdown`. Each test: dispatch `MessageEvent` → verify `state` mutation and/or module calls. Use `vi.spyOn` on renderer/uiDialogs/etc. to verify delegation without needing their full DOM. ~15 tests.

6. **keyboard.test.ts** — Create mock DOM elements, call `init`, dispatch KeyboardEvent → verify correct module function called. Key combos: Enter sends, Escape interrupts, ArrowDown/Up in slash menu, Ctrl+Enter when `useCtrlEnterToSend`. Click delegation: copy buttons, file links, tool toggles. ~10 tests. Requires mocking several imported modules via `vi.mock`.

### Verification Approach

- `npx vitest run` — all 358+ existing tests pass, 60+ new tests pass
- `npx vitest run src/webview/__tests__/ui-dialogs.test.ts` (etc.) — each new file passes independently
- `npm run build` — build succeeds (tests don't affect bundle, but confirms no import issues)
- Total test count verified: `npx vitest run --reporter=verbose 2>&1 | tail -3`

## Constraints

- `// @vitest-environment jsdom` directive required at top of every webview test file — the default vitest environment is `node`.
- All modules use `init(deps)` injection — tests must call `init` with mock deps in `beforeEach` before exercising any function.
- `state` is a mutable singleton — must be reset in `beforeEach` to avoid cross-test pollution. Existing tests do this by assigning fields directly.
- `message-handler.ts` registers a `window.addEventListener("message", ...)` listener in `init` — tests dispatch `new MessageEvent("message", { data: ... })` to trigger it. Must remove listener in `afterEach` or isolate.
- `keyboard.ts` imports 7+ sibling modules — use `vi.mock("../slash-menu")` etc. to avoid initializing the real modules and their DOM dependencies.
- `renderer.ts` uses `requestAnimationFrame` for batched text rendering — jsdom stubs this but it fires synchronously, which is fine for tests.

## Common Pitfalls

- **Module-level state leaks between tests** — Each module has module-level `let` variables set by `init()`. If `init` isn't called in `beforeEach`, the previous test's state persists. Always call `init(freshMockDeps)` per test or per describe block.
- **message-handler listener accumulation** — `init()` calls `window.addEventListener("message", ...)`. If called multiple times without cleanup, handlers stack. Either `removeEventListener` in `afterEach` or use `{ once: true }` style isolation.
- **DOM innerHTML assertions are fragile** — Assert on structure (querySelector results, textContent, classList) not on exact innerHTML strings. The existing tests follow this pattern.

## Open Risks

- `message-handler.ts` has 30+ cases, many with complex state mutations. Testing all cases would exceed the 60-test target for this slice alone. Plan targets the ~15 highest-value cases; remaining can be deferred.
- `keyboard.ts` mocking 7+ sibling modules is verbose but not risky — vitest's `vi.mock` handles this cleanly.
