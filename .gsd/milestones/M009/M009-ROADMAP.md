# M009: Dashboard Metrics & CLI Parity

**Vision:** Give users full cost and progress visibility during auto-mode runs, matching the CLI dashboard's metrics capabilities.

## Success Criteria

- Dashboard displays per-phase, per-slice, and per-model cost breakdowns when metrics.json exists
- Cost projections shown for remaining slices based on completed work
- Activity log shows completed units with timing
- Dashboard degrades gracefully to session-level stats when no metrics.json exists
- Session shutdown event produces clean UI transition (no stale streaming state)

## Key Risks / Unknowns

- metrics.json format stability — low risk, we control both sides and can handle schema evolution

## Proof Strategy

- metrics.json parsing → retire in S01 by proving dashboard renders real metrics data
- Graceful degradation → retire in S01 by proving dashboard still works without metrics.json

## Verification Classes

- Contract verification: unit tests for metrics parser, manual dashboard inspection
- Integration verification: dashboard renders correctly with real auto-mode metrics.json
- Operational verification: none
- UAT / human verification: visual review of dashboard layout and data accuracy

## Milestone Definition of Done

This milestone is complete only when all are true:

- Dashboard renders full metrics breakdown from metrics.json
- Cost projections calculate and display correctly
- Activity log shows unit history
- Session shutdown handled cleanly
- RPC plumbing for steering/follow-up modes wired
- All existing dashboard functionality preserved
- Success criteria re-checked against live behavior

## Slices

- [x] **S01: Metrics Parser & Dashboard Enhancement** `risk:medium` `depends:[]`
  > After this: dashboard shows per-phase, per-slice, per-model cost breakdowns, projections, and activity log when metrics.json exists; degrades to session stats when it doesn't
- [x] **S02: RPC Protocol Gaps** `risk:low` `depends:[]`
  > After this: session_shutdown event handled cleanly, set_follow_up_mode and set_steering_mode wired through RPC client

## Boundary Map

### S01

Produces:
- `MetricsLedger` / `UnitMetrics` TypeScript types in dashboard-parser or new metrics module
- Extended `DashboardData` interface with metrics breakdown fields
- New webview dashboard sections (phase, slice, model breakdowns + projections + activity log)

Consumes:
- nothing (first slice)

### S02

Produces:
- `session_shutdown` event handler in webview-provider
- `setFollowUpMode()` and `setSteeringMode()` methods on RPC client

Consumes:
- nothing (independent of S01)
