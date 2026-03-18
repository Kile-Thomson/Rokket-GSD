# M010: gsd-pi 2.12 Feature Parity

**Vision:** Surface gsd-pi's parallel tool execution, cross-provider fallback, session resume, and graceful shutdown in the VS Code extension UI.

## Success Criteria

- Parallel tool calls display a concurrent execution indicator (badge or animation distinguishing them from sequential execution)
- Provider fallback events trigger visible toast notifications with from/to model info
- Provider restoration triggers a toast and model badge reverts
- "Resume last session" is available as a quick action from the welcome screen and slash menu
- `session_shutdown` event produces a clean "session ended" UI state (not a crash/disconnect)
- All existing tests pass; new behavior has unit test coverage

## Key Risks / Unknowns

- Parallel tool detection timing — multiple `tool_execution_start` events arriving before any `tool_execution_end` is the signal, but edge cases with single-tool messages need to not false-positive → LOW risk, straightforward state tracking

## Proof Strategy

- Parallel detection timing → retire in S01 by proving parallel badge appears only when 2+ tools are in-flight simultaneously

## Verification Classes

- Contract verification: unit tests for parallel detection, fallback event handling, resume-last logic
- Integration verification: manual test with gsd-pi 2.12.0 running parallel tools and triggering fallback
- Operational verification: none
- UAT / human verification: visual check that parallel indicator and toasts look correct

## Milestone Definition of Done

This milestone is complete only when all are true:

- All slice deliverables are complete
- New RPC events handled in message-handler.ts
- Parallel tool indicator renders correctly during concurrent tool execution
- Fallback toasts fire and model badge updates
- Resume-last works from fresh launch
- session_shutdown produces clean UI
- Success criteria re-checked against live behavior
- All tests pass (existing + new)

## Requirement Coverage

- Covers: gsd-pi 2.9–2.12 user-facing feature parity
- Leaves for later: memory UI, LSP visualization, hook config, team collaboration

## Slices

- [x] **S01: Parallel Tool Indicator & New Event Handling** `risk:medium` `depends:[]`
  > After this: parallel tool calls show a ⚡ concurrent badge, `fallback_provider_switch`/`fallback_provider_restored`/`session_shutdown` events are handled with toasts and UI updates
- [x] **S02: Resume Last Session** `risk:low` `depends:[]`
  > After this: user can resume their most recent session from the welcome screen or `/resume` slash command

## Boundary Map

### S01

Produces:
- Parallel tool detection state in `message-handler.ts` (tracking in-flight tool count)
- Fallback event handlers emitting toasts and updating model badge
- `session_shutdown` handler producing clean "session ended" state
- CSS for parallel badge indicator

Consumes:
- nothing (first slice, extends existing event handling)

### S02

Produces:
- "Resume last session" button on welcome/empty state
- `/resume` slash command entry
- `resumeLastSession()` in session-list-service.ts

Consumes:
- nothing (independent of S01, uses existing session listing infrastructure)
