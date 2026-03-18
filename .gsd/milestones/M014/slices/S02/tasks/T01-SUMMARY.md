---
id: T01
parent: S02
milestone: M014
provides:
  - validate-milestone phase label ("VALIDATING") with checkmark icon in progress widget
  - "gsd update" and "gsd export" slash menu entries
  - slash-menu.test.ts test file with buildItems() coverage
key_files:
  - src/webview/auto-progress.ts
  - src/webview/slash-menu.ts
  - src/webview/__tests__/auto-progress.test.ts
  - src/webview/__tests__/slash-menu.test.ts
key_decisions:
  - Exported buildItems() from slash-menu.ts (marked @internal) to enable direct unit testing of menu entries
patterns_established:
  - phaseIcon variable pattern for conditional phase-specific icons in auto-progress render
observability_surfaces:
  - buildItems() export enables test verification of slash menu contents
duration: 5m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T01: Add validate-milestone phase label and new slash menu entries

**Added `validate-milestone` → "✓ VALIDATING" phase rendering and `/gsd update`, `/gsd export` slash menu commands with tests**

## What Happened

Three source files were modified and one test file was created:

1. **auto-progress.ts**: Added `case "validate-milestone": return "VALIDATING"` to `formatPhase()`. Added a `phaseIcon` variable that prepends `"✓ "` when the phase is `validate-milestone`, inserted into the phase span template.

2. **slash-menu.ts**: Added two entries to `gsdSubcommands`: `gsd update` (with `sendOnSelect: true` for immediate execution) and `gsd export` (without `sendOnSelect`, so the user can append `--html --all` arguments). Exported `buildItems()` (marked `@internal`) to enable direct test verification.

3. **auto-progress.test.ts**: Added one test asserting the phase span contains both "VALIDATING" and "✓" when `phase: "validate-milestone"`.

4. **slash-menu.test.ts** (new): Created with two tests verifying `buildItems()` includes the new entries with correct descriptions and `sendOnSelect` values.

## Verification

- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — 30 tests pass (including new validate-milestone test)
- `npx vitest run src/webview/__tests__/slash-menu.test.ts` — 2 tests pass
- `npx vitest run` — full suite: 278 tests pass across 16 files, zero regressions

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx vitest run src/webview/__tests__/auto-progress.test.ts src/webview/__tests__/slash-menu.test.ts` | 0 | ✅ pass | 4.2s |
| 2 | `npx vitest run` | 0 | ✅ pass | 3.2s |

## Diagnostics

- Phase rendering is inspectable via DOM: `.gsd-auto-progress-phase` span text content shows "✓ VALIDATING" when phase is `validate-milestone`.
- Slash menu entries are testable via exported `buildItems()` — returns full item array for assertion.
- Unknown phases fall back to `phase.toUpperCase()` (no crash).

## Deviations

- T01-PLAN suggested `autoProgress.updateAutoProgress(data)` in the test, but the actual API is `autoProgress.update(data)`. Used the correct API.
- Exported `buildItems()` from slash-menu.ts to enable testing. This was anticipated as a possibility in the plan.

## Known Issues

None.

## Files Created/Modified

- `src/webview/auto-progress.ts` — Added validate-milestone case to formatPhase(), phaseIcon variable, and checkmark in template
- `src/webview/slash-menu.ts` — Added gsd update and gsd export to gsdSubcommands, exported buildItems()
- `src/webview/__tests__/auto-progress.test.ts` — Added validate-milestone phase rendering test
- `src/webview/__tests__/slash-menu.test.ts` — New test file for slash menu buildItems() verification
