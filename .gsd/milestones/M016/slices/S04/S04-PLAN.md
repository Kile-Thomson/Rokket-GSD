# S04: Quick Wins & Coverage Reporting

**Goal:** All 17 quick-win findings from the M015 S07 audit resolved, and Vitest v8 coverage reporting configured and generating reports.
**Demo:** `npx vitest --run --coverage` produces a per-file coverage report. All 618+ tests pass. `npm run build` succeeds. Grep checks confirm each quick-win is resolved (zero `escapeHtmlBasic` in tool-grouping, zero `RpcExportResult` in types, zero non-prefixed `@keyframes`, `prefers-reduced-motion` present in styles.css, etc.).

## Must-Haves

- Vitest v8 coverage provider installed and configured (R008)
- Coverage report generates on `npx vitest --run --coverage` with per-file line/branch/function percentages
- `prefers-reduced-motion` CSS media query covers all animations (CSS-003)
- Missing `:focus-visible` selectors added for interactive elements (CSS-007)
- All 12 non-prefixed `@keyframes` renamed to `gsd-*` with references updated; duplicate `spin` removed (CSS-014)
- `escapeHtmlBasic` replaced with imported `escapeHtml` from helpers.ts (SEC-07)
- Dead `RpcExportResult` type removed (FT-29)
- Default case added to message-handler.ts switch (FT-10)
- `resetState()` function exported from state.ts (TEST-06)
- `/gsd export` and `/export` descriptions clarified (FT-26)
- Timer clears (promptWatchdog, slashWatchdog, gsdFallbackTimer) added to abort handler (FT-17/FT-22)
- Logging added to 6 empty catch blocks (CQ-017)
- `auto-progress.ts` renamed to `auto-progress-poller.ts` with imports updated (CQ-019)
- `@internal` JSDoc added to remaining test-only exports (CQ-021)
- README version badges updated (DOC-01)
- All 618+ tests pass after all changes
- Build succeeds after all changes

## Verification

- `npx vitest --run --coverage` — generates coverage report, all tests pass
- `npm run build` — esbuild succeeds for both extension and webview
- `grep -q "prefers-reduced-motion" src/webview/styles.css` — CSS-003 done
- `! grep -q "@keyframes spin " src/webview/styles.css` — duplicate spin removed (CSS-014)
- `grep "@keyframes " src/webview/styles.css | grep -v "gsd-" | wc -l` — returns 0 (all prefixed)
- `! grep -q "escapeHtmlBasic" src/webview/tool-grouping.ts` — SEC-07 done
- `! grep -q "RpcExportResult" src/shared/types.ts` — FT-29 done
- `grep -q "resetState" src/webview/state.ts` — TEST-06 done
- `grep -q "default:" src/webview/message-handler.ts` — FT-10 done
- `! grep -q "0\.2\.49" README.md` — DOC-01 done
- `test -f src/extension/auto-progress-poller.ts` — CQ-019 done
- `! test -f src/extension/auto-progress.ts` — old file removed
- `npx vitest --run --coverage 2>&1 | grep -c "FAIL"` — returns 0 (no test failures in coverage run)

## Tasks

- [x] **T01: Configure Vitest v8 coverage reporting** `est:20m`
  - Why: R008 — no coverage data exists. Must establish baseline measurement before code changes so coverage threshold can be set per D023 strategy.
  - Files: `package.json`, `vitest.config.ts`
  - Do: Install `@vitest/coverage-v8@^4.1.0`, add coverage provider config to vitest.config.ts (provider: 'v8', reporter: ['text', 'text-summary'], reportsDirectory: './coverage'), add `test:coverage` script to package.json. Run `npx vitest --run --coverage` to measure baseline.
  - Verify: `npx vitest --run --coverage` generates report with per-file percentages, all tests pass
  - Done when: Coverage report prints to console showing line/branch/function percentages per file

- [x] **T02: Resolve CSS and webview-side quick-wins** `est:45m`
  - Why: 8 of the 12 remaining quick-wins are webview-side changes — grouping them avoids context switching between extension and webview code.
  - Files: `src/webview/styles.css`, `src/webview/tool-grouping.ts`, `src/webview/message-handler.ts`, `src/webview/state.ts`, `src/webview/slash-menu.ts`, `src/shared/types.ts`
  - Do: (1) CSS-003: Add `@media (prefers-reduced-motion: reduce)` block disabling all 21 animations. (2) CSS-007: Add `:focus-visible` for `.gsd-slash-item`, `.gsd-stale-echo-bar`, model-picker `[role="option"]`, thinking-picker `[role="option"]`, `.gsd-ui-option-btn`, session-history items. (3) CSS-014: Rename 12 non-prefixed `@keyframes` to `gsd-*`, update all `animation:` references, remove duplicate `@keyframes spin`. (4) SEC-07: Replace `escapeHtmlBasic` in tool-grouping.ts with imported `escapeHtml` from helpers.ts, delete the local function. (5) FT-10: Add `default: console.warn("Unrecognized message type:", (msg as any).type);` to message-handler.ts switch. (6) TEST-06: Add `resetState()` export to state.ts that restores all fields to initial values and resets `entryIdCounter`. (7) FT-26: Differentiate `/gsd export` (milestone report) and `/export` (conversation) descriptions. (8) FT-29: Delete `RpcExportResult` interface from shared/types.ts. PITFALL: CSS-014 partial rename silently breaks animations — grep both `@keyframes` and all `animation:` references after renaming.
  - Verify: `npx vitest --run && npm run build` — all tests pass, build succeeds. Grep checks for each item.
  - Done when: Zero non-prefixed `@keyframes`, zero `escapeHtmlBasic`, zero `RpcExportResult`, `prefers-reduced-motion` present, `resetState` exported, `default:` in message-handler switch

