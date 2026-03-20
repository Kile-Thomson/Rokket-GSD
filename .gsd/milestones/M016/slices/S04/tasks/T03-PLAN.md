---
estimated_steps: 5
estimated_files: 10
---

# T03: Resolve extension-side quick-wins and update README

**Slice:** S04 — Quick Wins & Coverage Reporting
**Milestone:** M016

## Description

Resolve the remaining 4 extension-side quick-wins: timer clears in the abort handler (FT-17/FT-22), logging in empty catch blocks (CQ-017), file rename from `auto-progress.ts` to `auto-progress-poller.ts` (CQ-019), and `@internal` JSDoc on test-only exports (CQ-021). Plus update README version badges (DOC-01).

**Key constraint for CQ-019:** The rename only affects `src/extension/auto-progress.ts` — NOT `src/webview/auto-progress.ts` (that's a different file). Three extension files import from it: `session-state.ts`, `webview-provider.ts`, and `auto-progress.test.ts`. Run `npm run build` immediately after the rename to catch missed imports.

**Key constraint for FT-17/FT-22:** The timer clears must follow the same pattern as `cleanupSessionState` in session-state.ts (lines 109–117). Access session state directly: `const s = ctx.getSession(sessionId); if (s.promptWatchdog) { clearTimeout(s.promptWatchdog.timer); s.promptWatchdog = null; }` etc.

## Steps

1. **FT-17/FT-22 — timer clears in abort handler:** In `src/extension/message-dispatch.ts`, find the `case "interrupt"` / `case "cancel_request"` block (~line 253). After the successful `await client.abort()` call (before the catch block), add timer cleanup:
   ```ts
   await client.abort();
   // Clear watchdog/fallback timers on abort (FT-17/FT-22)
   const sess = ctx.getSession(sessionId);
   if (sess.promptWatchdog) { clearTimeout(sess.promptWatchdog.timer); sess.promptWatchdog = null; }
   if (sess.slashWatchdog) { clearTimeout(sess.slashWatchdog); sess.slashWatchdog = null; }
   if (sess.gsdFallbackTimer) { clearTimeout(sess.gsdFallbackTimer); sess.gsdFallbackTimer = null; }
   ```
   This matches the pattern in `cleanupSessionState` (session-state.ts lines 109–117).

2. **CQ-017 — logging in empty catch blocks:** Add minimal logging to these specific empty catches:
   - `src/extension/health-check.ts` line ~77: `} catch (err) { /* Node.js check failed */ }`  — this already pushes an error issue in the next line, so just add a descriptive comment (it's not actually empty in terms of side effects — the push is the next statement in the catch)
   
   Actually, re-examine each catch carefully. The research flagged 6 catches. For each:
   - **health-check.ts ~77:** The catch already pushes `"Node.js not found in PATH"` — this is NOT empty. Add comment: `// Node.js binary not found or not executable`
   - **health-check.ts ~104:** The catch already handles the error (pushes gsd-pi issue). Add comment: `// gsd-pi binary not found or version unreadable`
   - **update-checker.ts ~77:** `} catch { // gh not installed or not authenticated — continue }` — already has comment. No change needed.
   - **update-checker.ts ~97:** `} catch { // No credential manager — continue }` — already has comment. No change needed.
   - **update-checker.ts ~228:** Empty catch with `resolve(null)`. Add: `} catch { resolve(null); /* JSON parse failed — treat as no release notes */ }`
   - **update-checker.ts ~267:** Empty catch with `resolve([])`. Add: `} catch { resolve([]); /* JSON parse failed — treat as no releases */ }`
   - **rpc-client.ts ~698:** `} catch { return false; }` — this is a ping health check where failure = return false. Add comment: `// get_state failed — process is not responding`
   
   Key rule: Do NOT add `console.warn` to catches that have intentional fallback logic (returning false, resolving empty, pushing errors). Just add descriptive comments. Only add actual logging if the catch truly swallows an unexpected error.

3. **CQ-019 — rename auto-progress.ts:** 
   - Rename `src/extension/auto-progress.ts` → `src/extension/auto-progress-poller.ts` (use `git mv`)
   - Rename `src/extension/auto-progress.test.ts` → `src/extension/auto-progress-poller.test.ts` (use `git mv`)
   - Update import in `src/extension/session-state.ts`: `from "./auto-progress"` → `from "./auto-progress-poller"`
   - Update import in `src/extension/webview-provider.ts`: `from "./auto-progress"` → `from "./auto-progress-poller"`
   - Update import in `src/extension/auto-progress-poller.test.ts`: `from "./auto-progress"` → `from "./auto-progress-poller"`
   - Run `npm run build` immediately to verify no broken imports

4. **CQ-021 — @internal JSDoc on test-only exports:** Search for exported functions/constants that are only imported in test files. The two already tagged are in `renderer.ts:303` and `slash-menu.ts:112`. Scan with: `grep -rn "^export " src/ --include="*.ts" | grep -v ".test.ts" | grep -v "__tests__"` then cross-reference each export against test imports. Add `/** @internal — exported for testing */` above any export used only in test files. This is a best-effort audit — tag obvious ones, don't spend time on ambiguous cases.

5. **DOC-01 — README badges:** In `README.md`:
   - Line 20: Change `0.2.49` → `0.2.62`
   - Line 21: Change `v2.12--v2.28` → `v2.12--v2.35`

After all changes: run `npx vitest --run` and `npm run build` to verify.

## Must-Haves

- [ ] Abort handler clears promptWatchdog, slashWatchdog, and gsdFallbackTimer
- [ ] All 6 flagged catch blocks have descriptive comments or logging
- [ ] `src/extension/auto-progress-poller.ts` exists, `src/extension/auto-progress.ts` does not
- [ ] All imports updated for the rename — build succeeds
- [ ] README badges show current version numbers
- [ ] All 618+ tests pass
- [ ] Build succeeds

## Verification

- `npx vitest --run` — all tests pass
- `npm run build` — esbuild succeeds
- `test -f src/extension/auto-progress-poller.ts` — renamed file exists
- `! test -f src/extension/auto-progress.ts` — old file removed
- `! grep -q "0.2.49" README.md` — DOC-01 done
- `grep -q "v2.12--v2.35" README.md` — version range updated
- `grep -q "promptWatchdog" src/extension/message-dispatch.ts` — timer clear present in abort handler

## Inputs

- `src/extension/message-dispatch.ts` — abort handler at lines ~253–273; currently only calls `client.abort()` and `stopActivityMonitor`, does NOT clear promptWatchdog/slashWatchdog/gsdFallbackTimer
- `src/extension/session-state.ts` — has `cleanupSessionState` at line 103 showing the timer-clear pattern (lines 109–117)
- `src/extension/health-check.ts` — catches at lines ~77, ~104 (both have side effects, just need comments)
- `src/extension/update-checker.ts` — catches at lines ~77, ~97 (already have comments), ~228, ~267 (need comments)
- `src/extension/rpc-client.ts` — catch at line ~698 (ping returning false, needs comment)
- `src/extension/auto-progress.ts` — file to rename, imported by session-state.ts, webview-provider.ts, and its own test
- `README.md` — badges at lines 20–21 showing stale versions

## Expected Output

- `src/extension/message-dispatch.ts` — abort handler now clears all 3 timer types after successful abort
- `src/extension/health-check.ts` — descriptive comments on catch blocks
- `src/extension/update-checker.ts` — descriptive comments on catch blocks at lines ~228, ~267
- `src/extension/rpc-client.ts` — descriptive comment on catch at line ~698
- `src/extension/auto-progress-poller.ts` — renamed from auto-progress.ts
- `src/extension/auto-progress-poller.test.ts` — renamed from auto-progress.test.ts
- `src/extension/session-state.ts` — import updated
- `src/extension/webview-provider.ts` — import updated
- `README.md` — badges updated to 0.2.62 and v2.12–v2.35
