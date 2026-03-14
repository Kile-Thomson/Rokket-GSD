---
id: T03
parent: S01
milestone: M008
provides:
  - Nonce-guarded prompt watchdog timer preventing stale callback leaks
key_files:
  - src/extension/webview-provider.ts
key_decisions:
  - Used incrementing nonce pattern rather than AbortController — simpler, no extra object lifecycle, and setTimeout callbacks can't be truly aborted anyway
patterns_established:
  - none
observability_surfaces:
  - Watchdog log lines include sessionId for correlating timer lifecycle in the output channel
duration: 10min
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T03: Fix prompt watchdog timer leak

**Added nonce guard to prompt watchdog timer preventing stale retry callbacks from leaking across prompt cycles.**

## What Happened

The prompt watchdog in `webview-provider.ts` had a timer leak: when a retry was in-flight (the async `client.prompt()` call on line 260), a new prompt arriving would clear the old watchdog entry from the map, but the stale retry callback would continue after the await and create a new `setTimeout` on the detached watchdog object. This orphaned timer could fire later and incorrectly clear the *new* prompt's watchdog or show spurious error messages.

Fix: Added an incrementing `promptWatchdogNonce` counter. Each `startPromptWatchdog` call captures the current nonce. All callback paths — initial timeout, post-retry, and second timeout — verify the nonce is still current before acting. Stale callbacks silently bail out.

## Verification

- `npx vitest run` — 89 tests pass (4 suites)
- `npx tsc --noEmit` — no new errors from this change (pre-existing TS errors in index.ts/webview-provider.ts unrelated to watchdog)
- Code audit confirms: all three timer callback paths check nonce before acting; `clearPromptWatchdog` clears timer + deletes map entry; dispose path clears all watchdogs

## Diagnostics

- Watchdog log lines (`Prompt watchdog: no agent_start...`, `retry also got no response`) include sessionId
- `promptWatchdogs` map is inspectable at runtime; each entry includes `nonce` for correlating timer generation

## Deviations

None — task plan said "audit watchdog timer lifecycle, confirm or fix reference management" and the audit revealed the stale-callback leak.

## Known Issues

None.

## Files Created/Modified

- `src/extension/webview-provider.ts` — Added `promptWatchdogNonce` counter and nonce checks in all watchdog timer callbacks
