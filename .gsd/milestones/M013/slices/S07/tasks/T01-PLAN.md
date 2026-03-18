---
estimated_steps: 5
estimated_files: 4
---

# T01: Add tests for ui-dialogs and slash-menu

**Slice:** S07 — Webview Test Coverage (remediation)
**Milestone:** M013

## Description

Create test files for `ui-dialogs` and `slash-menu` — the two cleanest input→output webview modules. Both follow the standard `init(deps)` → exercise → assert pattern. ui-dialogs renders inline confirm/select/input dialogs and manages dedup/expiry. slash-menu manages a filterable command palette with keyboard navigation.

## Steps

1. **Read the source files** — `src/webview/ui-dialogs.ts` and `src/webview/slash-menu.ts` to understand exact exports, `init` signatures, and DOM dependencies. Also read `src/webview/__tests__/auto-progress.test.ts` as the reference test pattern.

2. **Create `src/webview/__tests__/ui-dialogs.test.ts`** — Follow the established jsdom pattern:
   - `// @vitest-environment jsdom` at top
   - Import `state` from `../state`, import `* as uiDialogs` from `../ui-dialogs`
   - In `beforeEach`: reset relevant `state` fields, set up DOM container, create mock `vscode` with `postMessage: vi.fn()`, call `uiDialogs.init(mockDeps)` (check init signature — it likely takes the vscode mock and element refs)
   - Test `handleRequest` with confirm dialog data → verify dialog DOM renders with correct text/buttons
   - Test `handleRequest` with select dialog → verify options rendered
   - Test `handleRequest` with input dialog → verify input field rendered
   - Test multi-select dialog rendering
   - Test button click dispatches `postMessage` with correct response
   - Test dedup fingerprinting — same request twice doesn't create duplicate dialogs
   - Test linked dialog resolution
   - Test `expireAllPending` removes pending dialogs
   - Test `hasPending` returns correct boolean
   - Target: ~15 tests

3. **Create `src/webview/__tests__/slash-menu.test.ts`** — Same jsdom pattern:
   - Import `state`, import `* as slashMenu` from `../slash-menu`
   - In `beforeEach`: reset `state.commands` and `state.commandsLoaded`, set up DOM (need an input element and menu container), call `slashMenu.init(mockDeps)`
   - Pre-seed `state.commands` with test command objects
   - Test `show()` makes menu visible (`isVisible()` returns true)
   - Test `hide()` makes menu not visible
   - Test filtering: `show("mod")` → `getFilteredItems()` contains only matching commands
   - Test `navigateDown` increments `getIndex()`
   - Test `navigateUp` decrements `getIndex()`
   - Test index wraps around at boundaries
   - Test `selectCurrent` sends correct postMessage for a standard command
   - Test `selectCurrent` with custom webview commands (/compact, /export, /model) triggers callback instead
   - Test `sendOnSelect` auto-dispatch behavior
   - Target: ~10 tests

4. **Run the new tests** — `npx vitest run src/webview/__tests__/ui-dialogs.test.ts src/webview/__tests__/slash-menu.test.ts` — fix any failures.

5. **Run full suite** — `npx vitest run` — confirm all 358+ existing tests still pass alongside the new ones.

## Must-Haves

- [ ] `src/webview/__tests__/ui-dialogs.test.ts` exists with ~15 tests covering dialog rendering, button dispatch, dedup, expiry
- [ ] `src/webview/__tests__/slash-menu.test.ts` exists with ~10 tests covering show/hide, filtering, navigation, selection
- [ ] Both files use `// @vitest-environment jsdom` directive
- [ ] All new tests pass
- [ ] All 358 existing tests still pass

## Verification

- `npx vitest run src/webview/__tests__/ui-dialogs.test.ts` — all ui-dialog tests pass
- `npx vitest run src/webview/__tests__/slash-menu.test.ts` — all slash-menu tests pass
- `npx vitest run` — full suite passes with 380+ tests

## Inputs

- `src/webview/ui-dialogs.ts` (449 lines) — source module, check `init` signature and exports
- `src/webview/slash-menu.ts` (299 lines) — source module, check `init` signature and exports
- `src/webview/state.ts` — shared `AppState`, imported and pre-seeded in tests
- `src/webview/__tests__/auto-progress.test.ts` — reference test pattern (jsdom, state pre-seeding, init call, DOM assertions)
- `src/webview/__tests__/visualizer.test.ts` — additional reference for complex DOM testing

## Expected Output

- `src/webview/__tests__/ui-dialogs.test.ts` — ~15 tests for dialog rendering, interaction, dedup, expiry
- `src/webview/__tests__/slash-menu.test.ts` — ~10 tests for menu visibility, filtering, navigation, selection
