---
id: M009
provides:
  - Metrics dashboard with per-phase/slice/model cost breakdowns
  - Cost projections from completed slice averages
  - Activity log of completed auto-mode units
  - Clean exit vs crash process status distinction
key_decisions:
  - Metrics parser mirrors CLI types locally rather than importing
  - set_follow_up_mode/set_steering_mode deferred — CLI doesn't expose these RPC methods
  - session_shutdown is internal to CLI, not an RPC event — no handler needed
patterns_established:
  - loadMetricsLedger returns null for all error cases (missing, corrupt, wrong version)
  - buildMetricsData computes all aggregations in one call
  - Breakdown tables collapse to inline when ≤2 entries
observability_surfaces:
  - Dashboard metrics sections with cost/token/duration breakdowns
  - Process status correctly distinguishes stopped vs crashed
duration: ~40m
verification_result: passed
completed_at: 2026-03-15
---

# M009: Dashboard Metrics & CLI Parity

**Dashboard renders per-phase, per-slice, per-model cost breakdowns with projections and activity log from metrics.json; process exit status now correctly distinguishes clean shutdown from crash.**

## What Happened

S01 added the metrics parser (which was already implemented with 35 tests from a prior session) and wired it into the dashboard. The webview-provider loads `.gsd/metrics.json`, builds aggregated metrics data, and passes it to the webview. The dashboard renders phase/slice/model breakdown tables, cost projections, a scrollable activity log, and elapsed time — all styled with VS Code CSS variables and responsive at sidebar widths. When metrics.json is absent, the dashboard falls back to session-level stats.

S02 investigated the CLI source and discovered that `set_follow_up_mode`/`set_steering_mode` don't exist as RPC methods, and `session_shutdown` is an internal CLI event. The one real fix was correcting the process exit handler to distinguish clean exits (code 0, SIGTERM, SIGKILL → "stopped") from crashes ("crashed").

## Cross-Slice Verification

- ✅ Dashboard displays per-phase, per-slice, per-model cost breakdowns — verified by build + parser tests (35/35)
- ✅ Cost projections shown for remaining slices — computeProjection tested with multiple scenarios
- ✅ Activity log shows completed units with timing — recentUnits rendered in reverse chronological order
- ✅ Dashboard degrades to session stats without metrics.json — ternary fallback in template
- ✅ Session shutdown produces clean UI transition — clean exit now sends "stopped" status
- ⚠ RPC plumbing for steering/follow-up modes — deferred, CLI doesn't expose them yet

## Forward Intelligence

### What the next milestone should know
- The DashboardMetrics type in shared/types.ts duplicates metrics-parser types inline — if parser types change, sync manually

### What's fragile
- metrics.json format coupling — the extension parser assumes version 1 schema matching the CLI exactly

### Authoritative diagnostics
- `npx vitest run src/extension/metrics-parser.test.ts` — 35 tests covering all parser edge cases

### What assumptions changed
- Assumed CLI had set_follow_up_mode/set_steering_mode RPC methods — it doesn't, deferred
- Assumed session_shutdown was an RPC event — it's internal to CLI extension system

## Files Created/Modified

- `src/extension/metrics-parser.ts` — metrics parser with types, aggregation, file I/O
- `src/extension/metrics-parser.test.ts` — 35 unit tests
- `src/shared/types.ts` — DashboardMetrics interface, metrics field on DashboardData
- `src/extension/webview-provider.ts` — metrics wiring in get_dashboard, clean exit detection
- `src/webview/dashboard.ts` — metricsSection, breakdownTable, activity log rendering
- `src/webview/styles.css` — metrics table, projection, activity log styles
