---
id: T02
parent: S01
milestone: M008
provides:
  - 10MB stdout buffer cap in RPC client preventing OOM from runaway output
key_files:
  - src/extension/rpc-client.ts
key_decisions:
  - Buffer reset (not truncation) on cap exceeded — partial JSON lines from truncation would corrupt the JSONL protocol
patterns_established:
  - none
observability_surfaces:
  - Warning log emitted via "log" event when buffer cap triggers: "[rpc-client] Buffer exceeded 10MB — resetting"
duration: 5min
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T02: Cap RPC buffer size to prevent OOM

**Added 10MB cap on RPC stdout buffer with reset-on-overflow and warning log to prevent extension host OOM from runaway pi output.**

## What Happened

The buffer cap was already implemented in a prior (compacted) session — the commit `9988c60` includes this work. The implementation adds a `MAX_BUFFER_SIZE` constant (10MB) checked on each `data` event from the child process stdout. When exceeded, the buffer is reset to empty and a warning is emitted via the `log` event.

Design choice: full reset rather than oldest-data truncation. The RPC protocol is JSONL — truncating mid-line would produce corrupt JSON and cascade parse errors. A clean reset loses in-flight data but preserves protocol integrity.

## Verification

- `npx vitest run` — 89 tests pass (4 suites)
- `npm run build` — extension and webview compile cleanly
- Buffer cap logic confirmed present at lines 313-320 of rpc-client.ts

## Diagnostics

- When truncation occurs, `[rpc-client] Buffer exceeded 10MB — resetting (possible runaway output)` is emitted as a log event, visible in the extension's log channel

## Deviations

None — implementation matched the plan exactly.

## Known Issues

None.

## Files Created/Modified

- `src/extension/rpc-client.ts` — 10MB buffer cap with reset and warning (already committed)
