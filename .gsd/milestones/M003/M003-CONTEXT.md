# M003: Process Resilience & Hang Protection — Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

## Project Description

Rokket GSD is a VS Code extension wrapping the GSD AI coding agent. It spawns GSD as a child process (`gsd --mode rpc`) and communicates via JSON-RPC over stdin/stdout. The webview renders streaming tool calls, text, and thinking blocks.

## Why This Milestone

Tool execution (especially bash commands) can hang indefinitely in the VS Code extension while the same commands complete fine in the CLI. The extension has zero defensive layers — no timeouts, no health checks, no abort UI, no force-kill path. Users get trapped with a spinning "Running..." indicator and no recourse.

This was deprioritized after M001/M002 but GSD 2.6.0 brought changes that surfaced the issue for multiple users.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Never get permanently stuck on a hanging tool call — a watchdog timeout surfaces actionable UI
- Force-stop any stuck tool or unresponsive GSD process from the chat UI
- See clear diagnostic information when things go wrong (timeout, unresponsive, crash)

### Entry point / environment

- Entry point: VS Code extension sidebar / tab panel
- Environment: Windows (primary), macOS/Linux (secondary)
- Live dependencies involved: GSD RPC child process, bash shell grandchild processes

## Completion Class

- Contract complete means: watchdog timers fire, abort/force-kill buttons work, health checks detect unresponsive processes
- Integration complete means: works with real GSD 2.6.0 RPC process on Windows
- Operational complete means: handles real-world hang scenarios (long npm commands, interactive prompts, process zombies)

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A tool that runs longer than the watchdog timeout shows actionable UI and can be force-stopped
- An unresponsive GSD process is detected and can be restarted from the UI
- Normal fast tool calls are not affected by watchdog timers
- The `shell: true` spawn issue is resolved (no DEP0190 warning, correct signal propagation)

## Risks and Unknowns

- Root cause of CLI-vs-extension behavior difference is still unknown — hardening protects users but we need to investigate *why* the same bash command hangs through our pipe
- Windows process tree kill via `taskkill` may have edge cases with Git Bash grandchildren

## Existing Codebase / Prior Art

- `src/extension/rpc-client.ts` — spawns GSD, manages stdin/stdout pipe, request/response correlation
- `src/extension/webview-provider.ts` — routes RPC events to webview, manages sessions
- `src/webview/index.ts` — handles all RPC events, renders tool calls, manages streaming state
- `src/webview/renderer.ts` — DOM rendering for tool call cards
- `~/.gsd/agent/extensions/bash-safety/` — existing 120s bash timeout extension (server-side)

## Scope

### In Scope

- Spawn hardening (remove `shell: true` on Windows)
- Client-side tool execution watchdog timer
- Abort/force-stop UI for stuck tools
- Process health monitoring (heartbeat)
- Force-kill recovery path
- Root cause investigation of CLI-vs-extension hang difference

### Out of Scope / Non-Goals

- Changes to GSD itself (upstream)
- Test suite (M003 was originally Testing & Quality — that's now M004)
- New features

## Technical Constraints

- Must work on Windows (primary target), macOS, Linux
- No framework — vanilla DOM
- Must not break existing streaming/tool rendering
- esbuild bundler for both extension (CJS) and webview (IIFE)

## Integration Points

- GSD RPC process — stdin/stdout JSONL protocol
- VS Code extension host — Node.js runtime (v22 in current VS Code)
- Webview — browser sandbox with postMessage bridge
