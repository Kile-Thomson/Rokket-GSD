# S01: Parallel Worker Progress & Budget Alerts

**Goal:** During parallel auto-mode, the progress widget shows multiple workers with per-worker phase, task name, and cost. A budget alert toast fires when any worker exceeds 80% of its budget. Graceful degradation when no parallel data is present.
**Demo:** Run `gsd auto` on a multi-milestone project. The progress widget shows per-worker cards with state badges, current unit descriptions, cost, and budget bars. When a worker's cost crosses 80% of `budget_ceiling`, a VS Code warning toast appears. Without `.gsd/parallel/`, the widget renders identically to current behavior.

## Must-Haves

- `WorkerProgress` type definition in `src/shared/types.ts` with `workers` and `budgetAlert` fields on `AutoProgressData`
- `readParallelWorkers(cwd)` pure function reads `.gsd/parallel/*.status.json`, returns `WorkerProgress[]` or `null`
- `readBudgetCeiling(cwd)` pure function parses `budget_ceiling` from `.gsd/preferences.md`
- `AutoProgressPoller.poll()` integrates parallel reader and computes budget percentages
- Budget alert VS Code toast fires at 80% threshold with duplicate prevention (track `lastBudgetAlertLevel`)
- Webview renders worker cards below existing progress bar when `data.workers` is non-null
- Each worker card shows: milestone ID, state badge, current unit description, cost, budget bar
- Graceful degradation: `workers` is `null` when `.gsd/parallel/` is missing/empty — widget renders as today
- Corrupt/malformed status files are silently skipped
- Dropbox conflicted copies (files not matching `*.status.json` exactly) are filtered out

## Proof Level

- This slice proves: contract + integration
- Real runtime required: yes (manual verification against gsd-pi 2.28.0 parallel auto-mode)
- Human/UAT required: yes (visual check of worker cards and budget bar rendering)

## Verification

- `npx vitest run src/extension/__tests__/parallel-status.test.ts` — unit tests for `readParallelWorkers()` and `readBudgetCeiling()` with fixture JSON files, missing dir, corrupt files, conflicted copies
- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — extended tests for worker card rendering, budget alert badge, graceful degradation (null workers)
- `npm run build` — no type errors, no regressions
- Manual: run `gsd auto` with parallel workers, confirm per-worker cards appear with live-updating state. Set `budget_ceiling: 0.50`, confirm warning toast at 80%.

## Observability / Diagnostics

- Runtime signals: `AutoProgressPoller` logs parallel worker count and budget alert events to the output channel
- Inspection surfaces: webview `#autoProgressWidget` DOM shows worker cards; extension output channel shows poll diagnostics
- Failure visibility: corrupt status files logged with filename to output channel; stale workers marked with `stale: true` in UI
- Redaction constraints: none (no secrets in parallel status files)

## Integration Closure

- Upstream surfaces consumed: `src/extension/auto-progress.ts` (AutoProgressPoller), `src/shared/types.ts` (AutoProgressData), `src/webview/auto-progress.ts` (render), `.gsd/parallel/*.status.json` (filesystem protocol)
- New wiring introduced in this slice: `parallel-status.ts` imported into `auto-progress.ts` extension-side; `AutoProgressData.workers` consumed by webview renderer
- What remains before the milestone is truly usable end-to-end: S02 (validate-milestone phase + slash commands), S03 (model picker grouping + discussion pause)

## Tasks

- [x] **T01: Add WorkerProgress types and parallel status reader with tests** `est:45m`
  - Why: Foundation types and pure filesystem reader that all other tasks depend on. Must handle edge cases (missing dir, corrupt files, conflicted copies) before wiring into the poller.
  - Files: `src/shared/types.ts`, `src/extension/parallel-status.ts`, `src/extension/__tests__/parallel-status.test.ts`
  - Do: Add `WorkerProgress` interface and `workers`/`budgetAlert` fields to `AutoProgressData` in types.ts. Create `parallel-status.ts` with `readParallelWorkers(cwd)` and `readBudgetCeiling(cwd)`. Filter filenames to only `*.status.json` (reject Dropbox conflicted copies). Parse each JSON file, skip corrupt/malformed entries. Compute `stale` from heartbeat > 30s. Write unit tests with fixture data covering: happy path (multiple workers), missing directory, empty directory, corrupt JSON, conflicted copy filtering, budget ceiling parsing from preferences.md.
  - Verify: `npx vitest run src/extension/__tests__/parallel-status.test.ts` — all tests pass
  - Done when: `readParallelWorkers()` returns correct `WorkerProgress[]` for valid fixtures, `null` for missing dir, skips corrupt files; `readBudgetCeiling()` parses markdown key-value; all tests green

- [x] **T02: Wire parallel reader into AutoProgressPoller and add budget alert toast** `est:30m`
  - Why: Connects the parallel reader to the existing poll loop and adds the user-facing budget alert toast. This is the extension-side integration point.
  - Files: `src/extension/auto-progress.ts`, `src/extension/parallel-status.ts`
  - Do: Import `readParallelWorkers` and `readBudgetCeiling` into `auto-progress.ts`. In `poll()`, after existing dashboard data fetch, call both readers. Compute `budgetPercent = cost / budgetCeiling` per worker. Set `progress.workers` and `progress.budgetAlert`. Add `lastBudgetAlertLevel` field to the poller class to prevent duplicate toasts. Fire `vscode.window.showWarningMessage()` when any worker first crosses 80%. Cache `budgetCeiling` with a 30s TTL to avoid re-parsing preferences.md every 3s. Log worker count and budget alerts to output channel.
  - Verify: `npm run build` — no type errors. Manual: create mock `.gsd/parallel/` status files, confirm poller picks them up and sends `workers` array to webview.
  - Done when: `AutoProgressData` sent to webview includes `workers` array when parallel files exist, `null` otherwise; budget alert toast fires once at 80% threshold

- [x] **T03: Render parallel worker cards in webview progress widget with tests** `est:45m`
  - Why: User-facing UI — the worker cards make parallel auto-mode visible to the user. Tests ensure rendering correctness and graceful degradation.
  - Files: `src/webview/auto-progress.ts`, `src/webview/__tests__/auto-progress.test.ts`, `src/webview/styles.css`
  - Do: In `render()`, after the existing detail row, add a worker cards section when `data.workers` is non-null and non-empty. Each worker card shows: milestone ID (title), state badge (running/paused/stopped/error with color), current unit description (type + id), cost, and a budget bar (fill color changes at 80%). Mark stale workers with a visual indicator (dimmed + "stale" label). Add CSS for `.gsd-auto-progress-workers` container and `.gsd-auto-progress-worker-card` cards. Add tests: worker cards render with correct data, budget bar shows percentage, stale workers are marked, null workers renders no cards (graceful degradation), budget alert badge appears when `budgetAlert` is true.
  - Verify: `npx vitest run src/webview/__tests__/auto-progress.test.ts` — all tests pass including new worker card tests
  - Done when: Worker cards render correctly for all states, budget bar fills proportionally, stale workers are visually distinct, null workers produces identical output to current behavior, all tests green

## Files Likely Touched

- `src/shared/types.ts`
- `src/extension/parallel-status.ts` (new)
- `src/extension/__tests__/parallel-status.test.ts` (new)
- `src/extension/auto-progress.ts`
- `src/webview/auto-progress.ts`
- `src/webview/__tests__/auto-progress.test.ts`
- `src/webview/styles.css`