- [ ] **T03: Resolve extension-side quick-wins and update README** `est:30m`
  - Why: Remaining 4 quick-wins are extension-host-side changes plus the README badge update. Grouping avoids interleaving with webview edits.
  - Files: `src/extension/message-dispatch.ts`, `src/extension/health-check.ts`, `src/extension/update-checker.ts`, `src/extension/rpc-client.ts`, `src/extension/auto-progress.ts` → `src/extension/auto-progress-poller.ts`, `src/extension/auto-progress.test.ts` → `src/extension/auto-progress-poller.test.ts`, `src/extension/session-state.ts`, `src/extension/webview-provider.ts`, `README.md`
  - Do: (1) FT-17/FT-22: In the `interrupt`/`cancel_request` case of message-dispatch.ts, after `client.abort()` succeeds (before the catch), clear session timers: `const s = ctx.getSession(sessionId); if (s.promptWatchdog) { clearTimeout(s.promptWatchdog.timer); s.promptWatchdog = null; } if (s.slashWatchdog) { clearTimeout(s.slashWatchdog); s.slashWatchdog = null; } if (s.gsdFallbackTimer) { clearTimeout(s.gsdFallbackTimer); s.gsdFallbackTimer = null; }`. (2) CQ-017: Add `console.warn` logging to the 6 flagged empty catch blocks — health-check.ts lines ~77, ~104; update-checker.ts lines ~77, ~97, ~228, ~267. Keep existing justified catches untouched. Use pattern: `} catch (err) { console.warn("context description:", err); }`. For rpc-client.ts line ~698, this is a `ping()` health check — catch returning false is the correct behavior, just add a one-line comment. (3) CQ-019: Rename `src/extension/auto-progress.ts` → `src/extension/auto-progress-poller.ts` and `src/extension/auto-progress.test.ts` → `src/extension/auto-progress-poller.test.ts`. Update imports in session-state.ts, webview-provider.ts, and auto-progress-poller.test.ts. Run `npm run build` immediately after to catch missed imports. (4) CQ-021: Add `@internal` JSDoc to test-only exports beyond the 2 already tagged (renderer.ts, slash-menu.ts). Scan for exported functions/constants only used in test files. (5) DOC-01: Update README.md badges from `0.2.49` → `0.2.62` and `v2.12--v2.28` → `v2.12--v2.35`.
  - Verify: `npx vitest --run && npm run build` — all tests pass, build succeeds. `test -f src/extension/auto-progress-poller.ts && ! test -f src/extension/auto-progress.ts`. `! grep -q "0.2.49" README.md`.
  - Done when: Abort handler clears all 3 timer types, empty catches have logging/comments, file renamed with all imports updated, README badges current, build and tests green

## Observability / Diagnostics

- **Coverage report output:** `npx vitest --run --coverage` prints per-file line/branch/function percentages to stdout. The `coverage/` directory stores detailed reports locally.
- **Build diagnostics:** `npm run build` emits esbuild metafiles at `dist/meta-extension.json` and `dist/meta-webview.json` for bundle analysis. Non-zero exit code indicates build failure.
- **Test failure visibility:** Vitest prints failing test names, assertion diffs, and stack traces to stderr. Exit code 1 on any failure.
- **Grep verification:** Each quick-win resolution is verifiable via grep commands in the Verification section — absence of removed patterns and presence of added patterns are the primary signals.
- **Failure path check:** `npx vitest --run --coverage 2>&1 | grep -E "FAIL|Error"` surfaces any test failures or coverage errors in a single pass.

## Files Likely Touched

- `vitest.config.ts`
- `package.json`
- `src/webview/styles.css`
- `src/webview/tool-grouping.ts`
- `src/webview/message-handler.ts`
- `src/webview/state.ts`
- `src/webview/slash-menu.ts`
- `src/shared/types.ts`
- `src/extension/message-dispatch.ts`
- `src/extension/health-check.ts`
- `src/extension/update-checker.ts`
- `src/extension/rpc-client.ts`
- `src/extension/auto-progress.ts` → `src/extension/auto-progress-poller.ts`
- `src/extension/auto-progress.test.ts` → `src/extension/auto-progress-poller.test.ts`
- `src/extension/session-state.ts`
- `src/extension/webview-provider.ts`
- `README.md`
