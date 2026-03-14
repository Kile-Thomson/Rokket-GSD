# M003: Process Resilience & Hang Protection

**Vision:** The extension never leaves the user trapped. Every hang path has a timeout, every timeout has actionable UI, every stuck process can be killed and restarted.

## Success Criteria

- No tool execution can spin "Running..." forever without user recourse
- Stuck GSD processes are detected within 30 seconds and surfaced with a restart option
- Force-stop kills the entire process tree (including bash grandchildren) on all platforms
- Normal fast tool calls (<120s) are visually and functionally unaffected
- No DEP0190 deprecation warning on Node 22+

## Key Risks / Unknowns

- Root cause of CLI-vs-extension hang difference — may be environment-specific (console vs pipe), process group handling, or signal propagation through cmd.exe wrapper
- Windows process tree kill edge cases with Git Bash / MSYS2 grandchildren

## Proof Strategy

- CLI-vs-extension root cause → investigate in S01 by building diagnostic tooling and comparing process trees
- Process tree kill → prove in S01 by testing `taskkill /F /T` against real bash grandchild processes

## Verification Classes

- Contract verification: manual testing of timeout, abort, force-kill, health check scenarios
- Integration verification: real GSD 2.6.0 process on Windows with bash commands
- Operational verification: process lifecycle (start, hang, kill, restart) works correctly
- UAT / human verification: user can escape any hang scenario from the UI

## Milestone Definition of Done

This milestone is complete only when all are true:

- All hardening layers are implemented and tested
- Root cause of CLI-vs-extension difference is identified (or documented as environment-specific)
- The extension handles every hang scenario gracefully
- Normal operation is unaffected
- Success criteria are verified against a real GSD 2.6.0 process

## Slices

- [x] **S01: Spawn hardening & process lifecycle** `risk:high` `depends:[]`
  > After this: GSD spawns without `shell: true`, process health is monitored, force-kill works on all platforms, root cause investigation complete
- [x] **S02: Client-side watchdog & abort UI** `risk:medium` `depends:[S01]`
  > After this: Tool cards show timeout warnings and force-stop buttons, users can always escape a hanging tool (implemented as part of S01)

## Boundary Map

### S01 → S02

Produces:
- `GsdRpcClient.forceKill()` method for killing entire process tree
- `GsdRpcClient.ping()` method for health checking
- `process_health` event type for surfacing unresponsive state to webview
- Diagnostic findings on CLI-vs-extension behavior difference

Consumes:
- nothing (first slice)
