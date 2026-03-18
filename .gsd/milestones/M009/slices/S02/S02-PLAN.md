# S02: RPC Protocol Gaps

**Goal:** Clean process exit handling; defer set_follow_up_mode and set_steering_mode until CLI exposes them.
**Demo:** Kill GSD process gracefully → dashboard shows "stopped" not "crashed".

## Must-Haves

- Distinguish clean exit (code 0, SIGTERM, SIGKILL) from crash in process status
- Clean exit deletes RPC client reference (no stale auto-restart)
- Crash exit preserves auto-restart-on-next-prompt behavior

## Proof Level

- This slice proves: contract
- Real runtime required: no (logic change, verified by build + code review)
- Human/UAT required: no

## Verification

- `npm run build` — clean build
- Code review of exit handler logic

## Tasks

- [x] **T01: Clean exit vs crash distinction** `est:15m`
  - Do: In webview-provider exit handler, check code===0 or signal SIGTERM/SIGKILL as clean exit → status "stopped". Unify restart logic to use same check.
  - Verify: `npm run build`
  - Done when: clean exits produce "stopped" status, crashes produce "crashed" status

## Scope Reduction Notes

- `set_follow_up_mode` and `set_steering_mode` do not exist in the CLI RPC protocol — nothing to wire
- `session_shutdown` is an internal CLI extension event, not an RPC event — the VS Code extension already handles the downstream effect (process exit) correctly

## Files Likely Touched

- `src/extension/webview-provider.ts`
