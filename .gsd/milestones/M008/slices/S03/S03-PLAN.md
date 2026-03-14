# S03: Loading States & Async UX

**Goal:** Confirm all async loading flows (dashboard, changelog, model picker) show spinners, copy buttons are gated during streaming, and lock this behavior with tests.
**Demo:** Loading spinners visible during dashboard/changelog/model fetch. Copy button absent while streaming, present after completion.

## Must-Haves

- Dashboard loading shows spinner that is replaced when data arrives
- Changelog loading shows spinner that is replaced when data arrives
- Model picker shows spinner when model list is empty
- Code block copy button hidden during streaming, visible after completion
- Tests covering spinner rendering and copy-button gating logic

## Verification

- `npx vitest run --reporter=verbose src/webview/__tests__/loading-states.test.ts` — all tests pass
- `npx vitest run` — all existing tests still pass (82+)
- Loading-states tests include a spinner-replacement test that fails if the remove-before-replace pattern breaks

## Tasks

- [x] **T01: Verify and test loading states & copy-button gating** `est:1h`
  - Why: Research shows all loading-state code already exists. This task verifies it works correctly, fixes any gaps, and adds tests to prevent regression.
  - Files: `src/webview/__tests__/loading-states.test.ts`, `src/webview/index.ts`, `src/webview/renderer.ts`, `src/webview/model-picker.ts`
  - Do: (1) Read the dashboard/changelog/model-picker loading code and renderer copy-button gating. (2) Verify changelog handler properly replaces spinner when data arrives (research flagged this as uncertain). (3) Fix any gaps found. (4) Write tests: spinner HTML rendered for each flow, copy button absent during streaming, copy button present after completion. (5) Run full test suite.
  - Verify: `npx vitest run` — all tests pass including new loading-states tests
  - Done when: New test file exists with ≥4 test cases covering all three spinners and copy-button gating, full suite green

## Observability / Diagnostics

- **Spinner visibility**: Each loading flow uses distinct CSS classes (`gsd-loading-spinner`, `gsd-model-picker-loading`) queryable via DOM inspection or browser devtools.
- **Streaming class**: The `streaming` CSS class on `.gsd-entry-assistant` elements indicates in-progress turns — inspectable via `document.querySelectorAll('.streaming')`.
- **Copy-button presence**: `document.querySelectorAll('.gsd-copy-response-btn').length` reveals how many completed turns have copy buttons rendered.
- **Failure visibility**: If spinner replacement fails, the spinner div persists in DOM alongside the data div — detectable by counting elements with both `.gsd-loading-spinner` and data content in the same container.
- **No secrets involved**: These are purely UI-state flows with no credential handling.

## Files Likely Touched

- `src/webview/__tests__/loading-states.test.ts`
- `src/webview/index.ts`
- `src/webview/renderer.ts`
- `src/webview/model-picker.ts`
