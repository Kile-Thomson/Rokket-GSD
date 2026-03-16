# M010: gsd-pi 2.12 Feature Parity

**Gathered:** 2026-03-15
**Status:** Ready for planning

## Project Description

Rokket GSD is a VS Code extension wrapping gsd-pi into a native chat panel. gsd-pi has shipped significant features from 2.9.0 to 2.12.0 that our extension doesn't yet surface or handle.

## Why This Milestone

gsd-pi jumped from 2.8.3 to 2.12.0 with parallel tool execution, cross-provider model fallback, session resume (`--continue`), and new RPC events. Our extension currently ignores these — users miss parallel tool activity indicators, get no feedback when models auto-switch on rate limits, and can't quickly resume their last session.

## User-Visible Outcome

### When this milestone is complete, the user can:

- See when tools execute in parallel vs sequentially (visual indicator on concurrent tool calls)
- Get notified when gsd-pi auto-switches to a fallback provider due to rate limits, and see when the original provider recovers
- Resume their most recent session with one click (no digging through session history)
- See `session_shutdown` handled gracefully instead of as an unexpected disconnect

### Entry point / environment

- Entry point: VS Code extension sidebar / editor tab
- Environment: local dev (VS Code)
- Live dependencies involved: gsd-pi RPC subprocess (stdin/stdout JSONL)

## Completion Class

- Contract complete means: new RPC events are handled, UI elements render correctly, unit tests pass
- Integration complete means: extension correctly surfaces parallel tools / fallback events from a real gsd-pi 2.12.0 session
- Operational complete means: none

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Parallel tool calls from gsd-pi 2.12.0 render with a concurrent execution indicator in the chat UI
- Provider fallback events show a toast notification and the model badge updates
- "Resume last session" works from a fresh extension launch
- All existing tests continue to pass, new behavior has test coverage

## Risks and Unknowns

- Parallel tool event shape — need to confirm how `tool_execution_start` events interleave when tools run concurrently (RESOLVED: same events, just concurrent resolution)
- `fallback_provider_switch` / `fallback_provider_restored` events — new event types not in our handler (LOW: straightforward to add)

## Existing Codebase / Prior Art

- `src/webview/message-handler.ts` — handles all RPC events, needs new cases for fallback events and session_shutdown
- `src/webview/tool-grouping.ts` — groups consecutive read-only tools, needs parallel-awareness
- `src/webview/renderer.ts` — renders tool segments, needs parallel indicator
- `src/webview/toasts.ts` — toast notification system, used for fallback alerts
- `src/webview/slash-menu.ts` — slash commands, already has /thinking
- `src/extension/webview-provider.ts` — event routing, status bar updates
- `src/extension/session-list-service.ts` — session listing, base for resume-last

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Scope

### In Scope

- Parallel tool execution indicator (visual badge/animation when multiple tools run concurrently)
- Cross-provider fallback notifications (toast on switch, toast on restore, model badge update)
- `session_shutdown` event handling (graceful UI update)
- "Resume last session" quick action
- Handle `fallback_provider_switch` and `fallback_provider_restored` RPC events

### Out of Scope / Non-Goals

- Memory extraction UI (no RPC surface exposed yet — internal to gsd-pi)
- LSP tool visualization (tool calls already render generically)
- Hook system configuration UI
- Team collaboration features
- Ollama Cloud provider setup

## Technical Constraints

- Must work with gsd-pi 2.8.x through 2.12.x (graceful degradation for older versions)
- No new npm dependencies — vanilla DOM only
- Must not break existing tool grouping behavior

## Integration Points

- gsd-pi RPC protocol — new event types: `fallback_provider_switch`, `fallback_provider_restored`, `session_shutdown`
- gsd-pi tool execution — parallel `tool_execution_start` events arriving before prior tools complete

## Open Questions

- None — RPC types and event shapes confirmed from gsd-pi 2.12.0 source
