# S01: Stability fixes & error surfacing

## Tasks

- [x] **T01: Extract duplicate formatNotes to shared helper** `est:15min`
  - **Why:** 3 duplicate formatting functions in index.ts risk drift and make maintenance harder
  - **Files:** `src/webview/helpers.ts`, `src/webview/index.ts`, `src/webview/helpers.test.ts`
  - **Do:** Extract `formatMarkdownNotes()` and `formatShortDate()` into helpers.ts, replace inline duplicates, add tests
  - **Verify:** All vitest tests pass, no duplicate formatting logic remains in index.ts

- [x] **T02: Cap RPC buffer size to prevent OOM** `est:15min`
  - **Why:** Runaway pi output could grow stdout buffer unbounded, crashing the extension host
  - **Files:** `src/extension/rpc-client.ts`
  - **Do:** Add 10MB cap on accumulated stdout buffer, truncate oldest data when exceeded
  - **Verify:** Buffer cap logic present in rpc-client.ts, extension compiles cleanly

- [x] **T03: Fix prompt watchdog timer leak** `est:10min`
  - **Why:** If the watchdog timer reference isn't properly managed, stale timers could accumulate
  - **Files:** `src/extension/rpc-client.ts`
  - **Do:** Audit watchdog timer lifecycle, confirm or fix reference management
  - **Verify:** Timer reference updates correctly on each prompt cycle

- [x] **T04: Replace silent catches in critical paths with visible errors** `est:30min`
  - **Why:** Silent catch blocks hide failures, making debugging impossible for agents and users
  - **Files:** `src/webview/index.ts`, `src/extension/rpc-client.ts`
  - **Do:** Audit catch blocks in critical paths, add structured error logging or user-visible feedback
  - **Verify:** No silent catches in critical RPC or state-management paths

- [x] **T05: Add loading spinners for changelog and dashboard** `est:20min`
  - **Why:** Async fetches (changelog, dashboard) show blank content during load, confusing users
  - **Files:** `src/webview/index.ts`, `src/webview/styles.css`
  - **Do:** Add spinner/loading state during changelog fetch and dashboard data load
  - **Verify:** Spinner visible during async operations, replaced by content on completion

## Verification

- [x] `npx vitest run` — all test suites pass
- [x] Extension compiles: `npm run build` succeeds
- [x] No regressions in webview rendering (manual or browser check)
- [x] Error paths surface visible feedback (not silently swallowed)

## Observability / Diagnostics

- **Runtime signals:** RPC buffer cap logs a warning when truncation occurs; silent-catch replacements emit structured error messages to the webview error surface
- **Inspection surfaces:** Loading spinners provide visual feedback for async state; watchdog timer state is inspectable via the prompt map in rpc-client
- **Failure visibility:** Catch blocks in critical paths now surface errors rather than swallowing them
- **Redaction:** No secrets or credentials involved in this slice
