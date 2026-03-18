---
id: S01
parent: M009
milestone: M009
provides:
  - Metrics parser module with typed aggregation
  - Dashboard metrics rendering (phase/slice/model breakdowns, projections, activity log)
  - DashboardMetrics type on DashboardData interface
requires: []
affects:
  - S02
key_files:
  - src/extension/metrics-parser.ts
  - src/extension/metrics-parser.test.ts
  - src/webview/dashboard.ts
  - src/webview/styles.css
  - src/shared/types.ts
  - src/extension/webview-provider.ts
key_decisions:
  - Metrics parser mirrors CLI types exactly rather than importing them
  - Dashboard shows metrics sections when metrics.json exists, falls back to session stats when it doesn't
  - Breakdown tables collapse to inline format when ≤2 entries (compact mode)
patterns_established:
  - loadMetricsLedger returns null for missing/corrupt/wrong-version files
  - buildMetricsData computes all aggregations in one call for dashboard consumption
observability_surfaces:
  - Dashboard metrics sections show cost/token/duration breakdowns
drill_down_paths: []
duration: ~30m
verification_result: passed
completed_at: 2026-03-15
---

# S01: Metrics Parser & Dashboard Enhancement

**Dashboard renders per-phase, per-slice, per-model cost breakdowns with projections and activity log from .gsd/metrics.json; falls back to session stats when absent.**

## What Happened

T01 (metrics parser) was already implemented with 35 passing tests covering aggregation, projection, file I/O edge cases, and formatting. T02 extended DashboardData with an optional `metrics` field, wired `loadMetricsLedger` + `buildMetricsData` into the webview-provider's `get_dashboard` handler, and added full metrics rendering in the webview (summary totals, phase/slice/model breakdown tables, cost projection, activity log). T03 added explicit elapsed time display, responsive layout tweaks, and verified graceful degradation.

## Verification

- `npx vitest run src/extension/metrics-parser.test.ts` — 35/35 tests pass
- `npm run build` — clean build, no errors
- Full test suite: 170/175 pass (5 failures are pre-existing EBUSY flakes on Windows/Dropbox unrelated to this work)

## Deviations

None.

## Known Limitations

- Visual/UAT verification pending — requires loading extension in VS Code with a real metrics.json
- Activity log shows raw unit types (e.g. "execute task") — no mapping to friendly names beyond capitalize

## Follow-ups

- S02: Wire session_shutdown, set_follow_up_mode, set_steering_mode RPC methods

## Files Created/Modified

- `src/extension/metrics-parser.ts` — metrics parser (already existed, unchanged)
- `src/extension/metrics-parser.test.ts` — 35 unit tests (already existed, unchanged)
- `src/shared/types.ts` — added DashboardMetrics interface and metrics field on DashboardData
- `src/extension/webview-provider.ts` — wire loadMetricsLedger + buildMetricsData into get_dashboard handler
- `src/webview/dashboard.ts` — metricsSection, breakdownTable, activity log, formatting helpers
- `src/webview/styles.css` — metrics table, projection, activity log styles

## Forward Intelligence

### What the next slice should know
- S02 is independent of S01 — RPC wiring work doesn't touch metrics at all

### What's fragile
- The DashboardMetrics type duplicates metric-parser types inline — if the parser types change, the shared type needs manual sync

### Authoritative diagnostics
- `npx vitest run src/extension/metrics-parser.test.ts` — comprehensive coverage of parser edge cases

### What assumptions changed
- T01 was already complete when this slice started — metrics parser existed with full test coverage
