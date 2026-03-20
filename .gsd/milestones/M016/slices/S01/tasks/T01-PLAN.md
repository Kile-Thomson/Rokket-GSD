---
estimated_steps: 5
estimated_files: 5
---

# T01: Wire watchdogs, command-fallback, rpc-events, and file-ops into webview-provider

**Slice:** S01 — God-file Decomposition
**Milestone:** M016

## Description

Four modules have been fully extracted from `webview-provider.ts` with complete test suites (86 tests total) but are never imported — the provider still has ~667 lines of inline duplicate implementations. This task wires them as the primary code paths by creating context adapter objects, replacing inline method calls with imported function calls, and deleting all inline duplicates.

The modules have established `Context` interfaces for dependency injection. The provider must satisfy these interfaces using arrow functions to preserve `this` binding. Wire in dependency order: watchdogs (leaf) → command-fallback (leaf) → rpc-events (depends on watchdogCtx) → file-ops (standalone).

**Relevant skills:** The `review` skill can be used to verify the final diff if needed, but this is primarily mechanical replacement work.

## Steps

1. **Add imports for all four modules** at the top of `webview-provider.ts`:
   - From `./watchdogs`: `startPromptWatchdog`, `clearPromptWatchdog`, `startSlashCommandWatchdog`, `startActivityMonitor`, `stopActivityMonitor`, `abortAndPrompt`, `WatchdogContext`
   - From `./command-fallback`: `armGsdFallbackProbe`, `startGsdFallbackTimer`, `handleGsdAutoFallback`, `GSD_COMMAND_RE`, `GSD_NATIVE_SUBCOMMANDS`, `CommandFallbackContext`
   - From `./rpc-events`: `handleRpcEvent`, `handleExtensionUiRequest`, `RpcEventContext`
   - From `./file-ops`: `handleOpenFile`, `handleOpenDiff`, `handleOpenUrl`, `handleExportHtml`, `handleSaveTempFile`, `handleCheckFileAccess`, `handleAttachFiles`, `handleCopyText`, `handleSetTheme`, `cleanStaleCrashLock`, `FileOpsContext`

2. **Create context adapter objects** as private methods or lazy-initialized properties on the class. Critical: use arrow functions for all method references to preserve `this` binding. Example pattern:
   ```typescript
   private get watchdogCtx(): WatchdogContext {
     return {
       getSession: (id) => this.getSession(id),
       postToWebview: (wv, msg) => this.postToWebview(wv, msg),
       output: this.output,
       emitStatus: (update) => this.emitStatus(update),
       nextPromptWatchdogNonce: () => ++this.promptWatchdogNonce,
     };
   }
   ```
   Create adapters for: `WatchdogContext`, `CommandFallbackContext`, `RpcEventContext`, `FileOpsContext`.

   **Before creating each adapter**, read the Context interface definition in the extracted module and compare every property against the inline method's actual signature in the provider. The research warns about parameter drift between inline and extracted versions. If signatures differ, the extracted module's interface is the source of truth.

   Key details for each context:
   - `WatchdogContext`: needs `getSession`, `postToWebview`, `output`, `emitStatus`, `nextPromptWatchdogNonce` (returns `++this.promptWatchdogNonce`)
   - `CommandFallbackContext`: needs `getSession`, `postToWebview`, `output`
   - `RpcEventContext`: needs `getSession`, `postToWebview`, `emitStatus`, `lastStatus` (readonly), `output` (readonly), `watchdogCtx` (the WatchdogContext adapter), `refreshWorkflowState`, `isWebviewVisible`, `webviewView` (optional)
   - `FileOpsContext`: needs `postToWebview`, `output`, `ensureTempDir`

3. **Replace all inline method calls with imported function calls** throughout the provider:
   - In `setupWebviewMessageHandling` switch cases: replace `this.startPromptWatchdog(...)` with `startPromptWatchdog(this.watchdogCtx, ...)`, etc.
   - In `_doLaunchGsd`: replace `this.handleRpcEvent(webview, sessionId, event, client)` with `handleRpcEvent(this.rpcEventCtx, webview, sessionId, event, client)`, replace `this.stopActivityMonitor(sessionId)` with `stopActivityMonitor(this.watchdogCtx, sessionId)`, replace `this.clearPromptWatchdog(sessionId)` with `clearPromptWatchdog(this.watchdogCtx, sessionId)`
   - In `resolveWebviewView`: if there's a re-bind of `handleRpcEvent`, update it to use the imported version with context
   - Replace `GsdWebviewProvider.GSD_COMMAND_RE` references with imported `GSD_COMMAND_RE`
   - Replace `GsdWebviewProvider.GSD_NATIVE_SUBCOMMANDS` with imported `GSD_NATIVE_SUBCOMMANDS`
   - For file-ops handlers in the switch: replace inline `case "open_file"` bodies with calls to `handleOpenFile(this.fileOpsCtx, ...)`, etc.

