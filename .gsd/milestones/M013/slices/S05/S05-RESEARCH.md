# S05: Decompose webview-provider.ts (remediation) — Research

**Date:** 2026-03-18

## Summary

S01 successfully decomposed webview-provider.ts from 2196 to 471 lines across 8 modules, but the code changes were never committed to the worktree branch — only the summaries survived. The current state has the original 2196-line monolith intact. S04's CSS split (12 partials, barrel index.css, deleted monolith) is staged in git but also uncommitted.

S05 is a mechanical re-execution of S01's proven extraction plan using the detailed task summaries as a blueprint. The S01 summaries document every function extracted, every context interface shape, every call-site update, and even the getter property pattern used. No design decisions remain — this is pure implementation from a known-good spec.

The slice also commits S04's staged CSS changes to avoid losing that completed work.

## Recommendation

Follow the S01 task summaries as a literal recipe. Extract in the same order (watchdogs → rpc-events → command-fallback → file-ops → message-router + session-polling + process-launcher) with the same context interface DI pattern. Build and test after each extraction to catch regressions early. Commit S04 CSS first as a separate commit, then commit the decomposition.

## Implementation Landscape

### Key Files

- `src/extension/webview-provider.ts` (2196 lines) — the monolith to decompose. Contains 47 methods, 72 message handler cases, watchdogs, polling, process lifecycle, file ops, RPC event handling, command fallback.
- `src/extension/session-state.ts` (135 lines) — `SessionState` interface used by all extracted modules. Already exists, no changes needed.
- `src/extension/rpc-client.ts` — `GsdRpcClient` consumed by extracted modules. No changes needed.
- `src/extension/auto-progress.ts` — `AutoProgressPoller` referenced by session state. No changes needed.
- `src/webview/styles/` — 12 CSS partials + barrel already staged from S04. Just needs commit.
- `src/webview/index.ts` — already modified to import `./styles/index.css`. Staged.

### Extraction Targets (from S01 summaries)

| New Module | Functions to Extract | Context Interface | Lines (S01) |
|---|---|---|---|
| `watchdogs.ts` | `startPromptWatchdog`, `clearPromptWatchdog`, `startSlashCommandWatchdog`, `startActivityMonitor`, `stopActivityMonitor`, `abortAndPrompt` | `WatchdogContext` — getSession, postToWebview, output, emitStatus, nextPromptWatchdogNonce | ~282 |
| `rpc-events.ts` | `handleRpcEvent`, `handleExtensionUiRequest` | `RpcEventContext` — getSession, postToWebview, emitStatus, lastStatus, output, watchdogCtx, refreshWorkflowState, isWebviewVisible, webviewView | ~217 |
| `command-fallback.ts` | `armGsdFallbackProbe`, `startGsdFallbackTimer`, `handleGsdAutoFallback`, `GSD_COMMAND_RE`, `GSD_NATIVE_SUBCOMMANDS` | `CommandFallbackContext` — getSession, postToWebview, output | ~200 |
| `file-ops.ts` | `open_file`, `open_diff`, `open_url`, `export_html`, `save_temp_file`, `check_file_access`, `attach_files`, `copy_text`, `set_theme` (9 handlers) | `FileOpsContext` — postToWebview, output, ensureTempDir | ~217 |
| `message-router.ts` | `setupWebviewMessageHandling` (all 72 case dispatch) | `RouterContext` — composes all other contexts via spread from baseCtx | ~756 |
| `session-polling.ts` | `startStatsPolling`, `startHealthMonitoring`, `refreshWorkflowState`, `startWorkflowPolling` | `PollingContext` — getSession, postToWebview, output | ~84 |
| `process-launcher.ts` | `launchGsd`, `_doLaunchGsd` + RPC client wiring + event binding | `LauncherContext` — getSession, postToWebview, output, emitStatus, rpcEventCtx, watchdogCtx, commandFallbackCtx | ~123 |

### DI Pattern (from S01)

Each module defines a minimal `XxxContext` interface. The provider creates context objects via getter properties. All `this.x` references become `ctx.x`. Context interfaces compose: `RpcEventContext` includes watchdog fields. `RouterContext` composes all contexts via a `baseCtx` spread pattern.

### Build Order

1. **Commit S04 CSS** — staged CSS split is complete and verified. Commit first.
2. **Extract watchdogs.ts** — no dependencies on other extracted modules. Proves the DI pattern.
3. **Extract rpc-events.ts** — depends on watchdog functions.
4. **Extract command-fallback.ts** — standalone.
5. **Extract file-ops.ts** — standalone, minimal context.
6. **Extract session-polling.ts** — standalone polling logic.
7. **Extract process-launcher.ts** — depends on rpc-events.
8. **Extract message-router.ts** — depends on all other modules. Last because it imports from all others.
9. **Final cleanup** — remove dead imports, verify provider is <500 lines, build + test + lint.

### Verification Approach

After each extraction task:
- `npm run build` — clean (no TS errors)
- `npm test` — 251/251 tests pass
- `npm run lint` — 0 errors, 0 warnings

At slice completion:
- `wc -l src/extension/webview-provider.ts` — must be <500
- Bundle sizes within 15% of baseline (extension ~141KB, webview ~327KB, CSS ~120KB)
- All 8 new module files exist with expected exports
- `git diff --stat` confirms no unintended file changes

## Constraints

- All `this.x` references must become `ctx.x` — no partial conversions.
- `postToWebview` error paths must be preserved verbatim.
- `output.appendLine` logging must be preserved.
- `emitStatus` calls must be preserved.
- The `SessionState` interface is shared across all modules.
- Sync message handlers use fire-and-forget `.then()` pattern, not `await`.

## Common Pitfalls

- **Missing `this` → `ctx` conversion** — a single missed `this.getSession` in an extracted function will compile (if the function is still a method) but fail at runtime. Grep for `this.` in each new module after extraction.
- **Circular imports** — message-router imports from all modules, and rpc-events uses watchdog functions. Keep the dependency graph acyclic: provider → router → {watchdogs, rpc-events, command-fallback, file-ops, polling, launcher} → session-state.
- **Context getter overhead** — S01 used getter properties that create new context objects on each access. Fine for message handlers, but polling timers should capture context once.
- **Staged CSS changes** — must commit S04 CSS before starting decomposition to keep commits clean.
