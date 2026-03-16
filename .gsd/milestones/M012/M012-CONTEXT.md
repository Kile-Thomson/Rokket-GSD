# M012: gsd-pi 2.13–2.19 Feature Parity & Auto-Mode Visibility

**Gathered:** 2026-03-17
**Status:** Ready for planning

## Project Description

The VS Code extension was built against gsd-pi 2.12.0. Seven major versions have shipped since (2.13→2.19) introducing dynamic model routing, mid-execution capture, workflow visualizer, and numerous new commands. Additionally, auto-mode dispatch produces no visual feedback in the extension — the UI appears hung between task dispatches because the TUI's progress widget uses factory functions that RPC mode drops.

## Why This Milestone

Users running auto-mode see nothing during dispatch gaps. Dynamic model routing silently switches models with no visual feedback. New gsd-pi features (capture, visualize, steer, knowledge, config) aren't accessible from the extension. The extension is 7 versions behind.

## User-Visible Outcome

### When this milestone is complete, the user can:

- See real-time progress during auto-mode dispatch (current task, phase, progress bars, elapsed time, cost)
- See immediate visual feedback when dynamic model routing switches models mid-task
- Fire-and-forget thoughts during auto-mode via `/gsd capture`, see pending capture badge
- Open a workflow visualizer overlay showing progress, metrics, and completed units
- Access all new slash commands: `/gsd steer`, `/gsd knowledge`, `/gsd config`, `/gsd capture`, `/gsd visualize`

### Entry point / environment

- Entry point: VS Code extension sidebar/tab chat panel
- Environment: VS Code with gsd-pi 2.19.0 running as child process
- Live dependencies involved: gsd-pi RPC subprocess

## Completion Class

- Contract complete means: all new message types handled, events forwarded, UI renders correctly
- Integration complete means: features work end-to-end with gsd-pi 2.19.0 RPC process
- Operational complete means: no hangs, no error states, graceful degradation when events don't arrive

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Auto-mode dispatch shows live progress widget with task info, progress bar, and elapsed time
- Model routing changes are reflected in the header badge within 2 seconds
- Capture command works during auto-mode and pending count shows in dashboard
- Visualizer overlay opens with real milestone data
- All new slash commands are accessible and execute correctly
- No regressions in existing functionality

## Risks and Unknowns

- Auto-mode progress data availability — RPC mode drops factory functions for `setWidget`. We must either: (a) poll `get_state` + parse `.gsd/` files from the extension host, or (b) check if newer pi versions send string-array widget data. Risk: medium — polling is reliable but adds complexity.
- Dynamic model routing detection — `get_state` returns current model, but we only learn about changes by comparing to previous state. No explicit "model_changed" event. Risk: low — polling interval determines detection latency.

## Existing Codebase / Prior Art

- `src/extension/webview-provider.ts` — event routing, `setWidget`/`setStatus` forwarding (currently no-ops in webview)
- `src/extension/dashboard-parser.ts` — parses `.gsd/STATE.md` and `.gsd/milestones/` for dashboard data
- `src/webview/message-handler.ts` — handles `setStatus` (no-op), `setWidget` (not handled)
- `src/webview/dashboard.ts` — existing dashboard panel with progress bars
- `src/webview/slash-menu.ts` — hardcoded GSD subcommands list
- `src/shared/types.ts` — message protocol types

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- gsd-pi 2.13–2.19 user-facing feature parity
- Auto-mode UX: eliminate "hung" appearance during dispatch

## Scope

### In Scope

- Auto-mode dispatch progress widget (poll-based, extension-host-driven)
- Dynamic model routing visual feedback (model badge flash + toast)
- Mid-execution capture (`/gsd capture` + pending badge)
- Workflow visualizer overlay (progress, metrics, completed units)
- New slash commands: steer, knowledge, config, capture, visualize
- Slash menu auto-discovery refresh (remove stale hardcoded list)

### Out of Scope / Non-Goals

- Worktree UI (user explicitly not interested)
- Discord/Slack integration UI
- Token optimization profile picker (leave as `/gsd prefs`)
- Dynamic model discovery UI (model picker already works via RPC)
- Budget enforcement UI

## Technical Constraints

- No upstream RPC changes — must work with gsd-pi 2.19.0 as-is
- Widget factory functions don't work in RPC mode — must poll or parse files
- Extension host can read `.gsd/` files from disk
- Webview cannot access filesystem directly

## Integration Points

- gsd-pi RPC protocol — `get_state` for model detection, `extension_ui_request` events for setStatus/setWidget
- `.gsd/STATE.md` — workflow state parsing (existing)
- `.gsd/milestones/` — roadmap/plan parsing for progress data (existing in dashboard-parser)
- `.gsd/CAPTURES.md` — pending capture count

## Open Questions

- None — approach is clear based on existing infrastructure
