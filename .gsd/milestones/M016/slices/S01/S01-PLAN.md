# S01: God-file Decomposition

**Goal:** Decompose `webview-provider.ts` from 2,239 LOC to ≤500 LOC by wiring four existing extracted modules and extracting the message dispatch, polling, and HTML generation into focused modules.
**Demo:** `wc -l src/extension/webview-provider.ts` shows ≤500, all 607+ tests pass, `npm run build` succeeds, VSIX packages cleanly.

## Must-Haves

- webview-provider.ts is ≤500 LOC
- `rpc-events.ts`, `command-fallback.ts`, `watchdogs.ts`, `file-ops.ts` are wired as primary code paths — zero duplicate inline implementations remain in the provider
- New `message-dispatch.ts` module handles the entire webview message switch statement
- New `polling.ts` module owns stats/health/workflow polling orchestration
- New `html-generator.ts` module owns `getWebviewHtml()` and `getNonce()`
- All 607+ existing tests pass after every extraction step
- esbuild compiles without errors
- VSIX packages cleanly via `npx vsce package`

## Proof Level

- This slice proves: integration (modules wired into real extension lifecycle)
- Real runtime required: yes (VSIX install test)
- Human/UAT required: yes (manual feature walkthrough after VSIX install)

## Verification

- `npx vitest --run` — all 607+ tests pass
- `npm run build` — esbuild succeeds with no errors
- `wc -l src/extension/webview-provider.ts` — output ≤500
- `rg "private startPromptWatchdog|private clearPromptWatchdog|private startSlashCommandWatchdog|private startActivityMonitor|private stopActivityMonitor|private abortAndPrompt|private handleRpcEvent|private handleExtensionUiRequest|private armGsdFallbackProbe|private startGsdFallbackTimer|private handleGsdAutoFallback" src/extension/webview-provider.ts` — zero matches (no inline duplicate implementations)
- `npx vsce package --no-dependencies 2>&1 | grep -q "VSIX"` — VSIX packages successfully
- `test -f src/extension/message-dispatch.ts && test -f src/extension/polling.ts && test -f src/extension/html-generator.ts` — all new modules exist

## Observability / Diagnostics

- Runtime signals: Extension output channel `Rokket GSD` logs all message dispatch and RPC events with `[sessionId]` prefix — no change to log format, just where the log calls originate
- Inspection surfaces: `Output > Rokket GSD` panel in VS Code shows message flow; test suite validates module contracts
- Failure visibility: If wiring breaks event ordering, tests catch it (86 module-level tests for the four extracted modules); runtime errors surface as `[ERR-xxx]` in the output channel
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `session-state.ts` (`SessionState` interface, `createSessionState()`), `rpc-client.ts` (`GsdRpcClient`), `shared/types.ts` (message types)
- New wiring introduced in this slice: Context adapter objects in `webview-provider.ts` that satisfy `WatchdogContext`, `CommandFallbackContext`, `RpcEventContext`, `FileOpsContext`, and the new `MessageDispatchContext` — these bridge the provider's `this` state to the extracted module interfaces
- What remains before the milestone is truly usable end-to-end: S02 (CSP/inline-style removal), S03 (bundle optimization), S04 (quick-wins/coverage)

## Tasks

- [x] **T01: Wire watchdogs, command-fallback, rpc-events, and file-ops into webview-provider** `est:1h`
  - Why: Four modules with 86 tests are completely extracted but zero-imported — provider has ~667 lines of inline duplicates. Wiring them is the single largest LOC reduction and the safest extraction since every module already has a `Context` interface and full test coverage.
  - Files: `src/extension/webview-provider.ts`, `src/extension/watchdogs.ts`, `src/extension/command-fallback.ts`, `src/extension/rpc-events.ts`, `src/extension/file-ops.ts`
  - Do: (1) Add imports for all four modules. (2) Create context adapter objects using arrow functions to preserve `this` binding — `WatchdogContext`, `CommandFallbackContext`, `RpcEventContext`, `FileOpsContext`. (3) Replace inline method calls with calls to imported functions, passing the context adapter. Wire in dependency order: watchdogs first (leaf), command-fallback (leaf), rpc-events (depends on watchdogCtx), file-ops (standalone). (4) Delete all inline duplicate method bodies (~667 lines). Remove the provider's `GSD_COMMAND_RE` and `GSD_NATIVE_SUBCOMMANDS` statics (use command-fallback's exports). (5) Compare each inline method signature against the extracted module's version before replacing — the research warns about parameter drift. (6) Ensure `_doLaunchGsd` event handlers delegate to imported `handleRpcEvent` with the context adapter, and cleanup handlers call imported `clearPromptWatchdog`/`stopActivityMonitor`. (7) Run `npx vitest --run` and `npm run build` after wiring.
  - Verify: `npx vitest --run` (607+ pass) && `npm run build` (success) && `rg "private startPromptWatchdog|private clearPromptWatchdog|private startSlashCommandWatchdog|private startActivityMonitor|private stopActivityMonitor|private abortAndPrompt|private handleRpcEvent|private handleExtensionUiRequest|private armGsdFallbackProbe|private startGsdFallbackTimer|private handleGsdAutoFallback" src/extension/webview-provider.ts` (zero matches)
  - Done when: All four modules are imported and called as primary code paths, all inline duplicates deleted, 607+ tests pass, build succeeds

