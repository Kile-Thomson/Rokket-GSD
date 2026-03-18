---
estimated_steps: 4
estimated_files: 2
---

# T02: Wire parallel reader into AutoProgressPoller and add budget alert toast

**Slice:** S01 — Parallel Worker Progress & Budget Alerts
**Milestone:** M014

## Description

Connect the parallel status reader (from T01) into the existing `AutoProgressPoller.poll()` loop. After the existing dashboard data fetch, read parallel worker files and budget ceiling, compute budget percentages, populate the `workers` and `budgetAlert` fields on `AutoProgressData`, and fire a VS Code warning toast when any worker first crosses 80% of the budget ceiling.

## Steps

1. **Add new fields to `AutoProgressPoller` class** in `src/extension/auto-progress.ts`:
   - `private budgetCeilingCache: { value: number | null; expires: number } | null = null;` — 30s TTL cache for budget ceiling
   - `private lastBudgetAlertFired: boolean = false;` — prevents duplicate alert toasts
   - Reset both in `onProcessExit()` and `onNewConversation()`

2. **Import and wire parallel reader into `poll()`**:
   - Add `import { readParallelWorkers, readBudgetCeiling } from "./parallel-status";` at top
   - After step 4 (pending captures), add a new step:
     ```typescript
     // 5. Read parallel worker status
     const workers = readParallelWorkers(cwd);
     let budgetAlert = false;
     
     if (workers && workers.length > 0) {
       // Get budget ceiling (cached 30s)
       let budgetCeiling: number | null = null;
       if (this.budgetCeilingCache && Date.now() < this.budgetCeilingCache.expires) {
         budgetCeiling = this.budgetCeilingCache.value;
       } else {
         budgetCeiling = readBudgetCeiling(cwd);
         this.budgetCeilingCache = { value: budgetCeiling, expires: Date.now() + 30_000 };
       }
       
       // Compute budget percentages
       if (budgetCeiling && budgetCeiling > 0) {
         for (const w of workers) {
           w.budgetPercent = (w.cost / budgetCeiling) * 100;
         }
         budgetAlert = workers.some(w => (w.budgetPercent ?? 0) >= 80);
       }
       
       // Fire budget alert toast (once per crossing)
       if (budgetAlert && !this.lastBudgetAlertFired) {
         this.lastBudgetAlertFired = true;
         const overBudget = workers.filter(w => (w.budgetPercent ?? 0) >= 80);
         const names = overBudget.map(w => w.id).join(", ");
         vscode.window.showWarningMessage(
           `⚠️ Budget alert: worker(s) ${names} have exceeded 80% of budget ceiling ($${budgetCeiling!.toFixed(2)})`
         );
         this.output.appendLine(`[${this.sessionId}] Budget alert fired for: ${names}`);
       } else if (!budgetAlert) {
         this.lastBudgetAlertFired = false;
       }
       
       this.output.appendLine(`[${this.sessionId}] Parallel workers: ${workers.length}`);
     }
     ```
   - Add `workers` and `budgetAlert` to the `progress` object:
     ```typescript
     const progress: AutoProgressData = {
       // ... existing fields ...
       workers: workers || null,
       budgetAlert,
     };
     ```

3. **Verify no side effects on existing behavior**: When `.gsd/parallel/` doesn't exist, `readParallelWorkers()` returns `null`, `workers` stays `null`, `budgetAlert` stays `false` — existing behavior is unchanged.

4. **Build and verify**: Run `npm run build` to confirm no type errors. Run existing tests `npx vitest run src/extension/` to verify no regressions.

## Must-Haves

- [ ] Parallel reader called in `poll()` after dashboard data fetch
- [ ] Budget ceiling cached with 30s TTL
- [ ] Budget percentages computed per worker when ceiling is available
- [ ] VS Code warning toast fires once when any worker crosses 80%
- [ ] `lastBudgetAlertFired` prevents duplicate toasts
- [ ] Reset cache and alert state on process exit and new conversation
- [ ] `workers` and `budgetAlert` included in `AutoProgressData` sent to webview

## Verification

- `npm run build` — no type errors
- `npx vitest run` — no regressions in existing tests
- Manual: create `.gsd/parallel/M001.status.json` with mock data in a test project, run the extension, confirm poller logs "Parallel workers: 1" in the output channel

## Observability Impact

- Signals added: output channel logs parallel worker count per poll; budget alert events logged with worker IDs
- How a future agent inspects this: check the GSD output channel for `Parallel workers: N` and `Budget alert fired for: ...` lines
- Failure state exposed: if parallel reader throws, the existing poll error handler catches and logs it

## Inputs

- `src/extension/auto-progress.ts` — existing `AutoProgressPoller` class with `poll()` method
- `src/extension/parallel-status.ts` — `readParallelWorkers()` and `readBudgetCeiling()` from T01
- `src/shared/types.ts` — `WorkerProgress` and extended `AutoProgressData` from T01

## Expected Output

- `src/extension/auto-progress.ts` — modified to import and call parallel reader, compute budgets, fire alert toasts
