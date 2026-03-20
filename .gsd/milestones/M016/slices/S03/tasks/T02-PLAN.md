---
estimated_steps: 5
estimated_files: 12
---

# T02: Convert all readFileSync/readdirSync to async across extension source

**Slice:** S03 — Bundle Optimization & Async I/O
**Milestone:** M016

## Description

Convert all synchronous file I/O (`readFileSync`, `readdirSync`, `existsSync` used as a guard before readFileSync) to async equivalents (`fs.promises.readFile`, `fs.promises.readdir`) across all extension source files. This eliminates event-loop blocking on the 3-second auto-progress poller (R006 hot-path requirement) and establishes async-only I/O as a codebase standard.

The codebase already uses `fs.promises.readFile` in `state-parser.ts` and `dashboard-parser.ts` (for STATE.md reading), so the pattern is established.

**Hot-path files (3s auto-progress poller — required by R006):**
- `src/extension/captures-parser.ts` — `countPendingCaptures()`: sync function with `existsSync` + `readFileSync`. Make async, replace with try/catch around `fs.promises.readFile`.
- `src/extension/parallel-status.ts` — `readParallelWorkers()`: `readdirSync` + `readFileSync` loop. Make async. `readBudgetCeiling()`: `readFileSync`. Make async.
- `src/extension/dashboard-parser.ts` — `findFile()` helper: `readdirSync`. Make async. Two `readFileSync` calls in `buildDashboardData()` (already async function) for ROADMAP.md and PLAN.md. Replace with `await fs.promises.readFile`.

**Call site updates:**
- `src/extension/auto-progress.ts` — Add `await` before `countPendingCaptures()`, `readParallelWorkers()`, `readBudgetCeiling()`. All are already inside `async` methods.

**Cold-path files (good hygiene — not required by R006 but eliminates all sync I/O):**
- `src/extension/command-fallback.ts` — line 106: `readFileSync` in async `handleSlashGsdFallback()`. Direct swap.
- `src/extension/file-ops.ts` — line 41: `readFileSync` in `cleanStaleCrashLock()`. Currently sync, called during pre-launch. Make async, update caller.
- `src/extension/health-check.ts` — lines 130, 175, 261: three `readFileSync` calls in async `runHealthCheck()`. Direct swap.
- `src/extension/metrics-parser.ts` — line 253: `readFileSync` in `loadMetricsLedger()`. Make async, update caller in message-dispatch.
- `src/extension/rpc-client.ts` — line 203: `readFileSync` for .cmd wrapper parsing in `parseWindowsCmdWrapper`. Called once at process spawn. Make the function async, replace with `await fs.promises.readFile`. Also has `existsSync` — replace with `fs.promises.access` or try/catch. Update callers `resolveGsdPath` to be async.
- `src/extension/webview-provider.ts` — line 123: `readFileSync` for package.json version. Called once at init. Make async or cache.
- `src/extension/message-dispatch.ts` — line 344: calls `loadMetricsLedger(cwd)` which becomes async. Add `await`. Already inside async `handleWebviewMessage`.

**Test updates:**
- `src/extension/auto-progress.test.ts` — mock for `countPendingCaptures` must return a `Promise<number>` instead of `number`. The mock factory uses `(...args) => mockCountPendingCaptures(...args)` so just ensure `mockCountPendingCaptures.mockReturnValue()` calls use `Promise.resolve()` or the mock naturally handles async.
- `src/extension/file-ops.test.ts` — `cleanStaleCrashLock` tests call it synchronously. Since it becomes async, tests must `await` it.

**Scope note on `existsSync`:** Only convert `existsSync` where it's paired 1:1 with a `readFileSync` being removed (captures-parser: replace guard+read with try/catch on read; file-ops: similar). Do NOT broadly convert all `existsSync` calls — those are a separate concern (they guard logic paths, not just file reads).

## Steps

1. **Convert hot-path files to async:**
   - `captures-parser.ts`: Change `countPendingCaptures(cwd: string): number` → `countPendingCaptures(cwd: string): Promise<number>`. Remove `existsSync` check — wrap `await fs.promises.readFile()` in try/catch that returns 0 on any error (including ENOENT). Keep `countPendingInContent` as a sync pure function (it only operates on strings).
   - `parallel-status.ts`: Change `readParallelWorkers` return to `Promise<Array<...> | null>`, `readBudgetCeiling` return to `Promise<number | null>`. Replace `readdirSync` with `await fs.promises.readdir`, `readFileSync` with `await fs.promises.readFile`. Keep the same try/catch error handling patterns.
   - `dashboard-parser.ts`: Change `findFile` to `async function findFile(dir: string, suffix: string): Promise<string | null>`. Replace `readdirSync` with `await fs.promises.readdir`. In `buildDashboardData`, change the two `readFileSync` calls (for ROADMAP.md ~line 192 and PLAN.md ~line 208) to `await fs.promises.readFile`. Add `await` before the two `findFile` calls.

