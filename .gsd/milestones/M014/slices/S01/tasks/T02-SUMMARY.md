---
id: T02
parent: S01
milestone: M014
provides:
  - Parallel worker progress data in AutoProgressPoller poll loop
  - Budget ceiling caching with 30s TTL
  - Budget percentage computation per worker
  - VS Code warning toast on 80% budget threshold crossing
key_files:
  - src/extension/auto-progress.ts
key_decisions:
  - Budget alert toast fires once per crossing (resets when all workers drop below 80%)
patterns_established:
  - 30s TTL cache pattern for infrequently-changing config (budget ceiling)
  - One-shot toast with boolean guard to prevent duplicates across poll cycles
observability_surfaces:
  - Output channel logs "Parallel workers: N" per poll when workers present
  - Output channel logs "Budget alert fired for: ..." on toast trigger
duration: 5m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T02: Wire parallel reader into AutoProgressPoller and add budget alert toast

**Wired readParallelWorkers() and readBudgetCeiling() into AutoProgressPoller.poll(), computing per-worker budget percentages and firing a one-shot VS Code warning toast when any worker crosses 80% of budget ceiling**

## What Happened

Added import of `readParallelWorkers` and `readBudgetCeiling` from `parallel-status.ts` into `auto-progress.ts`. Added two new private fields to `AutoProgressPoller`: `budgetCeilingCache` (30s TTL cache for the budget ceiling value) and `lastBudgetAlertFired` (boolean guard preventing duplicate toasts). Both are reset in `onProcessExit()` and `onNewConversation()`.

In `poll()`, after counting pending captures, the new step reads parallel worker status files. When workers are found, it fetches or reuses the cached budget ceiling, computes `budgetPercent` on each worker, and checks if any exceed 80%. On first crossing, a `vscode.window.showWarningMessage` toast fires listing the over-budget worker IDs. The alert resets when all workers drop below 80%, enabling re-firing on subsequent crossings.

The `workers` and `budgetAlert` fields (already defined on `AutoProgressData` from T01) are populated and sent to the webview.

## Verification

- `npm run build` — no type errors, clean build
- `npx vitest run` — all 265 tests pass (15 test files), zero regressions
- When `.gsd/parallel/` doesn't exist, `readParallelWorkers()` returns `null`, `workers` stays `null`, `budgetAlert` stays `false` — existing behavior unchanged

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run build` | 0 | ✅ pass | 3.2s |
| 2 | `npx vitest run` | 0 | ✅ pass | 3.2s |

## Diagnostics

- Check GSD output channel for `Parallel workers: N` lines during auto-mode polling
- Check GSD output channel for `Budget alert fired for: ...` when toast triggers
- Workers with `stale: true` are included in data sent to webview for UI indicators
- When no `.gsd/parallel/` directory exists, no parallel-related output appears (graceful no-op)

## Deviations

None

## Known Issues

None

## Files Created/Modified

- `src/extension/auto-progress.ts` — Added parallel-status import, budget ceiling cache, alert guard, parallel worker reading in poll(), and workers/budgetAlert fields in progress data
