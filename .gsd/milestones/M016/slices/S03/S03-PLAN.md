# S03: Bundle Optimization & Async I/O

**Goal:** Extension bundle ≤100KB, webview bundle ≤220KB. Zero `readFileSync` calls on polling paths. All cold-path sync reads converted for consistency.
**Demo:** `npm run build` produces minified bundles under size targets. `rg "readFileSync" src/extension/ --type ts | grep -v test` returns zero results.

## Must-Haves

- `--minify` and `--tree-shaking=true` on both `build:extension` and `build:webview` esbuild commands
- `--metafile` diagnostic output for both builds, excluded from VSIX by `.vscodeignore`
- Watch scripts (`watch:extension`, `watch:webview`) NOT minified — preserves fast iteration
- Extension bundle ≤100KB, webview bundle ≤220KB after minification
- Zero `readFileSync` / `readdirSync` in hot-path files: `dashboard-parser.ts`, `captures-parser.ts`, `parallel-status.ts`
- Zero `readFileSync` in cold-path files: `command-fallback.ts`, `file-ops.ts`, `health-check.ts`, `metrics-parser.ts`, `rpc-client.ts`, `webview-provider.ts`
- All call sites updated (`auto-progress.ts` adds `await`; internal helpers made async)
- All 618+ tests pass after changes
- Build succeeds with no errors

## Verification

- `npm run build && node -e "const fs=require('fs'); const e=fs.statSync('dist/extension.js').size; const w=fs.statSync('dist/webview/index.js').size; console.log('ext:',e,'web:',w); if(e>102400||w>225280) process.exit(1)"` — both bundles under size targets
- `npx rg "readFileSync|readdirSync" src/extension/ --type ts | grep -v test | wc -l` returns 0 (or manual `rg` grep returns no results)
- `npm test` — all 618+ tests pass
- `npm run build` — build succeeds cleanly

## Tasks

- [x] **T01: Add minification and tree-shaking flags to esbuild build scripts** `est:20m`
  - Why: R005 — extension ships at 159KB and webview at 345KB unminified. Adding esbuild flags drops both under targets with zero code changes.
  - Files: `package.json`, `.vscodeignore`
  - Do: Add `--minify --tree-shaking=true` to `build:extension` and `build:webview` scripts. Add `--metafile=dist/meta-extension.json` and `--metafile=dist/meta-webview.json` respectively. Do NOT modify watch scripts. Add `dist/meta-*.json` to `.vscodeignore`. Run build, verify sizes. Run full test suite.
  - Verify: `npm run build && node -e "const fs=require('fs'); const e=fs.statSync('dist/extension.js').size; const w=fs.statSync('dist/webview/index.js').size; console.log('ext:',e,'web:',w); if(e>102400||w>225280) process.exit(1)"` exits 0
  - Done when: Extension bundle ≤100KB, webview bundle ≤220KB, metafiles generated, watch scripts unchanged, all tests pass

- [x] **T02: Convert all readFileSync/readdirSync to async across extension source** `est:45m`
  - Why: R006 — synchronous file reads on the 3-second auto-progress poller block the extension host event loop. Converting all sync reads (hot + cold paths) eliminates blocking I/O entirely.
  - Files: `src/extension/captures-parser.ts`, `src/extension/parallel-status.ts`, `src/extension/dashboard-parser.ts`, `src/extension/auto-progress.ts`, `src/extension/command-fallback.ts`, `src/extension/file-ops.ts`, `src/extension/health-check.ts`, `src/extension/metrics-parser.ts`, `src/extension/rpc-client.ts`, `src/extension/webview-provider.ts`, `src/extension/message-dispatch.ts`
  - Do: (1) Hot paths: make `countPendingCaptures` async, make `readParallelWorkers` async, make `readBudgetCeiling` async, make `findFile` helper in dashboard-parser async, convert remaining `readFileSync` in `buildDashboardData` to `await fs.promises.readFile`. Update `auto-progress.ts` call sites to `await`. (2) Cold paths: convert `readFileSync` in command-fallback, file-ops, health-check, metrics-parser, rpc-client, webview-provider to `fs.promises.readFile`. Make their containing functions async where needed and update callers (including `message-dispatch.ts` for `loadMetricsLedger`). (3) Convert `readdirSync` in dashboard-parser `findFile` and parallel-status to `fs.promises.readdir`. (4) Convert `existsSync` guard in captures-parser to try/catch on the read (no `fs.promises.exists`). (5) Update test mocks: `auto-progress.test.ts` mock for `countPendingCaptures` returns Promise; `file-ops.test.ts` awaits async `cleanStaleCrashLock`. (6) Run full test suite.
  - Verify: `rg "readFileSync|readdirSync" src/extension/ --type ts | grep -v test` returns zero results AND `npm test` passes all 618+ tests
  - Done when: Zero sync file reads in non-test extension source. All tests pass. Build succeeds.

## Observability / Diagnostics

- **Bundle size inspection:** After `npm run build`, run `node -e "const fs=require('fs'); console.log('ext:', fs.statSync('dist/extension.js').size, 'web:', fs.statSync('dist/webview/index.js').size)"` to see current sizes. The `dist/meta-extension.json` and `dist/meta-webview.json` metafiles provide per-module size breakdowns for identifying bloat sources.
- **Sync I/O detection:** `rg "readFileSync|readdirSync" src/extension/ --type ts | grep -v test` should return zero results after T02 completes. Any matches indicate remaining blocking I/O.
- **Build failure visibility:** `npm run build` will surface esbuild errors to stderr. Metafile generation failures will also appear here.
- **Test regression detection:** `npm test` with vitest outputs pass/fail counts and specific failure details. Any sync-to-async conversion regressions will show as test failures with clear stack traces.
- **Redaction:** No secrets or user data in build artifacts or metafiles — they contain only module paths and byte sizes.

## Files Likely Touched

- `package.json`
- `.vscodeignore`
- `src/extension/captures-parser.ts`
- `src/extension/parallel-status.ts`
- `src/extension/dashboard-parser.ts`
- `src/extension/auto-progress.ts`
- `src/extension/auto-progress.test.ts`
- `src/extension/command-fallback.ts`
- `src/extension/file-ops.ts`
- `src/extension/file-ops.test.ts`
- `src/extension/health-check.ts`
- `src/extension/metrics-parser.ts`
- `src/extension/rpc-client.ts`
- `src/extension/webview-provider.ts`
- `src/extension/message-dispatch.ts`
