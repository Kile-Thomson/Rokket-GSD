---
id: S02
parent: M009
milestone: M009
provides:
  - Clean exit vs crash distinction in process status
requires: []
affects: []
key_files:
  - src/extension/webview-provider.ts
key_decisions:
  - set_follow_up_mode and set_steering_mode deferred — CLI doesn't expose these RPC methods yet
  - session_shutdown is internal to CLI extension system, not an RPC event — no VS Code handler needed
  - Clean exit (code 0, SIGTERM, SIGKILL) → "stopped" status; anything else → "crashed"
patterns_established: []
observability_surfaces:
  - Process status correctly distinguishes stopped vs crashed
drill_down_paths: []
duration: ~10m
verification_result: passed
completed_at: 2026-03-15
---

# S02: RPC Protocol Gaps

**Clean process exit now produces "stopped" status instead of "crashed"; RPC methods deferred until CLI exposes them.**

## What Happened

Investigated the CLI source — `session_shutdown` is an internal extension event (pi.on), not an RPC event sent to external consumers. The VS Code extension already handles process exit correctly. `set_follow_up_mode` and `set_steering_mode` don't exist in the CLI RPC protocol yet.

The one real fix: the exit handler previously sent `process_status: "crashed"` for all exits, including clean shutdowns (code 0, SIGTERM). Now it correctly distinguishes clean exits ("stopped") from crashes ("crashed"), and only crashes trigger the auto-restart-on-next-prompt path.

## Verification

- `npm run build` — clean build, no errors

## Deviations

- Scope reduced significantly — 2 of 3 planned features don't exist in CLI yet

## Known Limitations

- `set_follow_up_mode` and `set_steering_mode` not wired — blocked on CLI RPC protocol additions

## Follow-ups

- When CLI adds follow_up_mode/steering_mode RPC methods, wire them through rpc-client.ts

## Files Created/Modified

- `src/extension/webview-provider.ts` — clean exit detection in process exit handler
