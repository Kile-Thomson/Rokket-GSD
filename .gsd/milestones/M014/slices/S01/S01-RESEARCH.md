# S01: Parallel Worker Progress & Budget Alerts — Research

**Date:** 2026-03-19
**Depth:** Targeted

## Summary

Parallel worker state is exposed via JSON files in `.gsd/parallel/` — one `<milestoneId>.status.json` per worker. The `SessionStatus` interface (from gsd-pi's `session-status-io.ts`) includes `milestoneId`, `pid`, `state` (running/paused/stopped/error), `currentUnit` (type + id + startedAt), `completedUnits`, `cost`, `lastHeartbeat`, `startedAt`, and `worktreePath`. This is a pure filesystem protocol — no RPC extension needed. The extension can read these files on the existing 3-second poll interval.

Budget ceiling comes from `.gsd/preferences.md` (`budget_ceiling` key). The extension doesn't currently read preferences, but it's a simple markdown key-value parse. Budget percentage = `worker.cost / budget_ceiling`. Alert threshold at 80% matches gsd-pi's own `getBudgetAlertLevel()` which fires at 75/80/90/100%.

The work is straightforward: extend the existing `AutoProgressPoller` to also scan `.gsd/parallel/*.status.json`, add a `workers` array to `AutoProgressData`, extend the webview renderer with worker cards, and fire a VS Code toast on budget threshold crossing.

## Recommendation

Read `.gsd/parallel/*.status.json` files in the existing `AutoProgressPoller.poll()` method. Parse `budget_ceiling` from `.gsd/preferences.md` once at poll start (cache with a 30s TTL). Compute `budgetPercent = cost / budget_ceiling` per worker. Send `workers` array and `budgetAlert` flag to the webview. Render worker cards below the existing progress bar. Fire `vscode.window.showWarningMessage()` from the extension host (not the webview) when any worker crosses 80%.

Graceful degradation: when `.gsd/parallel/` doesn't exist or is empty, `workers` is `null` and the widget renders as today.

## Implementation Landscape

### Key Files

- `src/shared/types.ts` — Add `WorkerProgress` interface and `workers`/`budgetAlert` fields to `AutoProgressData`
- `src/extension/auto-progress.ts` — Extend `poll()` to read `.gsd/parallel/*.status.json`, parse `budget_ceiling` from preferences, compute budget percentages, fire VS Code warning toast on 80% threshold
- `src/extension/dashboard-parser.ts` — No changes needed (parallel data is orthogonal to dashboard)
- `src/webview/auto-progress.ts` — Extend `render()` to show worker cards when `data.workers` is non-null. Each card shows: milestone ID, state badge, current unit description, cost, budget bar
- `src/webview/__tests__/auto-progress.test.ts` — Add tests for worker card rendering, budget alert badge, graceful degradation (null workers)

### New Files

- `src/extension/parallel-status.ts` — Pure function: `readParallelWorkers(cwd: string): WorkerProgress[] | null`. Reads `.gsd/parallel/*.status.json`, returns parsed array or null if directory missing/empty. Also `readBudgetCeiling(cwd: string): number | null` to parse `budget_ceiling` from `.gsd/preferences.md`.

### Data Flow

```
.gsd/parallel/*.status.json  →  readParallelWorkers()  →  AutoProgressPoller.poll()
.gsd/preferences.md          →  readBudgetCeiling()     →  budgetPercent computation
                                                         →  AutoProgressData.workers
                                                         →  webview auto-progress render
                                                         →  vscode.window.showWarningMessage (80%)
```

### Types to Add (in `types.ts`)

```typescript
export interface WorkerProgress {
  id: string;           // milestoneId
  pid: number;
  state: "running" | "paused" | "stopped" | "error";
  currentUnit: { type: string; id: string } | null;
  completedUnits: number;
  cost: number;
  budgetPercent: number | null;  // null when no budget_ceiling configured
  lastHeartbeat: number;
  stale: boolean;                // heartbeat > 30s ago or PID dead
}
```

And extend `AutoProgressData`:
```typescript
workers?: WorkerProgress[] | null;
budgetAlert?: boolean;           // true when any worker >= 80%
```

### Build Order

1. **Types first** (`types.ts`) — Add `WorkerProgress` interface and extend `AutoProgressData`. This unblocks all downstream work.
2. **Parallel reader** (`parallel-status.ts`) — Pure filesystem functions: `readParallelWorkers()` and `readBudgetCeiling()`. Unit-testable in isolation with mock files.
3. **Poller integration** (`auto-progress.ts` extension-side) — Wire parallel reader into `poll()`. Add budget alert toast logic with a `lastBudgetAlertLevel` field to prevent duplicate toasts.
4. **Webview rendering** (`auto-progress.ts` webview-side) — Worker cards UI. This is the most design-sensitive task but has no dependencies beyond the type additions.
5. **Tests** — Add to existing test file. Test worker rendering, budget badge, null/empty graceful degradation.

### Verification Approach

1. **Unit tests**: Mock `.gsd/parallel/` with fixture JSON files. Verify `readParallelWorkers()` returns correct data, handles missing dir, handles corrupt files. Verify webview renders worker cards and budget badges.
2. **Manual integration**: Run `gsd auto` with parallel workers against a multi-milestone project. Confirm the progress widget shows per-worker cards with live-updating state.
3. **Graceful degradation**: Run against a single-milestone project (no `.gsd/parallel/`). Confirm widget renders identically to current behavior.
4. **Budget alert**: Set `budget_ceiling: 0.50` in preferences, run until cost exceeds $0.40. Confirm VS Code warning toast appears.

## Constraints

- Must not add new node dependencies — `fs.readdirSync`/`readFileSync` are sufficient for the parallel directory scan.
- Poll interval stays at 3s — parallel file reads are synchronous and fast (typically 1-5 files, each <1KB).
- Budget alert toast must be sent from extension host (not webview) because `vscode.window.showWarningMessage` is an extension API.
- Stale detection: use heartbeat timeout (30s) since `process.kill(pid, 0)` may not work cross-platform in the extension host context.

## Common Pitfalls

- **Dropbox conflicted copies** — `.gsd/parallel/` files could have `(conflicted copy)` variants. Filter entries to only match `*.status.json` exactly, rejecting anything with extra text before the suffix.
- **Budget alert spam** — Without tracking the last alert level, the toast fires every 3s once threshold is crossed. Track `lastBudgetAlertLevel` per-poller and only fire on new level crossings (mirror gsd-pi's `getNewBudgetAlertLevel()` logic).
- **Stale workers appearing indefinitely** — Workers that crashed without cleanup leave orphan status files. Filter by heartbeat recency and mark as stale in the UI rather than hiding them (user needs to see the problem).