- [x] **T02: Extract the 912-line message dispatch switch into message-dispatch.ts** `est:1h`
  - Why: The `setupWebviewMessageHandling` method is a 912-line switch statement deeply coupled to `this` — it's the largest single block in the provider and the zero-coverage zone. Extracting it into a dedicated module makes it independently testable and drops the provider by ~900 lines.
  - Files: `src/extension/webview-provider.ts`, `src/extension/message-dispatch.ts` (new)
  - Do: (1) Create `src/extension/message-dispatch.ts` with a `MessageDispatchContext` interface that exposes every `this.x` reference used in the switch: `getSession`, `postToWebview`, `output`, `emitStatus`, `launchGsd`, `applySessionCostFloor`, `context` (ExtensionContext), `gsdVersion`, `getUseCtrlEnter`, `getTheme`, `checkWhatsNew`, `ensureTempDir`, `cleanupTempFiles`, `cleanupSession`, plus references to the four wired module contexts (watchdogCtx, commandFallbackCtx, rpcEventCtx, fileOpsCtx). (2) Export a single `handleWebviewMessage(ctx: MessageDispatchContext, webview: Webview, sessionId: string, msg: WebviewToExtensionMessage): Promise<void>` function containing the entire switch body. (3) Move all case statements verbatim — do NOT refactor individual cases. Replace `this.x` with `ctx.x` throughout. For watchdog/command-fallback/rpc-events/file-ops calls, use the nested context references (e.g. `startPromptWatchdog(ctx.watchdogCtx, ...)`). (4) Reduce the provider's `setupWebviewMessageHandling` to ~15 lines: create `MessageDispatchContext`, subscribe `onDidReceiveMessage`, delegate to `handleWebviewMessage`. (5) Run `npx vitest --run` and `npm run build`.
  - Verify: `npx vitest --run` (607+ pass) && `npm run build` (success) && `test -f src/extension/message-dispatch.ts` && `wc -l src/extension/webview-provider.ts | awk '{print ($1 <= 650)}'` outputs 1
  - Done when: `message-dispatch.ts` exists with exported `handleWebviewMessage`, provider's `setupWebviewMessageHandling` is ≤20 lines, all tests pass, build succeeds

- [x] **T03: Extract polling.ts and html-generator.ts, verify ≤500 LOC target** `est:45m`
  - Why: Two small extractions (~90 + ~39 lines) bring the provider under the ≤500 LOC target. Polling orchestration and HTML generation are self-contained concerns with clear boundaries. This task also runs the final VSIX package check.
  - Files: `src/extension/webview-provider.ts`, `src/extension/polling.ts` (new), `src/extension/html-generator.ts` (new)
  - Do: (1) Create `src/extension/polling.ts` — extract `startStatsPolling`, `startHealthMonitoring`, `refreshWorkflowState`, `startWorkflowPolling` (~90 lines). Define a `PollingContext` interface with: `getSession`, `postToWebview`, `output`, `emitStatus`, `applySessionCostFloor`. Import dependencies: `state-parser`, `dashboard-parser`, `metrics-parser`, `session-state`. (2) Create `src/extension/html-generator.ts` — extract `getWebviewHtml` and the standalone `getNonce` function (~39 lines). Export both. (3) Replace provider's inline methods with imports. The provider's `_doLaunchGsd` should call imported polling functions. `resolveWebviewView` and `openInTab` should call imported `getWebviewHtml`. (4) Run `npx vitest --run` and `npm run build`. (5) Verify `wc -l src/extension/webview-provider.ts` shows ≤500. (6) Run `npx vsce package --no-dependencies` to confirm VSIX packages cleanly.
  - Verify: `npx vitest --run` (607+ pass) && `npm run build` (success) && `wc -l src/extension/webview-provider.ts | awk '{exit !($1 <= 500)}'` && `npx vsce package --no-dependencies 2>&1 | grep -q "VSIX"`
  - Done when: Provider is ≤500 LOC, `polling.ts` and `html-generator.ts` exist, all tests pass, VSIX packages successfully

## Files Likely Touched

- `src/extension/webview-provider.ts` — god-file being decomposed (all 3 tasks)
- `src/extension/watchdogs.ts` — imported, not modified (T01)
- `src/extension/command-fallback.ts` — imported, not modified (T01)
- `src/extension/rpc-events.ts` — imported, not modified (T01)
- `src/extension/file-ops.ts` — imported, not modified (T01)
- `src/extension/message-dispatch.ts` — new module (T02)
- `src/extension/polling.ts` — new module (T03)
- `src/extension/html-generator.ts` — new module (T03)
