---
estimated_steps: 5
estimated_files: 3
---

# T01: Add WorkerProgress types and parallel status reader with tests

**Slice:** S01 — Parallel Worker Progress & Budget Alerts
**Milestone:** M014

## Description

Create the foundational types and pure filesystem reader functions for parallel worker status. This task produces the `WorkerProgress` interface, extends `AutoProgressData` with `workers` and `budgetAlert` fields, and implements two pure functions: `readParallelWorkers(cwd)` to parse `.gsd/parallel/*.status.json` and `readBudgetCeiling(cwd)` to extract `budget_ceiling` from `.gsd/preferences.md`. Comprehensive unit tests cover all edge cases.

## Steps

1. **Add types to `src/shared/types.ts`:**
   - Add `WorkerProgress` interface:
     ```typescript
     export interface WorkerProgress {
       id: string;           // milestoneId from status file
       pid: number;
       state: "running" | "paused" | "stopped" | "error";
       currentUnit: { type: string; id: string } | null;
       completedUnits: number;
       cost: number;
       budgetPercent: number | null;  // null when no budget_ceiling configured
       lastHeartbeat: number;
       stale: boolean;                // heartbeat > 30s ago
     }
     ```
   - Extend `AutoProgressData` with two new optional fields:
     ```typescript
     workers?: WorkerProgress[] | null;
     budgetAlert?: boolean;
     ```

2. **Create `src/extension/parallel-status.ts`** with two exported functions:
   - `readParallelWorkers(cwd: string): WorkerProgress[] | null` — reads all `.gsd/parallel/*.status.json` files. Uses `fs.readdirSync` + `fs.readFileSync`. Returns `null` if directory doesn't exist or is empty. For each file:
     - **Filter filenames**: only process files matching the pattern `/^[^(]+\.status\.json$/` — this rejects Dropbox conflicted copies which contain `(` in the filename (Knowledge #4).
     - Parse JSON, wrap in try/catch — skip corrupt files silently.
     - Map to `WorkerProgress`: extract `milestoneId` → `id`, `pid`, `state`, `currentUnit` (map `{ type, id }` or null), `completedUnits` (count of `completedUnits` array), `cost`, `lastHeartbeat`.
     - Compute `stale`: `Date.now() - lastHeartbeat > 30_000`.
     - Leave `budgetPercent` as `null` — the caller (poller) computes this with `readBudgetCeiling()`.
   - `readBudgetCeiling(cwd: string): number | null` — reads `.gsd/preferences.md`, scans for `budget_ceiling:` line (key-value format like `budget_ceiling: 5.00`), parses the number. Returns `null` if file missing, key not found, or value not a valid number.

3. **Create `src/extension/__tests__/parallel-status.test.ts`** — vitest tests:
   - **Happy path**: create temp dir with 2 valid `.status.json` files, verify `readParallelWorkers()` returns correct array with all fields mapped.
   - **Missing directory**: verify returns `null`.
   - **Empty directory**: verify returns `null`.
   - **Corrupt JSON**: create a file with invalid JSON, verify it's skipped (other valid files still returned).
   - **Conflicted copy filtering**: create files like `M001 (Kile's conflicted copy).status.json`, verify they're excluded.
   - **Stale detection**: create a status file with `lastHeartbeat` > 30s ago, verify `stale: true`.
   - **readBudgetCeiling** — happy path: preferences.md with `budget_ceiling: 5.00` → returns `5.00`.
   - **readBudgetCeiling** — missing file: returns `null`.
   - **readBudgetCeiling** — no key: preferences.md without `budget_ceiling` → returns `null`.
   - Use `os.tmpdir()` + `fs.mkdtempSync()` for test fixtures. Clean up in afterEach.

4. **Verify build**: Run `npm run build` to confirm no type errors from the new interface additions.

5. **Run tests**: `npx vitest run src/extension/__tests__/parallel-status.test.ts`

## Must-Haves

- [ ] `WorkerProgress` interface added to `src/shared/types.ts`
- [ ] `AutoProgressData` extended with `workers?: WorkerProgress[] | null` and `budgetAlert?: boolean`
- [ ] `readParallelWorkers()` handles: valid files, missing dir, empty dir, corrupt JSON, conflicted copies
- [ ] `readBudgetCeiling()` parses `budget_ceiling` from preferences.md
- [ ] Stale detection based on 30s heartbeat threshold
- [ ] All unit tests pass

## Verification

- `npx vitest run src/extension/__tests__/parallel-status.test.ts` — all tests green
- `npm run build` — no type errors

## Inputs

- `src/shared/types.ts` — existing `AutoProgressData` interface to extend
- S01 research doc — `SessionStatus` schema from gsd-pi's `session-status-io.ts` defining the JSON structure of `.gsd/parallel/*.status.json`

## Expected Output

- `src/shared/types.ts` — extended with `WorkerProgress` interface and new fields on `AutoProgressData`
- `src/extension/parallel-status.ts` — new module with `readParallelWorkers()` and `readBudgetCeiling()` functions
- `src/extension/__tests__/parallel-status.test.ts` — comprehensive test suite covering all edge cases

## Observability Impact

- **Signals changed:** `AutoProgressData` now carries optional `workers` and `budgetAlert` fields. When the poller (T02) populates these, the webview receives parallel worker state.
- **Inspection:** Import `readParallelWorkers(cwd)` in a Node REPL or test to inspect `.gsd/parallel/*.status.json` parsing. `readBudgetCeiling(cwd)` reads `.gsd/preferences.md`.
- **Failure visibility:** Corrupt status files are silently skipped — the function returns fewer workers but doesn't throw. Missing directory returns `null`. Stale workers (heartbeat > 30s) are marked `stale: true` for UI display. Dropbox conflicted copies are filtered by filename pattern.
- **Future agent tips:** Run `npx vitest run src/extension/__tests__/parallel-status.test.ts` to validate all edge cases. Check `WorkerProgress.stale` to detect unresponsive workers.
