---
estimated_steps: 5
estimated_files: 4
---

# T01: Verify and test loading states & copy-button gating

**Slice:** S03 — Loading States & Async UX
**Milestone:** M008

## Description

All loading-state infrastructure already exists in the codebase (spinners for dashboard/changelog/model-picker, CSS-based copy-button gating during streaming). This task verifies correctness — particularly the changelog spinner replacement flow flagged as uncertain in research — fixes any gaps, and adds unit tests to lock the behavior.

## Steps

1. Read dashboard loading flow (`index.ts:618-622`) and its replacement logic (`index.ts:~1199`). Confirm spinner div is properly removed/replaced when dashboard data arrives.
2. Read changelog loading flow (`index.ts:778-784`) and `showChangelog` handler. Verify spinner is replaced when changelog data arrives. Fix if not.
3. Read renderer copy-button gating (`renderer.ts:72, 209, 324-335`). Confirm `streaming` class toggle and `isComplete` guard work together correctly.
4. Write `src/webview/__tests__/loading-states.test.ts` with tests:
   - Dashboard loading renders spinner with correct class
   - Changelog loading renders spinner with correct class
   - Model picker renders spinner when models list is empty
   - Copy button not rendered when `turn.isComplete` is false
   - Copy button rendered when `turn.isComplete` is true
5. Run full test suite to confirm no regressions.

## Must-Haves

- [ ] Changelog spinner replacement verified (or fixed if broken)
- [ ] Test file with ≥4 cases covering all three spinner flows and copy-button gating
- [ ] Full test suite passes

## Verification

- `npx vitest run --reporter=verbose src/webview/__tests__/loading-states.test.ts` passes
- `npx vitest run` — full suite green

## Observability Impact

- **New test coverage**: 10 test cases verify spinner rendering, spinner replacement, copy-button gating, and streaming class lifecycle. A regression in any loading flow will surface as a test failure.
- **Inspectable signals**: No new runtime signals added — the existing DOM class patterns (`streaming`, `gsd-loading-spinner`, `gsd-copy-response-btn`) are the primary observability surface, now locked by tests.

## Inputs

- S03-RESEARCH.md findings on existing code locations
- Existing test patterns in `src/webview/__tests__/`

## Expected Output

- `src/webview/__tests__/loading-states.test.ts` — new test file with ≥4 test cases
- Any fixes to `src/webview/index.ts` if changelog spinner replacement is broken