2. **Update auto-progress.ts call sites:**
   - `poll()` method (~line 237): change `countPendingCaptures(cwd)` to `await countPendingCaptures(cwd)`
   - `poll()` method (~line 240): change `readParallelWorkers(cwd)` to `await readParallelWorkers(cwd)`
   - `poll()` method (~line 248): change `readBudgetCeiling(cwd)` to `await readBudgetCeiling(cwd)`
   - `handleDiscussionPause()` method (~line 135): change `countPendingCaptures(cwd)` to `await countPendingCaptures(cwd)`

3. **Convert cold-path files to async:**
   - `command-fallback.ts` line 106: replace `fs.readFileSync(statePath, "utf8")` with `await fs.promises.readFile(statePath, "utf8")`. The containing function is already async.
   - `file-ops.ts` line 41: `cleanStaleCrashLock()` is sync. Make it `async`, replace `readFileSync` with `await fs.promises.readFile`. Find its caller(s) and add `await`.
   - `health-check.ts` lines 130, 175, 261: replace all three `fs.readFileSync` with `await fs.promises.readFile`. The containing function `runHealthCheck()` is already async.
   - `metrics-parser.ts` line 253: `loadMetricsLedger()` is sync. Make it `async`, replace `readFileSync` with `await fs.promises.readFile`. Update caller in `message-dispatch.ts` line 344 to `await loadMetricsLedger(cwd)` (already inside async `handleWebviewMessage`).
   - `rpc-client.ts` line 203: `parseWindowsCmdWrapper` is sync and uses `readFileSync` + `existsSync`. Make it async. Replace `readFileSync` with `await fs.promises.readFile`, `existsSync` with try/catch or `fs.promises.access`. Make callers in `resolveGsdPath` async. Propagate async up to the spawn call site.
   - `webview-provider.ts` line 123: convert the version-reading to async. This is in a getter or init method — may need to cache the result or make the init async.
   - `file-ops.test.ts`: update `cleanStaleCrashLock` test calls to `await` since the function becomes async.

4. **Update test mocks:**
   - In `auto-progress.test.ts`, the mock for `countPendingCaptures` uses `mockCountPendingCaptures` via `vi.fn()`. Check all `.mockReturnValue(N)` calls and change to `.mockResolvedValue(N)` (or ensure `.mockReturnValue(Promise.resolve(N))`). The mock factory `(...args) => mockCountPendingCaptures(...args)` will pass through the promise correctly.
   - In `file-ops.test.ts`, `cleanStaleCrashLock` tests call it synchronously. Since it becomes async, change all `cleanStaleCrashLock(...)` calls to `await cleanStaleCrashLock(...)` and make the test callbacks async.
   - Check if any other test files directly import the changed functions and need updates.

5. **Verify:**
   - Run `rg "readFileSync|readdirSync" src/extension/ --type ts | grep -v test` — must return zero results
   - Run `npm test` — all 618+ tests pass
   - Run `npm run build` — build succeeds

## Must-Haves

- [ ] `countPendingCaptures` returns `Promise<number>`
- [ ] `readParallelWorkers` returns `Promise<Array<...> | null>`
- [ ] `readBudgetCeiling` returns `Promise<number | null>`
- [ ] `findFile` in dashboard-parser returns `Promise<string | null>`
- [ ] All `readFileSync` and `readdirSync` in ROADMAP/PLAN reading paths replaced
- [ ] `auto-progress.ts` call sites have `await`
- [ ] All cold-path `readFileSync` converted (command-fallback, file-ops, health-check, metrics-parser, rpc-client, webview-provider)
- [ ] Zero `readFileSync` or `readdirSync` in non-test extension source
- [ ] Test mocks updated for async return types
- [ ] All 618+ tests pass
- [ ] Build succeeds

## Verification

- `rg "readFileSync|readdirSync" src/extension/ --type ts | grep -v test` returns zero results
- `npm test` — all 618+ tests pass
- `npm run build` — build succeeds cleanly

## Inputs

- All 10 source files listed above in their current sync-I/O state
- `auto-progress.test.ts` — mock structure for `countPendingCaptures` (uses `vi.fn()` with `mockReturnValue`)
- Knowledge entry K18: pattern is `fs.promises.readFile` already used in `state-parser.ts` and `dashboard-parser.ts` (STATE.md reading)

## Expected Output

- `src/extension/captures-parser.ts` — `countPendingCaptures` is async
- `src/extension/parallel-status.ts` — `readParallelWorkers` and `readBudgetCeiling` are async
- `src/extension/dashboard-parser.ts` — `findFile` is async, ROADMAP/PLAN reads are async
- `src/extension/auto-progress.ts` — all file-reading call sites use `await`
- `src/extension/command-fallback.ts` — `readFileSync` → `fs.promises.readFile`
- `src/extension/file-ops.ts` — `cleanStaleCrashLock` is async
- `src/extension/health-check.ts` — all three `readFileSync` → `fs.promises.readFile`
- `src/extension/metrics-parser.ts` — `loadMetricsLedger` is async
- `src/extension/rpc-client.ts` — `parseWindowsCmdWrapper` and `resolveGsdPath` are async
- `src/extension/webview-provider.ts` — version reading is async
- `src/extension/message-dispatch.ts` — `loadMetricsLedger` call uses `await`
- `src/extension/auto-progress.test.ts` — mock returns promises
- `src/extension/file-ops.test.ts` — `cleanStaleCrashLock` calls use `await`
