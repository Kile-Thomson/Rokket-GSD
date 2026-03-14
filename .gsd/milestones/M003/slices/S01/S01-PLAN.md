# S01: Spawn hardening & process lifecycle

**Goal:** Remove `shell: true` spawn, add process health monitoring, force-kill capability, and investigate root cause of CLI-vs-extension behavior difference
**Demo:** GSD spawns cleanly on Windows without DEP0190 warning, health pings detect unresponsive processes, force-kill terminates entire process tree

## Must-Haves

- Spawn GSD without `shell: true` on Windows (resolve path, use `execFile`-style spawn)
- `forceKill()` method that kills the entire process tree including grandchildren
- `ping()` health check with configurable timeout
- Health monitoring loop in webview-provider that detects unresponsive processes
- `process_health` event forwarded to webview for UI rendering
- Root cause investigation: compare CLI vs RPC pipe behavior for bash commands

## Verification

- `npm run build` succeeds with no errors
- Launch extension, confirm no DEP0190 warning in Output panel
- Send a prompt, verify tool execution completes normally
- Manual test: health monitoring detects process state correctly

## Observability / Diagnostics

- Runtime signals: `process_health` events emitted to webview (responsive/unresponsive/recovered)
- Inspection surfaces: VS Code Output panel "Rokket GSD" shows health check results
- Failure visibility: stderr captured, exit detail enriched, health state tracked

## Tasks

- [x] **T01: Remove shell:true spawn and add forceKill** `est:45m`
  - Why: `shell: true` wraps GSD in cmd.exe on Windows, breaking signal propagation and triggering DEP0190. forceKill is needed for unrecoverable hangs.
  - Files: `src/extension/rpc-client.ts`
  - Do: 
    - Resolve `gsd` executable path using `where` (Windows) / `which` (Unix) before spawning
    - Spawn with `shell: false` using the resolved path
    - Add `forceKill()` method: uses `taskkill /F /T /PID` on Windows, `kill -9 -pgid` on Unix
    - Add `getPid()` accessor for the child process PID
    - Ensure `stop()` tries graceful abort → SIGTERM → forceKill escalation
  - Verify: `npm run build`, launch extension, no DEP0190 in Output panel
  - Done when: GSD spawns without shell wrapper on all platforms, forceKill terminates process tree

- [x] **T02: Health monitoring and ping** `est:45m`
  - Why: Need to detect when GSD becomes unresponsive (stuck on I/O, zombie process) so we can surface recovery UI
  - Files: `src/extension/rpc-client.ts`, `src/extension/webview-provider.ts`, `src/shared/types.ts`
  - Do:
    - Add `ping(timeoutMs)` method to RpcClient — sends `get_state` with short timeout, returns boolean
    - Add health monitoring in webview-provider: during streaming, ping every 30s; if ping fails, emit `process_health` event to webview
    - Add `process_health` message type to shared types (status: responsive | unresponsive | recovered)
    - On health failure: log to Output panel, forward to webview
    - On recovery: emit recovered event to webview
    - Ensure stats polling doesn't interfere with health checks
  - Verify: Build succeeds, health monitoring logs appear in Output panel during streaming
  - Done when: Unresponsive GSD processes are detected within 30s and surfaced to webview

- [x] **T03: Root cause investigation — CLI vs RPC pipe** `est:1h`
  - Why: We need to understand WHY the same bash command works in CLI but hangs through our pipe. Protection layers are necessary but insufficient without understanding the root cause.
  - Files: diagnostic scripts (temporary)
  - Do:
    - Build a diagnostic test harness that spawns GSD in RPC mode and sends bash commands
    - Compare: process tree (pstree/tasklist), environment variables, stdin/stdout/stderr handle types, console allocation
    - Test with progressively complex commands: echo → npm → npx → vitest → playwright
    - Test with and without shell:true to isolate cmd.exe wrapper effect
    - Document findings in S01-SUMMARY.md
  - Verify: Root cause identified or narrowed to specific environment conditions
  - Done when: We can explain the behavior difference, or have documented exactly which conditions trigger it

## Files Likely Touched

- `src/extension/rpc-client.ts`
- `src/extension/webview-provider.ts`
- `src/shared/types.ts`
