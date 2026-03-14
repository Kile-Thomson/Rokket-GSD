---
id: T04
parent: S01
milestone: M008
provides:
  - Diagnostic logging on all silent catches in GSD binary resolution and process kill paths
key_files:
  - src/extension/rpc-client.ts
key_decisions:
  - Resolution fallback catches (findNodeBinary, resolveGsdWindows, resolveGsdUnix, parseWindowsCmdWrapper) get console.warn with context — these are the primary "why won't GSD start" debug signals
  - forceKill catches emit via this.emit("log") since console.warn isn't available in all extension host contexts and the RPC client already has a log event pattern
  - Process cleanup catches (abort send, group-kill fallback to single-kill, ping, ChildProcess.kill on already-dead process) left silent with explanatory comments — these are expected failure modes, not bugs
  - JSON parse failure in processBuffer already had logging — left as-is
patterns_established: []
observability_surfaces:
  - "console.warn lines prefixed [rpc-client] for binary resolution failures — visible in VS Code developer console"
  - "this.emit('log') lines for forceKill failures — visible in extension log channel"
duration: 10min
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T04: Replace silent catches in critical paths with visible errors

**Replaced 7 silent `catch { /* ignored */ }` blocks in rpc-client.ts with diagnostic logging, preserving fallback behavior.**

## What Happened

Audited all catch blocks in `src/extension/rpc-client.ts` (14 catches) and `src/webview/index.ts` (2 catches). Categorized each as critical-path (needs logging) or acceptable-silent (expected failure mode).

The 5 binary resolution catches (findNodeBinary, resolveGsdWindows×2, parseWindowsCmdWrapper, resolveGsdUnix) were the highest-value targets — when GSD fails to start, these are the functions that tried and failed to locate the binary, but previously gave zero diagnostic output. Added `console.warn` with function name and error message.

The 2 forceKill catches (taskkill on Windows, process.kill fallback on Unix) now emit via the RPC client's log event. The ChildProcess.kill catch at the end of forceKill was left silent with a comment — the process is expected to be dead by that point.

The abort-send catch in stop() got an explanatory comment. Ping, JSON parse (already logged), and the webview URI parse catch were left as-is — all appropriate for their context.

## Verification

- `npm run build` — passes (extension + webview)
- `npx vitest run` — 89 tests pass across 4 suites
- Remaining catch blocks audited: 4 left without logging, all with documented rationale (abort fallback, group-kill cascade, ping by-design, JSON parse already logged)

## Diagnostics

- Binary resolution failures surface as `[rpc-client] resolveGsdWindows: "where gsd.cmd" failed: ...` in VS Code developer console (console.warn)
- forceKill failures surface as `[rpc-client] forceKill: taskkill failed for PID ...: ...` in the extension log channel (emit "log")
- No silent catches remain in critical paths — all either log or have documented rationale for silence

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/extension/rpc-client.ts` — Replaced 7 silent catches with diagnostic logging in binary resolution and forceKill paths
