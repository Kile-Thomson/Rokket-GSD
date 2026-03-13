---
id: S01
parent: M003
milestone: M003
provides:
  - Direct node invocation (no cmd.exe wrapper) for GSD spawn on Windows
  - forceKill() — kills entire process tree via taskkill /F /T
  - ping() health check with configurable timeout
  - Health monitoring loop detecting unresponsive processes
  - Client-side tool watchdog timer (180s default)
  - Force restart/kill UI overlay
  - process_health event type
  - force_kill and force_restart webview→extension messages
requires: []
affects: []
key_files:
  - src/extension/rpc-client.ts
  - src/extension/webview-provider.ts
  - src/webview/index.ts
  - src/webview/state.ts
  - src/webview/styles.css
  - src/shared/types.ts
key_decisions:
  - Parse Windows .cmd wrapper to extract JS entry point; invoke node directly instead of shell:true
  - Use findNodeBinary() via `where node` since process.execPath in VS Code is Electron, not Node
  - Tool watchdog at 180s (60s above bash-safety's 120s server-side timeout) to catch anything bash-safety misses
  - Health ping uses get_state every 30s during streaming with 10s timeout
  - Stop escalation: abort RPC → SIGTERM at 1s → forceKill at 5s
patterns_established:
  - resolveGsdPath() returns { command, args, useShell } — platform-aware resolution
  - parseWindowsCmdWrapper() extracts JS entry from npm .cmd wrappers
  - Client-side watchdog timers keyed by toolCallId in a Map
  - process_health event (responsive|unresponsive|recovered) from extension to webview
observability_surfaces:
  - Output panel: "[rpc-client] Spawn: <command> <args> (shell: <bool>)"
  - Output panel: "[sessionId] Health check: UNRESPONSIVE" / "recovered"
  - Output panel: "[sessionId] Force-killing GSD process (PID: ...)"
  - Webview overlay: "GSD is unresponsive" with Force Restart / Kill Process buttons
  - Webview system message: "Tool X timed out after 180s"
drill_down_paths: []
duration: 2h
verification_result: passed
completed_at: 2026-03-13
---

# S01: Spawn hardening, process lifecycle & root cause investigation

**Eliminated cmd.exe wrapper hang on Windows (spaces in path), added 5-layer resilience: direct node spawn, forceKill, health monitoring, tool watchdog, force-restart UI**

## What Happened

### Root Cause Found

The CLI-vs-extension hang was caused by `spawn("gsd", args, { shell: true })` on Windows. This creates a `cmd.exe /c "C:\Users\Kile Thomson\AppData\Roaming\npm\gsd.cmd" --mode rpc` invocation. When the user's path contains spaces (e.g., `Kile Thomson`), cmd.exe misparses the path and the process either fails immediately or hangs mid-startup.

The CLI never hits this because it runs `gsd` directly from a terminal that resolves the .cmd wrapper correctly.

### Fix: Direct Node Invocation

Rather than fighting with cmd.exe quoting, we parse the `.cmd` wrapper to extract the JS entry point (`node_modules/gsd-pi/dist/loader.js`) and invoke `node <entry.js> --mode rpc` directly. This:
- Eliminates the cmd.exe wrapper entirely (`shell: false`)
- Eliminates the DEP0190 deprecation warning on Node 22
- Works regardless of spaces in paths
- Gives us direct PID for process tree management

Used `findNodeBinary()` via `where node` because `process.execPath` inside VS Code's extension host is the Electron binary, not Node.

### Hardening Layers

1. **Spawn hardening** — `resolveGsdPath()` parses .cmd wrappers on Windows, resolves Unix paths via `which`
2. **forceKill()** — `taskkill /F /T /PID` on Windows, `kill -SIGKILL -pgid` on Unix. Kills entire process tree.
3. **Stop escalation** — abort RPC → SIGTERM (1s) → forceKill (5s)
4. **Health monitoring** — pings `get_state` every 30s during streaming, 10s timeout. Emits `process_health` events.
5. **Tool watchdog** — client-side 180s timeout per tool call. If no `tool_execution_end` arrives, marks tool as timed out and shows system message.
6. **Force-restart UI** — "GSD is unresponsive" overlay with Force Restart and Kill Process buttons.

### S02 Merged

The client-side watchdog and abort UI (originally planned as S02) was implemented as part of S01 since the code was tightly coupled.

## Verification

- `npm run build` passes cleanly (no type errors, no warnings)
- Direct node invocation tested: spawns GSD, `get_state` returns correctly, tools execute and complete
- All 7 bash commands tested via RPC pipe (echo, npm, npx vitest, npx playwright, node -e, git status, dir): all completed in under 7s
- Confirmed cmd.exe wrapper with spaces in path fails; direct node invocation succeeds
- Force-kill tested via `taskkill /F /T` on running GSD process

## Deviations

S02 (watchdog & abort UI) was merged into S01 since all changes were in the same files and tightly coupled. The roadmap was updated to reflect this.

## Known Limitations

- Health monitoring pings only during streaming — idle processes aren't monitored (intentional: no need to ping when GSD is just waiting for input)
- Tool watchdog timeout (180s) is hardcoded — could be made configurable via settings
- The `findNodeBinary()` fallback to bare `"node"` with `shell: false` may fail on systems where node is not on PATH for the VS Code process
- VS Code extension host live testing not yet done — all testing was from standalone Node process

## Follow-ups

- Live test in VS Code extension host to confirm the spawn fix works in the actual environment
- Consider making watchdog timeout configurable via VS Code settings
- Consider adding a "time elapsed" counter on running tool cards so users see progress
- The `google-search` extension fails to load (missing `@google/genai` module) — unrelated but visible in stderr

## Files Created/Modified

- `src/extension/rpc-client.ts` — resolveGsdPath(), parseWindowsCmdWrapper(), findNodeBinary(), forceKill(), ping(), spawn logging
- `src/extension/webview-provider.ts` — startHealthMonitoring(), force_kill/force_restart message handlers, health timer cleanup
- `src/webview/index.ts` — tool watchdog timer system, process_health handler, force-restart/kill UI overlay
- `src/webview/state.ts` — processHealth state field
- `src/webview/styles.css` — .unresponsive and .danger button styles
- `src/shared/types.ts` — ProcessHealthStatus type, process_health message, force_kill/force_restart messages

## Forward Intelligence

### What the next slice should know
- The root cause was Windows-specific: cmd.exe path parsing with spaces. macOS/Linux users likely never hit this.
- All bash commands work fine through the RPC pipe when spawned correctly — there's no fundamental pipe/stdio issue.

### What's fragile
- `parseWindowsCmdWrapper()` relies on npm's .cmd wrapper format — if npm changes the template, parsing will fail and we fall back to shell:true
- `findNodeBinary()` depends on `where node` working — NVM or other version managers might not expose node on the PATH for VS Code's process

### Authoritative diagnostics
- Output panel spawn log line shows exactly what command was used — first thing to check if spawn fails
- Health check logs show responsiveness — check if GSD is stuck vs crashed

### What assumptions changed
- Originally assumed the hang was in GSD's bash execution (stdin/stdout pipe buffering, console handle allocation) — actual cause was much simpler: cmd.exe can't handle paths with spaces in this spawn configuration
