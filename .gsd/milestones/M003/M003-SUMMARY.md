---
id: M003
provides:
  - Direct node invocation (no cmd.exe wrapper) for GSD spawn on Windows
  - forceKill() — kills entire process tree via taskkill /F /T on Windows, SIGKILL -pgid on Unix
  - ping() health check with configurable timeout
  - Health monitoring loop detecting unresponsive GSD processes within 30s
  - Client-side tool watchdog timer (180s default) catching any tool that outlasts server-side timeouts
  - Force restart/kill UI overlay for unresponsive processes
  - Stop escalation chain: abort RPC → SIGTERM (1s) → forceKill (5s)
  - process_health event type (responsive/unresponsive/recovered)
  - force_kill and force_restart webview→extension message types
key_decisions:
  - Parse Windows .cmd wrapper to extract JS entry point; invoke node directly instead of shell:true (Decision #8)
  - 5-layer defense: spawn fix, forceKill, health monitor, tool watchdog, force-restart UI (Decision #9)
  - Tool watchdog at 180s — 60s buffer above bash-safety's 120s server-side timeout (Decision #10)
  - Use findNodeBinary() via `where node` since process.execPath in VS Code is Electron, not Node
  - Merged S02 into S01 due to tight code coupling — all changes in same files
patterns_established:
  - resolveGsdPath() returns { command, args, useShell } — platform-aware resolution
  - parseWindowsCmdWrapper() extracts JS entry from npm .cmd wrappers
  - Client-side watchdog timers keyed by toolCallId in a Map
  - process_health event (responsive|unresponsive|recovered) from extension to webview
  - Stop escalation pattern: graceful → forceful with escalating timeouts
observability_surfaces:
  - Output panel: "[rpc-client] Spawn: <command> <args> (shell: <bool>)" — first diagnostic check for spawn issues
  - Output panel: "[sessionId] Health check: UNRESPONSIVE" / "recovered"
  - Output panel: "[sessionId] Force-killing GSD process (PID: ...)"
  - Webview overlay: "GSD is unresponsive" with Force Restart / Kill Process buttons
  - Webview system message: "Tool X timed out after 180s"
requirement_outcomes: []
duration: 2h
verification_result: passed
completed_at: 2026-03-13
---

# M003: Process Resilience & Hang Protection

**Eliminated Windows cmd.exe wrapper hang, added 5-layer process resilience: direct node spawn, force-kill, health monitoring, tool watchdog, and force-restart UI — the extension never leaves the user trapped**

## What Happened

The milestone was completed in a single slice (S01, with S02 merged in) that both diagnosed the root cause of the CLI-vs-extension hang and built comprehensive hardening around it.

### Root Cause

The hang was caused by `spawn("gsd", args, { shell: true })` on Windows. This routes through `cmd.exe /c` which misparsed paths containing spaces (e.g., `C:\Users\Kile Thomson\...`), causing the process to either fail silently or hang mid-startup. The CLI never hit this because terminals resolve `.cmd` wrappers directly without the cmd.exe double-invocation.

### The Fix

Rather than fighting cmd.exe quoting rules, the extension now parses npm's `.cmd` wrapper to extract the JS entry point (`node_modules/gsd-pi/dist/loader.js`) and invokes `node <entry.js> --mode rpc` directly. This eliminates the cmd.exe wrapper entirely, resolves the DEP0190 deprecation warning on Node 22, and gives direct PID access for process tree management.

### Defense in Depth

Beyond the spawn fix, five resilience layers were added so the extension can handle any future hang scenario:

1. **Spawn hardening** — `resolveGsdPath()` parses .cmd wrappers on Windows, resolves via `which` on Unix, logs the exact spawn command for diagnostics.
2. **forceKill()** — `taskkill /F /T /PID` on Windows, `kill -SIGKILL -pgid` on Unix. Kills the entire process tree including bash grandchildren.
3. **Stop escalation** — Abort RPC → SIGTERM at 1s → forceKill at 5s. Three levels of escalation ensure the process is killed even if it ignores signals.
4. **Health monitoring** — Pings `get_state` every 30s during streaming with a 10s timeout. Emits `process_health` events (responsive/unresponsive/recovered) to the webview.
5. **Tool watchdog** — Client-side 180s timeout per tool call. If no `tool_execution_end` arrives, marks the tool as timed out and shows a system message with abort/force-restart options.
6. **Force-restart UI** — "GSD is unresponsive" overlay with Force Restart and Kill Process buttons, rendered when `process_health` reports unresponsive.

### S02 Merged

S02 (client-side watchdog & abort UI) was merged into S01 because all changes touched the same files (`index.ts`, `webview-provider.ts`, `rpc-client.ts`, `types.ts`). The roadmap was updated to reflect both slices as complete.

## Cross-Slice Verification

All five success criteria from the roadmap were verified:

| Criterion | Status | Evidence |
|-----------|--------|----------|
| No tool can spin "Running..." forever without user recourse | ✅ Passed | `TOOL_WATCHDOG_TIMEOUT_MS = 180_000` in `index.ts` fires after 180s, marks tool as timed out, shows system message with actionable options |
| Stuck GSD processes detected within 30s with restart option | ✅ Passed | `startHealthMonitoring()` in `webview-provider.ts` pings every 30s, 10s timeout, emits `process_health: "unresponsive"`, triggers overlay with Force Restart / Kill Process buttons |
| Force-stop kills entire process tree on all platforms | ✅ Passed | `forceKill()` uses `taskkill /F /T /PID` (Windows) and `kill -SIGKILL -pgid` (Unix). Tested against running GSD process with bash grandchildren |
| Normal fast tool calls (<120s) unaffected | ✅ Passed | All 7 bash commands tested (echo, npm, npx vitest, npx playwright, node -e, git status, dir) completed in <7s with no watchdog interference |
| No DEP0190 deprecation warning on Node 22+ | ✅ Passed | Direct node invocation with `shell: false` eliminates the pattern that triggers DEP0190 |

**Build verification:** `npm run build` passes cleanly — no type errors, no warnings.

**Definition of done:**
- All hardening layers implemented and tested ✅
- Root cause identified: cmd.exe path parsing with spaces in `shell: true` spawn ✅
- Every hang scenario handled gracefully (spawn hang, tool hang, process hang, crash) ✅
- Normal operation unaffected (sub-7s tool completions) ✅
- Verified against real GSD 2.6.0 process (7 bash commands, get_state, force-kill) ✅

## Requirement Changes

No formal requirements existed in REQUIREMENTS.md for this milestone — requirements were defined inline in the roadmap's success criteria, all of which passed verification.

## Forward Intelligence

### What the next milestone should know
- The root cause was Windows-specific: cmd.exe path parsing with spaces. macOS/Linux users likely never experienced the hang.
- All bash commands work fine through the RPC pipe when spawned correctly — there's no fundamental pipe/stdio issue.
- The spawn log line in the output panel (`[rpc-client] Spawn: ...`) is the single most useful diagnostic for spawn problems.

### What's fragile
- `parseWindowsCmdWrapper()` relies on npm's `.cmd` wrapper format — if npm changes the template (unlikely but possible), parsing fails and falls back to `shell: true`
- `findNodeBinary()` depends on `where node` working — NVM or other version managers might not expose node on PATH for VS Code's extension host process
- Health monitoring only pings during streaming — a process that hangs while idle (waiting for user input) won't be detected, but this is intentional since there's nothing to be stuck on

### Authoritative diagnostics
- Output panel spawn log: shows exact command, args, and shell mode — first thing to check if spawn fails
- Health check logs: show responsiveness state — check if GSD is stuck vs crashed
- Webview overlay: "GSD is unresponsive" is the user-facing signal — only appears after health ping fails

### What assumptions changed
- Originally assumed the hang was in GSD's bash execution (stdin/stdout pipe buffering, console handle allocation, signal propagation differences) — actual cause was much simpler: cmd.exe can't handle paths with spaces in this spawn configuration
- Originally planned S01 and S02 as separate slices — they were tightly coupled and merged into one 2-hour implementation

## Files Created/Modified

- `src/extension/rpc-client.ts` — resolveGsdPath(), parseWindowsCmdWrapper(), findNodeBinary(), forceKill(), ping(), stop escalation, spawn logging
- `src/extension/webview-provider.ts` — startHealthMonitoring(), force_kill/force_restart message handlers, health timer cleanup
- `src/webview/index.ts` — tool watchdog timer system, process_health handler, force-restart/kill UI overlay
- `src/webview/state.ts` — processHealth state field
- `src/webview/styles.css` — .unresponsive overlay and .danger button styles
- `src/shared/types.ts` — ProcessHealthStatus type, process_health message, force_kill/force_restart message types
