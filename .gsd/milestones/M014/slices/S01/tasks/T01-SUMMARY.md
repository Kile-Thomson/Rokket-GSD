---
id: T01
parent: S01
milestone: M014
provides:
  - WorkerProgress interface in shared types
  - readParallelWorkers() and readBudgetCeiling() pure filesystem readers
  - Comprehensive test suite covering all edge cases
key_files:
  - src/shared/types.ts
  - src/extension/parallel-status.ts
  - src/extension/__tests__/parallel-status.test.ts
key_decisions:
  - Unknown worker state values default to "error" rather than throwing
  - budgetPercent left as null in reader — caller computes with readBudgetCeiling() result
patterns_established:
  - Dropbox conflicted copy filtering via /^[^(]+\.status\.json$/ filename pattern
  - Pure filesystem reader functions with null-return semantics for missing data
observability_surfaces:
  - readParallelWorkers() returns null for missing/empty dir, skips corrupt files silently
  - WorkerProgress.stale flag marks workers with heartbeat > 30s ago
duration: 8m
verification_result: passed
completed_at: 2026-03-19T02:13:00+11:00
blocker_discovered: false
---

# T01: Add WorkerProgress types and parallel status reader with tests

**Added WorkerProgress types and parallel status filesystem readers with 14 passing tests covering happy path, missing dir, corrupt JSON, Dropbox conflicted copies, stale detection, and budget ceiling parsing**

## What Happened

Added the `WorkerProgress` interface to `src/shared/types.ts` with all specified fields (id, pid, state, currentUnit, completedUnits, cost, budgetPercent, lastHeartbeat, stale). Extended `AutoProgressData` with optional `workers` and `budgetAlert` fields.

Created `src/extension/parallel-status.ts` with two pure functions:
- `readParallelWorkers(cwd)` — reads `.gsd/parallel/*.status.json`, filters Dropbox conflicted copies via regex, parses JSON with try/catch to skip corrupt files, maps to `WorkerProgress[]`, computes stale flag. Returns null for missing/empty dirs.
- `readBudgetCeiling(cwd)` — reads `.gsd/preferences.md`, scans for `budget_ceiling:` key-value line, returns parsed number or null.

Created comprehensive test suite with 14 tests covering: happy path with multiple workers, missing directory, empty directory, corrupt JSON (skip and return remaining), corrupt-only (returns null), conflicted copy filtering, stale detection (both stale and fresh), unknown state defaulting, budget ceiling parsing (happy path, missing file, missing key, non-numeric value, integer value).

## Verification

- `npx vitest run src/extension/__tests__/parallel-status.test.ts` — 14 tests pass
- `npm run build` — no type errors, extension and webview bundles succeed
- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — 19 existing tests still pass (no regression)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx vitest run src/extension/__tests__/parallel-status.test.ts` | 0 | ✅ pass | 320ms |
| 2 | `npm run build` | 0 | ✅ pass | 2.2s |
| 3 | `npx vitest run src/webview/__tests__/auto-progress.test.ts` | 0 | ✅ pass | 871ms |

## Diagnostics

- Import `readParallelWorkers` or `readBudgetCeiling` in a test or REPL to inspect parsed output from `.gsd/parallel/` or `.gsd/preferences.md`.
- `WorkerProgress.stale` flag (heartbeat > 30s) is available for UI indicators in downstream tasks.
- Corrupt files are silently skipped — check return array length vs. file count to detect skips.

## Deviations

- Added an extra test case for "only corrupt files exist returns null" and "unknown state defaults to error" — both strengthen coverage beyond the plan's explicit list.

## Known Issues

None.

## Files Created/Modified

- `src/shared/types.ts` — Added `WorkerProgress` interface and `workers`/`budgetAlert` fields to `AutoProgressData`
- `src/extension/parallel-status.ts` — New module with `readParallelWorkers()` and `readBudgetCeiling()` functions
- `src/extension/__tests__/parallel-status.test.ts` — 14 unit tests covering all edge cases
