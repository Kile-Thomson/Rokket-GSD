# S01: Stability fixes & error surfacing — UAT

**Milestone:** M008
**Written:** 2026-03-14

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: Most changes are internal (buffer caps, timer fixes, logging) verified by artifact inspection and tests. Loading spinners require visual confirmation.

## Preconditions

- Extension built successfully (`npm run build`)
- All 89 vitest tests passing (`npx vitest run`)
- VS Code with the extension installed/loaded via F5 debug launch

## Smoke Test

Open the GSD chat panel in VS Code — it should load without errors. Send a message and receive a streamed response. No console errors in the developer tools (Ctrl+Shift+I).

## Test Cases

### 1. Shared formatting helpers work correctly

1. Run `npx vitest run src/webview/helpers.test.ts`
2. **Expected:** All 68 tests pass, including edge cases for empty input, malformed markdown, and date formatting

### 2. RPC buffer cap prevents OOM

1. Open `src/extension/rpc-client.ts`
2. Locate `MAX_BUFFER_SIZE` constant
3. Verify it is set to `10 * 1024 * 1024` (10MB)
4. Verify the `data` event handler checks buffer length against `MAX_BUFFER_SIZE`
5. Verify on overflow: buffer is reset to empty string (not truncated)
6. Verify a warning is emitted via `this.emit("log", ...)` with message containing "Buffer exceeded"
7. **Expected:** All conditions met — buffer is capped, reset is clean, warning is logged

### 3. Watchdog timer nonce guard

1. Open `src/extension/webview-provider.ts`
2. Search for `promptWatchdogNonce`
3. Verify nonce is incremented in `startPromptWatchdog`
4. Verify initial timeout callback checks `this.promptWatchdogNonce === nonce` before acting
5. Verify post-retry callback checks nonce before creating second timeout
6. Verify second timeout callback checks nonce before firing error
7. **Expected:** All three timer paths guard against stale nonce — no orphaned timer can affect a newer prompt

### 4. Silent catches replaced with diagnostic logging

1. Open `src/extension/rpc-client.ts`
2. Search for `catch` blocks
3. Verify `findNodeBinary` catch has `console.warn` with function name and error
4. Verify `resolveGsdWindows` catches (×2) have `console.warn`
5. Verify `parseWindowsCmdWrapper` catch has `console.warn`
6. Verify `resolveGsdUnix` catch has `console.warn`
7. Verify `forceKill` taskkill/kill catches use `this.emit("log", ...)`
8. Verify remaining silent catches have explanatory comments
9. **Expected:** No silent catches without either logging or documented rationale

### 5. Changelog loading spinner

1. Open the GSD chat panel in VS Code
2. Click the version badge in the header to trigger changelog fetch
3. **Expected:** A spinning animation appears with "Loading..." text while data is fetched
4. **Expected:** Spinner is replaced by changelog entries once data arrives

### 6. Dashboard loading spinner

1. Type `/gsd status` in the chat input and send
2. **Expected:** A spinning animation appears with "Loading dashboard..." text
3. **Expected:** Spinner is replaced by dashboard content once data arrives

## Edge Cases

### Buffer overflow during active conversation

1. This scenario is difficult to trigger manually — verify by code inspection
2. Confirm that after buffer reset, subsequent JSONL messages still parse correctly (the protocol self-recovers on the next complete line)
3. **Expected:** Buffer reset doesn't crash the extension or corrupt ongoing conversation

### Rapid prompt cycling (watchdog race)

1. Send a message, then immediately send another before the first responds
2. **Expected:** No duplicate error toasts, no stale watchdog firing for the first prompt

## Failure Signals

- vitest tests failing (especially helpers.test.ts)
- Console errors in VS Code developer tools during normal chat use
- Spinner stuck indefinitely (may indicate message routing issue, not a bug in spinner code itself)
- Duplicate "agent not responding" error messages (would indicate watchdog nonce guard not working)

## Not Proven By This UAT

- Buffer cap behavior under actual 10MB+ output — requires a deliberately misbehaving pi process
- Performance impact of diagnostic logging under heavy load
- Spinner timeout behavior (intentionally not implemented — accepted limitation)

## Notes for Tester

- T01, T02 changes were committed in a prior session (commit `9988c60`). The code is present but not new in this session.
- T05 required no code changes — spinners already existed. The test is to confirm they work, not that they were newly added.
- The watchdog nonce fix (T03) is best verified by code inspection — the race condition is timing-dependent and hard to reproduce manually.
