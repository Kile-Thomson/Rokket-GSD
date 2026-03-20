---
estimated_steps: 5
estimated_files: 3
---

# T03: Extract polling.ts and html-generator.ts, verify ≤500 LOC target

**Slice:** S01 — God-file Decomposition
**Milestone:** M016

## Description

Two small self-contained concerns remain in the provider after T01 (module wiring) and T02 (message dispatch extraction): polling orchestration (~90 lines) and HTML generation (~39 lines). Extracting these brings the provider under the ≤500 LOC target (R001). This task also performs the final integration verification: VSIX packaging and dead-code grep.

## Steps

1. **Create `src/extension/polling.ts`:**
   - Define a `PollingContext` interface with: `getSession(sessionId: string): SessionState`, `postToWebview(wv: Webview, msg: ...): void`, `output: OutputChannel`, `emitStatus(update: Partial<StatusBarUpdate>): void`, `applySessionCostFloor(sessionId: string, stats: ...): void`
   - Extract these four methods from the provider:
     - `startStatsPolling(webview, sessionId)` — 5s interval stats poller
     - `startHealthMonitoring(webview, sessionId)` — periodic health check
     - `refreshWorkflowState(webview, sessionId)` — reads STATE.md and sends workflow state
     - `startWorkflowPolling(webview, sessionId)` — 30s interval workflow poller
   - Move necessary imports: `parseGsdWorkflowState` from `state-parser`, `buildDashboardData` from `dashboard-parser`, `loadMetricsLedger`/`buildMetricsData` from `metrics-parser`
   - Replace `this.x` with `ctx.x` in all four functions
   - Export all four functions plus the `PollingContext` interface

2. **Create `src/extension/html-generator.ts`:**
   - Extract the `getWebviewHtml(webview, sessionId)` method and the standalone `getNonce()` function
   - `getWebviewHtml` needs: `extensionUri: Uri` and `sessionId: string`. Define a minimal context or pass these as direct arguments.
   - `getNonce` is a pure utility (no dependencies) — export it standalone
   - Move the relevant imports (vscode Uri utilities)

3. **Update the provider to import and delegate:**
   - Import `startStatsPolling`, `startHealthMonitoring`, `refreshWorkflowState`, `startWorkflowPolling`, `PollingContext` from `./polling`
   - Import `getWebviewHtml`, `getNonce` from `./html-generator`
   - Create a `pollingCtx` getter (same pattern as T01's context adapters)
   - In `_doLaunchGsd`: replace `this.startStatsPolling(...)` → `startStatsPolling(this.pollingCtx, ...)`; same for health/workflow polling
   - In `resolveWebviewView` and `openInTab`: replace `this.getWebviewHtml(...)` → `getWebviewHtml(this.extensionUri, ...)` (or whatever signature is used)
   - `RpcEventContext` has a `refreshWorkflowState` method — update it to delegate to the imported function
   - Delete the inline method bodies from the provider

4. **Verify the LOC target:**
   - `wc -l src/extension/webview-provider.ts` must show ≤500
   - If slightly over (501-510), look for blank lines, long comment blocks, or import consolidation opportunities to trim — but do NOT remove meaningful code or refactor logic to hit the target

5. **Final integration checks:**
   - `npx vitest --run` — all 607+ tests pass
   - `npm run build` — esbuild succeeds
   - `npx vsce package --no-dependencies` — VSIX packages cleanly
   - Dead code grep: `rg "private startStatsPolling|private startHealthMonitoring|private refreshWorkflowState|private startWorkflowPolling|private getWebviewHtml" src/extension/webview-provider.ts` — zero matches
   - All new modules exist: `test -f src/extension/message-dispatch.ts && test -f src/extension/polling.ts && test -f src/extension/html-generator.ts`

## Must-Haves

- [ ] `polling.ts` exists with 4 exported polling functions and `PollingContext` interface
- [ ] `html-generator.ts` exists with exported `getWebviewHtml` and `getNonce`
- [ ] Provider ≤500 LOC (`wc -l`)
- [ ] All 607+ tests pass
- [ ] esbuild compiles without errors
- [ ] VSIX packages cleanly

## Verification

- `npx vitest --run` — all 607+ tests pass
- `npm run build` — esbuild succeeds
- `wc -l src/extension/webview-provider.ts | awk '{exit !($1 <= 500)}'` — exits 0 (≤500 LOC)
- `npx vsce package --no-dependencies 2>&1 | grep -q "VSIX"` — VSIX created
- `test -f src/extension/polling.ts && test -f src/extension/html-generator.ts` — new modules exist
- `rg "private startStatsPolling|private startHealthMonitoring|private refreshWorkflowState|private startWorkflowPolling|private getWebviewHtml" src/extension/webview-provider.ts` — zero matches

## Inputs

- `src/extension/webview-provider.ts` — after T02, ~650 LOC with polling and HTML still inline
- `src/extension/state-parser.ts` — `parseGsdWorkflowState` used by `refreshWorkflowState`
- `src/extension/dashboard-parser.ts` — `buildDashboardData` used by `startStatsPolling`
- `src/extension/metrics-parser.ts` — `loadMetricsLedger`, `buildMetricsData` used by polling
- `src/extension/rpc-events.ts` — `RpcEventContext` references `refreshWorkflowState` — must still work after extraction

## Expected Output

- `src/extension/polling.ts` — new module (~100 lines) with polling orchestration
- `src/extension/html-generator.ts` — new module (~45 lines) with HTML template and nonce generation
- `src/extension/webview-provider.ts` — ≤500 LOC, all concerns extracted, only class scaffolding, lifecycle methods, `launchGsd` orchestration, and context adapter wiring remain
