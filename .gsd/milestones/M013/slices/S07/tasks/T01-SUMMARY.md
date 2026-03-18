---
id: T01
parent: S07
milestone: M013
provides:
  - Test coverage for ui-dialogs module (24 tests)
  - Test coverage for slash-menu module (23 tests)
key_files:
  - src/webview/__tests__/ui-dialogs.test.ts
  - src/webview/__tests__/slash-menu.test.ts
key_decisions:
  - Stub Element.prototype.scrollIntoView in slash-menu tests since jsdom doesn't implement it
patterns_established:
  - ui-dialogs test pattern: init with mock vscode + container, call handleRequest, assert DOM and postMessage
  - slash-menu test pattern: init with full deps mock, stub scrollIntoView, pre-seed state.commands
observability_surfaces:
  - none (test-only task)
duration: 15m
verification_result: passed
completed_at: 2026-03-18
blocker_discovered: false
---

# T01: Add tests for ui-dialogs and slash-menu

**Added 47 tests covering ui-dialogs (confirm/select/input/multi-select, dedup, expiry) and slash-menu (visibility, filtering, navigation, selection dispatch)**

## What Happened

Created two test files following the established jsdom pattern from auto-progress.test.ts.

**ui-dialogs.test.ts** (24 tests): Covers confirm dialog rendering and Yes/No dispatch, single-select with option click and Skip, input dialog with Submit/Cancel/Enter/Escape, multi-select with toggle and confirm, dedup fingerprinting (linked dialogs get same response), expireAllPending marking all dialogs resolved and sending cancelled for linked IDs, hasPending state tracking, and prefill values.

**slash-menu.test.ts** (23 tests): Covers show/hide visibility toggling, filtering by name and description, empty filter hiding menu, extension commands from state.commands, get_commands request when not loaded, navigation index tracking (down/up/clamp), selection dispatch for sendOnSelect commands (triggers onSendMessage), webview commands (/compact, /export, /model, /new), non-sendOnSelect commands filling input, prompt clearing, and click-to-select.

## Verification

- `npx vitest run src/webview/__tests__/ui-dialogs.test.ts src/webview/__tests__/slash-menu.test.ts` — 47 tests passed ✅
- `npx vitest run` — 405 tests passed (all 358 existing + 47 new) ✅

### Slice-level checks:
- T01 tests pass ✅
- T02/T03 tests — not yet created (future tasks)
- Full suite — 405 passed ✅

## Diagnostics

Test-only task. Run `npx vitest run src/webview/__tests__/ui-dialogs.test.ts src/webview/__tests__/slash-menu.test.ts` to verify these tests.

## Deviations

- Added `Element.prototype.scrollIntoView = vi.fn()` stub in slash-menu beforeEach — jsdom doesn't implement scrollIntoView, which slash-menu's render() calls. Standard jsdom workaround.
- 47 tests instead of ~25 target — both modules had more testable surface than estimated.

## Known Issues

None.

## Files Created/Modified

- `src/webview/__tests__/ui-dialogs.test.ts` — 24 tests for dialog rendering, interaction, dedup, expiry
- `src/webview/__tests__/slash-menu.test.ts` — 23 tests for menu visibility, filtering, navigation, selection
- `.gsd/milestones/M013/slices/S07/S07-PLAN.md` — marked T01 done, added Observability section
