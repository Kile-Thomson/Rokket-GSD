# S01: Parallel Tool Indicator & New Event Handling

**Goal:** Surface parallel tool execution visually and handle new gsd-pi 2.9–2.12 RPC events (fallback provider switch/restore, session_shutdown).
**Demo:** When gsd-pi runs multiple tools concurrently, each shows a ⚡ parallel badge. When rate limits trigger a provider switch, a toast appears. When a session shuts down cleanly, the UI shows "session ended" instead of a crash state.

## Must-Haves

- Parallel tool detection (count in-flight tools, badge when ≥2 concurrent)
- `fallback_provider_switch` event → toast + model badge update
- `fallback_provider_restored` event → toast + model badge revert
- `session_shutdown` event → clean end state
- Unit tests for parallel detection and event handling
- Backward compatible with gsd-pi <2.12 (no parallel badge, no fallback events — just no-ops)

## Verification

- `npm test` passes with new tests for parallel detection and fallback event handling
- `npm run lint` passes
- `npm run build` succeeds

## Tasks

- [ ] **T01: Parallel tool detection + indicator** `est:1h`
  - Why: Users can't tell when tools run concurrently vs sequentially — the UI looks identical
  - Files: `src/webview/message-handler.ts`, `src/webview/renderer.ts`, `src/webview/state.ts`, `src/webview/styles.css`
  - Do: Track in-flight tool count in state. When a `tool_execution_start` arrives while another tool is already in-flight, mark both as parallel. Render a "⚡ Parallel" badge on parallel tool segments. Add CSS for the badge.
  - Verify: `npm run build` succeeds, visual inspection confirms badge appears only on concurrent tools
  - Done when: parallel tools display the badge, sequential tools don't

- [ ] **T02: Provider fallback + session_shutdown events** `est:45m`
  - Why: gsd-pi 2.11+ emits `fallback_provider_switch` and `fallback_provider_restored` when rate limits hit. `session_shutdown` is emitted on clean exit. None are handled.
  - Files: `src/webview/message-handler.ts`, `src/webview/toasts.ts`, `src/webview/state.ts`, `src/extension/webview-provider.ts`
  - Do: Add cases in message-handler for `fallback_provider_switch` (show warning toast with from→to info, update model display), `fallback_provider_restored` (show info toast, revert model display), and `session_shutdown` (set clean ended state, show "Session ended" message). Update status bar model on fallback.
  - Verify: `npm run build` succeeds
  - Done when: all three events produce appropriate UI responses

- [ ] **T03: Unit tests** `est:30m`
  - Why: Verify parallel detection logic and new event handlers
  - Files: `src/webview/__tests__/parallel-tools.test.ts`, `src/webview/__tests__/fallback-events.test.ts`
  - Do: Test parallel detection: single tool = no badge, two concurrent tools = both badged, tool ends before next starts = no badge. Test fallback event handling produces toast calls.
  - Verify: `npm test` passes, `npm run lint` passes
  - Done when: all new tests pass, no regressions

## Files Likely Touched

- `src/webview/message-handler.ts`
- `src/webview/renderer.ts`
- `src/webview/state.ts`
- `src/webview/styles.css`
- `src/webview/toasts.ts`
- `src/extension/webview-provider.ts`
- `src/webview/__tests__/parallel-tools.test.ts`
- `src/webview/__tests__/fallback-events.test.ts`
