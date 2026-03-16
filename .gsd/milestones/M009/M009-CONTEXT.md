# M009: Dashboard Metrics & CLI Parity — Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

## Project Description

Rokket GSD is a VS Code extension wrapping the GSD AI coding agent into a native chat panel with streaming, tool visualization, model switching, and workflow automation.

## Why This Milestone

The VS Code extension's dashboard shows project structure (milestones, slices, tasks, progress bars) but lacks the cost/metrics visibility that the CLI dashboard provides. During long auto-mode runs, users can't see per-phase cost breakdowns, projections, or activity history. Additionally, a few RPC protocol features are unwired (`session_shutdown`, `set_follow_up_mode`, `set_steering_mode`).

## User-Visible Outcome

### When this milestone is complete, the user can:

- View per-unit cost breakdown by phase, slice, and model in the dashboard
- See cost projections for remaining work based on completed units
- See auto-mode elapsed time and activity log of completed units
- Observe graceful cleanup when the GSD process shuts down

### Entry point / environment

- Entry point: VS Code sidebar/tab GSD chat panel, `/gsd status` command
- Environment: VS Code extension (webview + extension host + RPC subprocess)
- Live dependencies involved: GSD RPC subprocess, `.gsd/metrics.json` on disk

## Completion Class

- Contract complete means: dashboard renders metrics data from metrics.json, session stats merge correctly, session_shutdown is handled
- Integration complete means: metrics display updates during active auto-mode runs with real cost data
- Operational complete means: none beyond integration

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Dashboard shows per-phase and per-model cost breakdown from a real metrics.json
- Cost projections render when partial milestone data exists
- Session shutdown event triggers clean UI state transition

## Risks and Unknowns

- `metrics.json` format may vary across GSD versions — need to handle missing/malformed data gracefully
- metrics.json is written by auto-mode; manual mode sessions won't have per-unit breakdowns — dashboard must degrade gracefully to session-level stats only

## Existing Codebase / Prior Art

- `src/extension/dashboard-parser.ts` — reads STATE.md, ROADMAP.md, PLAN.md to build dashboard data
- `src/webview/dashboard.ts` — renders dashboard HTML with progress bars, slice list, cost section
- `src/extension/webview-provider.ts` — merges `get_session_stats` into dashboard data at line ~937
- `src/extension/rpc-client.ts` — RPC convenience methods, missing `set_follow_up_mode`/`set_steering_mode`/`session_shutdown`
- CLI source: `gsd-pi/src/resources/extensions/gsd/metrics.ts` — defines MetricsLedger, UnitMetrics, aggregation functions

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Scope

### In Scope

- Read and parse `.gsd/metrics.json` for per-unit cost data
- Dashboard sections: per-phase breakdown, per-slice breakdown, per-model breakdown
- Cost projections based on completed vs remaining slices
- Auto-mode elapsed time display
- Activity log of completed units with timing
- `session_shutdown` event handling for clean UI transitions
- Wire `set_follow_up_mode` and `set_steering_mode` RPC methods (plumbing only, no UI settings panel)

### Out of Scope / Non-Goals

- Fork conversation feature (decided to skip)
- Worktree command (CLI-specific, doesn't map to VS Code)
- Voice command (CLI/macOS specific)
- Budget ceiling UI (nice-to-have, defer)
- Settings panel for steering/follow-up modes (just wire the RPC, no UI yet)

## Technical Constraints

- Must handle missing metrics.json gracefully (show session-level stats only)
- Must handle partial/in-progress metrics.json (auto-mode may be mid-write)
- Dashboard parser runs in extension host (Node), rendering in webview (browser)
- All styling must use VS Code CSS variables for theme awareness

## Integration Points

- `.gsd/metrics.json` — filesystem read, parsed in extension host
- GSD RPC subprocess — `get_session_stats`, `session_shutdown` event
- Webview message protocol — new/extended message types for metrics data

## Open Questions

- None — metrics.json format is visible in CLI source, RPC protocol is known
