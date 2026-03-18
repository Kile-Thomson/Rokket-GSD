---
id: S05
milestone: M013
provides:
  - src/extension/webview-provider.ts reduced from 2196 to 418 lines
  - src/extension/message-router.ts — 781 lines, all webview→extension message dispatch
  - src/extension/watchdogs.ts — 276 lines, prompt/slash-command/activity monitoring
  - src/extension/rpc-events.ts — 220 lines, RPC event handling and extension UI requests
  - src/extension/command-fallback.ts — 192 lines, /gsd command fallback logic
  - src/extension/file-ops.ts — 187 lines, file system operations
  - src/extension/session-polling.ts — 84 lines, stats/health/workflow polling
  - src/extension/process-launcher.ts — 186 lines, GSD process lifecycle management
  - S04 CSS split committed (12 partials under src/webview/styles/)
key_files:
  - src/extension/webview-provider.ts
  - src/extension/message-router.ts
  - src/extension/watchdogs.ts
  - src/extension/rpc-events.ts
  - src/extension/command-fallback.ts
  - src/extension/file-ops.ts
  - src/extension/session-polling.ts
  - src/extension/process-launcher.ts
key_decisions:
  - Context interface DI pattern — each module defines minimal context interface
  - Context composition via getter properties on GsdWebviewProvider
  - 7 modules extracted (message-router, watchdogs, rpc-events, command-fallback, file-ops, session-polling, process-launcher)
patterns_established:
  - Context interface pattern for extracting class methods into standalone functions
  - Getter properties create fresh context objects per access (acceptable for infrequent message handling)
drill_down_paths: []
duration: 20m
verification_result: passed
completed_at: 2026-03-18
---

# S05: Decompose webview-provider.ts (remediation)

**Re-extracted 7 modules from the 2196-line webview-provider.ts monolith, achieving 418 lines (target <500). Also committed S04's CSS split. Zero behavioral changes — build clean, lint clean, 251/251 tests pass.**

## What Happened

S01 had successfully decomposed webview-provider.ts but the code changes were never committed — only task summaries survived. S05 used those summaries as a precise blueprint to re-execute the extraction in a single pass.

Each module defines a minimal context interface (WatchdogContext, RpcEventContext, CommandFallbackContext, FileOpsContext, PollingContext, LauncherContext, RouterContext) capturing only the dependencies it needs. The provider creates context objects via getter properties and delegates all non-orchestration work.

| Module | Lines | Responsibility |
|--------|-------|---------------|
| webview-provider.ts | 418 | Session lifecycle, webview setup, DI wiring |
| message-router.ts | 781 | All 72 webview→extension message cases |
| watchdogs.ts | 276 | Prompt, slash-command, activity monitoring |
| rpc-events.ts | 220 | RPC event→webview forwarding, extension UI requests |
| command-fallback.ts | 192 | /gsd command fallback workaround |
| file-ops.ts | 187 | File open, diff, URL, export, temp, attach |
| session-polling.ts | 84 | Stats, health, workflow state polling |
| process-launcher.ts | 186 | GSD process startup, event wiring, teardown |

## Verification

| Check | Result |
|-------|--------|
| `npm run build` | ✅ clean |
| `npm test` — 251 tests | ✅ all pass |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `wc -l webview-provider.ts` — 418 | ✅ (target <500) |
| Extension bundle: 138.4KB | ✅ within 15% of baseline |
| Webview bundle: 327.2KB | ✅ within 15% of baseline |
| CSS bundle: 120.2KB | ✅ within 15% of baseline |

## Forward Intelligence

### What the next slice should know
- All extracted modules use the context interface DI pattern. To test them, mock the context interface fields — no need to instantiate GsdWebviewProvider.
- StatusBarUpdate is defined in webview-provider.ts, not shared/types.
- The modules have clean dependency ordering: provider → router → {watchdogs, rpc-events, command-fallback, file-ops, polling, launcher} → session-state.

### What's fragile
- Context getter properties create new objects per access. Polling callbacks should capture ctx once at timer setup, not re-create per tick (session-polling already does this correctly).
- message-router.ts at 781 lines is the largest module — it could be further decomposed if needed, but all 72 cases are flat switch arms, not deeply nested.
