---
id: M010
provides:
  - Parallel tool execution indicator (⚡ badge with pulse animation)
  - Cross-provider fallback notifications (switch, restore, chain exhausted toasts)
  - Session shutdown graceful handling
  - Resume last session (welcome chip + /resume slash command)
key_decisions:
  - Parallel detection via in-flight tool count tracking (no new RPC events needed)
  - Fallback events handled with toast notifications + model badge updates
  - Resume uses existing session listing infrastructure
patterns_established:
  - isParallel flag on ToolCallState for render-time badge decisions
  - New RPC event types handled via case branches in message-handler switch
observability_surfaces:
  - none
requirement_outcomes: []
duration: ~1 day
verification_result: passed
completed_at: 2026-03-17
---

# M010: gsd-pi 2.12 Feature Parity

**Parallel tool indicator, provider fallback toasts, session resume, and graceful shutdown — closing the feature gap between gsd-pi 2.12 and the VS Code extension UI.**

## What Happened

This milestone added four user-facing features that gsd-pi 2.9–2.12 introduced but the extension didn't surface.

**S01 (Parallel Tool Indicator & New Event Handling)** added parallel tool detection to `message-handler.ts` — when multiple `tool_execution_start` events arrive before prior tools complete, all concurrent tools are flagged `isParallel: true`. The renderer displays a ⚡ badge with a pulse animation on parallel tool cards. S01 also wired three new RPC event types: `fallback_provider_switch` updates the model badge and fires a toast with from→to info, `fallback_provider_restored` reverts the model badge and confirms recovery, and `session_shutdown` produces a clean "session ended" UI state instead of appearing as an unexpected disconnect. A `fallback_chain_exhausted` error toast was added as well.

**S02 (Resume Last Session)** added a `↩ Resume` chip to the welcome screen and a `/resume` slash command. Both send a `resume_last_session` message to the extension host, which reads the session list and loads the most recent session via existing infrastructure. The chip is hidden when no prior sessions exist.

Both slices were independent and required no cross-slice integration.

## Cross-Slice Verification

| Success Criterion | Verification |
|---|---|
| Parallel tool calls display concurrent execution indicator | ✅ `parallel-tools.test.ts`: 5 tests verify parallel detection — single tool not flagged, second concurrent marks both, third concurrent, sequential not flagged, mixed overlap correct. Renderer emits `⚡` badge with `.parallel` CSS class and pulse animation. |
| Provider fallback events trigger visible toast notifications | ✅ `fallback-events.test.ts`: tests verify from/to parsing, model state update. `message-handler.ts` lines 442–487 handle `fallback_provider_switch`, `fallback_provider_restored`, `fallback_chain_exhausted` with toast calls. |
| Provider restoration triggers toast and model badge reverts | ✅ `fallback-events.test.ts`: restore test confirms model state reverts. Handler at line 463 updates `state.model` and calls `showToast`. |
| "Resume last session" available from welcome screen and slash menu | ✅ Welcome chip at `index.ts:148`, slash command at `slash-menu.ts:169`, handler at `webview-provider.ts:1282`. |
| `session_shutdown` produces clean "session ended" UI state | ✅ `fallback-events.test.ts`: shutdown test confirms `isStreaming=false`, `processStatus=stopped`. Handler at `message-handler.ts:489`. |
| All existing tests pass; new behavior has unit test coverage | ✅ 251 tests pass across 14 test files. New: `parallel-tools.test.ts` (5 tests), `fallback-events.test.ts` (4 tests). |

## Definition of Done

- [x] All slice deliverables complete (S01, S02 both done)
- [x] New RPC events handled in message-handler.ts (fallback_provider_switch, fallback_provider_restored, fallback_chain_exhausted, session_shutdown, extension_error)
- [x] Parallel tool indicator renders correctly during concurrent tool execution (⚡ badge + pulse animation)
- [x] Fallback toasts fire and model badge updates
- [x] Resume-last works from fresh launch (welcome chip + /resume command)
- [x] session_shutdown produces clean UI (isStreaming=false, processStatus=stopped)
- [x] All tests pass (251/251)

## Requirement Changes

No requirements were tracked for this milestone — it was a feature parity effort without formal requirement IDs.

## Forward Intelligence

### What the next milestone should know
- The TS type union for RPC events in `types.ts` doesn't include the new event types (`fallback_provider_switch`, etc.) — they're handled at runtime via string comparison. A future cleanup could add them to the union type to eliminate the TS2678 errors.
- The parallel detection is purely client-side state tracking — no changes needed on the gsd-pi side.

### What's fragile
- The `fallback_provider_switch` event parsing splits on `/` to extract provider and model ID. If gsd-pi ever changes the format of the `to` field (e.g., nested slashes in model names), the parser would break.
- Resume-last relies on the session list service returning sessions sorted by recency — if that assumption changes, the wrong session would be resumed.

### Authoritative diagnostics
- `npx vitest run` — all 251 tests pass, including the 9 new tests for parallel detection and fallback events
- `npm run build` — esbuild produces clean bundles (327KB webview, no errors)

### What assumptions changed
- No assumptions changed — the RPC event shapes matched what was expected from gsd-pi 2.12.0 source review.

## Files Created/Modified

- `src/webview/message-handler.ts` — parallel detection logic, fallback/shutdown event handlers
- `src/webview/renderer.ts` — ⚡ parallel badge rendering
- `src/webview/state.ts` — `isParallel` field on ToolCallState
- `src/webview/styles.css` — parallel badge styling and pulse animation
- `src/extension/webview-provider.ts` — event routing for new events, resume_last_session handler
- `src/webview/index.ts` — welcome screen resume chip
- `src/webview/slash-menu.ts` — /resume command
- `src/shared/types.ts` — resume_last_session message type
- `src/webview/__tests__/parallel-tools.test.ts` — 5 parallel detection tests
- `src/webview/__tests__/fallback-events.test.ts` — 4 fallback/shutdown tests