4. **Delete all inline duplicate method bodies** (~667 lines):
   - Delete: `private startPromptWatchdog` (lines ~258-318)
   - Delete: `private clearPromptWatchdog` (lines ~319-331)
   - Delete: `private startSlashCommandWatchdog` (lines ~332-400)
   - Delete: `private startActivityMonitor` (lines ~401-476)
   - Delete: `private stopActivityMonitor` (lines ~477-488)
   - Delete: `private async abortAndPrompt` (lines ~489-523)
   - Delete: `private handleRpcEvent` (lines ~1750-1835)
   - Delete: `private armGsdFallbackProbe` (lines ~1836-1852)
   - Delete: `private static GSD_NATIVE_SUBCOMMANDS` (line ~1853)
   - Delete: `private startGsdFallbackTimer` (lines ~1855-1873)
   - Delete: `private async handleGsdAutoFallback` (lines ~1874-2011)
   - Delete: `private async handleExtensionUiRequest` (lines ~2012-2150)
   - Delete: `private static readonly GSD_COMMAND_RE` (line ~43)

5. **Run tests and build:**
   - `npx vitest --run` — all 607+ tests must pass
   - `npm run build` — esbuild must succeed
   - Verify no inline duplicates remain: `rg "private startPromptWatchdog|private clearPromptWatchdog|private startSlashCommandWatchdog|private startActivityMonitor|private stopActivityMonitor|private abortAndPrompt|private handleRpcEvent|private handleExtensionUiRequest|private armGsdFallbackProbe|private startGsdFallbackTimer|private handleGsdAutoFallback" src/extension/webview-provider.ts` should return zero matches

## Must-Haves

- [ ] All four modules imported and used as primary code paths
- [ ] Context adapters use arrow functions for `this` binding (not bare method references)
- [ ] `promptWatchdogNonce` state managed via `nextPromptWatchdogNonce()` callback in WatchdogContext
- [ ] Provider's static `GSD_COMMAND_RE` and `GSD_NATIVE_SUBCOMMANDS` removed — uses command-fallback's exports
- [ ] All 607+ tests pass
- [ ] esbuild compiles without errors
- [ ] Zero inline duplicate method implementations remain

## Verification

- `npx vitest --run` — all 607+ tests pass (the extracted modules' 86 tests validate the wiring contracts)
- `npm run build` — esbuild succeeds
- `rg "private startPromptWatchdog|private clearPromptWatchdog|private startSlashCommandWatchdog|private startActivityMonitor|private stopActivityMonitor|private abortAndPrompt|private handleRpcEvent|private handleExtensionUiRequest|private armGsdFallbackProbe|private startGsdFallbackTimer|private handleGsdAutoFallback" src/extension/webview-provider.ts` — zero matches

## Inputs

- `src/extension/webview-provider.ts` — the 2,239-LOC god-file with inline duplicates
- `src/extension/watchdogs.ts` — extracted module with `WatchdogContext` interface and 6 exported functions (22 tests)
- `src/extension/command-fallback.ts` — extracted module with `CommandFallbackContext` interface and 3 exported functions + 2 regexes (20 tests)
- `src/extension/rpc-events.ts` — extracted module with `RpcEventContext` interface and 2 exported functions (20 tests). **Note**: `RpcEventContext` includes a `watchdogCtx: WatchdogContext` property — it calls watchdog functions internally
- `src/extension/file-ops.ts` — extracted module with `FileOpsContext` interface and 10 exported functions (24 tests)
- `src/extension/session-state.ts` — `SessionState` interface (do not modify)

## Expected Output

- `src/extension/webview-provider.ts` — reduced by ~667 lines (from ~2,239 to ~1,572), with four modules imported and wired via context adapters, all inline duplicate method bodies deleted
