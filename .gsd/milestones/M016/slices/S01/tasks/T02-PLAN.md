---
estimated_steps: 4
estimated_files: 2
---

# T02: Extract the 912-line message dispatch switch into message-dispatch.ts

**Slice:** S01 — God-file Decomposition
**Milestone:** M016

## Description

The `setupWebviewMessageHandling` method in `webview-provider.ts` contains a massive switch statement (~912 lines) that handles every webview→extension message type. After T01 wired the four extracted modules, this switch still references them via `this.watchdogCtx`, `this.rpcEventCtx`, etc., plus many other `this.x` calls. This task extracts the entire switch body into a new `message-dispatch.ts` module with a `MessageDispatchContext` interface.

The extraction is mechanical: define the context interface covering every `this.x` reference in the switch, export a `handleWebviewMessage()` function containing the switch, and replace `this.x` with `ctx.x` throughout. Do NOT refactor individual case handlers — just lift them verbatim. The provider's `setupWebviewMessageHandling` becomes ~15 lines: create context, subscribe, delegate.

This is the riskiest extraction because the switch has zero direct test coverage — only the VSIX integration test and existing module tests validate it indirectly.

## Steps

1. **Audit all `this.x` references in the switch statement** (lines ~668-1578 after T01's edits). Build the complete list of provider properties/methods referenced. After T01, the switch should reference:
   - Direct: `this.getSession`, `this.postToWebview`, `this.output`, `this.emitStatus`, `this.launchGsd`, `this.applySessionCostFloor`, `this.context` (ExtensionContext), `this.gsdVersion`, `this.getUseCtrlEnter`, `this.getTheme`, `this.checkWhatsNew`, `this.ensureTempDir`, `this.cleanupTempFiles`, `this.cleanupSession`, `this._doLaunchGsd`
   - Module contexts: `this.watchdogCtx`, `this.commandFallbackCtx`, `this.fileOpsCtx`
   - The switch also imports and calls functions from `session-list-service`, `update-checker`, `auto-progress`, etc. — these are module-level imports that stay as imports in the new file.

2. **Create `src/extension/message-dispatch.ts`:**
   - Define `MessageDispatchContext` interface with every `this.x` property and method used in the switch. Use the exact same type signatures. For complex types, import them from their source modules.
   - Export `async function handleWebviewMessage(ctx: MessageDispatchContext, webview: vscode.Webview, sessionId: string, msg: WebviewToExtensionMessage): Promise<void>` containing the entire switch body.
   - Move the necessary imports (`listSessions`, `deleteSession`, `downloadAndInstallUpdate`, `dismissUpdateVersion`, `fetchReleaseNotes`, `fetchRecentReleases`, `AutoProgressPoller`, etc.) to this new file.
   - Replace every `this.x(...)` call with `ctx.x(...)`.
   - Replace watchdog/command-fallback/file-ops calls: if the switch calls `startPromptWatchdog(this.watchdogCtx, ...)`, change to `startPromptWatchdog(ctx.watchdogCtx, ...)`. Import the module functions at the top of message-dispatch.ts.
   - Keep the error handling wrapper (the try/catch with `ERR-xxx` error ID) inside `handleWebviewMessage`.

3. **Reduce the provider's `setupWebviewMessageHandling`** to ~15 lines:
   ```typescript
   private setupWebviewMessageHandling(webview: vscode.Webview, sessionId: string): void {
     this.getSession(sessionId).webview = webview;
     const prevDisposable = this.getSession(sessionId).messageHandlerDisposable;
     if (prevDisposable) prevDisposable.dispose();

     const ctx: MessageDispatchContext = {
       getSession: (id) => this.getSession(id),
       postToWebview: (wv, msg) => this.postToWebview(wv, msg),
       output: this.output,
       emitStatus: (u) => this.emitStatus(u),
       launchGsd: (wv, sid, cwd) => this.launchGsd(wv, sid, cwd),
       // ... all other properties
     };

     const disposable = webview.onDidReceiveMessage(async (msg) => {
       await handleWebviewMessage(ctx, webview, sessionId, msg);
     });
     this.getSession(sessionId).messageHandlerDisposable = disposable;
   }
   ```
   Remove imports that are no longer needed in the provider (moved to message-dispatch.ts).

4. **Run tests and build:**
   - `npx vitest --run` — all 607+ tests must pass
   - `npm run build` — esbuild must succeed
   - Verify the provider's line count is significantly reduced: `wc -l src/extension/webview-provider.ts` should be ≤650

## Must-Haves

- [ ] `message-dispatch.ts` exists with exported `handleWebviewMessage` function
- [ ] `MessageDispatchContext` interface covers all `this.x` references from the switch
- [ ] All switch cases moved verbatim — no refactoring of individual handlers
- [ ] Provider's `setupWebviewMessageHandling` is ≤20 lines (context creation + delegation)
- [ ] Error handling wrapper (try/catch with ERR-xxx) preserved in the extracted function
- [ ] All 607+ tests pass
- [ ] esbuild compiles without errors

## Verification

- `npx vitest --run` — all 607+ tests pass
- `npm run build` — esbuild succeeds
- `test -f src/extension/message-dispatch.ts` — new module exists
- `wc -l src/extension/webview-provider.ts` — ≤650 lines (≤500 after T03's final extractions)
- `rg "export async function handleWebviewMessage" src/extension/message-dispatch.ts` — exported function exists

## Inputs

- `src/extension/webview-provider.ts` — after T01, ~1,572 LOC with four modules wired but switch still inline
- `src/extension/watchdogs.ts`, `src/extension/command-fallback.ts`, `src/extension/rpc-events.ts`, `src/extension/file-ops.ts` — T01 wired these; message-dispatch.ts will import their functions directly
- `src/shared/types.ts` — `WebviewToExtensionMessage` and other message types needed by the switch

## Expected Output

- `src/extension/message-dispatch.ts` — new module (~920 lines) with `MessageDispatchContext` interface and `handleWebviewMessage()` function
- `src/extension/webview-provider.ts` — reduced from ~1,572 to ~650 LOC, with `setupWebviewMessageHandling` as a thin delegation layer

## Observability Impact

- **Signals changed:** Log messages from the switch statement (`[sessionId] Webview -> Extension: ...`, `[sessionId] Sending prompt to RPC: ...`, all `[ERR-xxx]` error IDs) now originate from `message-dispatch.ts` instead of `webview-provider.ts` — the format and content are identical, only the source file changes.
- **Inspection:** `Output > Rokket GSD` panel still shows the full message dispatch flow with `[sessionId]` prefix. The `MessageDispatchContext` interface is the contract boundary — if wiring breaks, the TypeScript compiler catches missing or mistyped context properties at build time.
- **Failure visibility:** The try/catch with `[ERR-xxx]` error IDs is preserved verbatim inside `handleWebviewMessage`. Runtime errors surface identically in the output channel. If the context adapter misses a property, esbuild fails at compile time.
