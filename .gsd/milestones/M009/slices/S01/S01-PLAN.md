# S01: Metrics Parser & Dashboard Enhancement

**Goal:** Dashboard shows per-phase, per-slice, per-model cost breakdowns, cost projections, and activity log when metrics.json exists; degrades gracefully to session-level stats when it doesn't.
**Demo:** Open `/gsd status` in a project with .gsd/metrics.json — see cost tables, projections, and unit history. Open in a project without metrics.json — see session-level stats as before.

## Must-Haves

- Metrics parser reads `.gsd/metrics.json` and returns typed aggregation data
- Dashboard renders per-phase cost breakdown (research, planning, execution, completion, reassessment)
- Dashboard renders per-slice cost breakdown
- Dashboard renders per-model cost breakdown
- Cost projection section when ≥2 completed slices exist
- Activity log showing completed units with timing and cost
- Graceful fallback to session-level stats when metrics.json is missing or empty
- All new sections use VS Code CSS variables for theme awareness

## Proof Level

- This slice proves: integration
- Real runtime required: yes (visual dashboard rendering)
- Human/UAT required: yes (visual review of layout)

## Verification

- `npm test` — unit tests for metrics parser (aggregation, projection, missing file handling)
- `npm run build` — clean build with no errors
- Manual: open dashboard in VS Code with a sample metrics.json, verify all sections render

## Tasks

- [x] **T01: Metrics parser module** `est:45m`
  - Why: Need to read and aggregate metrics.json data in the extension host
  - Files: `src/extension/metrics-parser.ts`, `src/extension/metrics-parser.test.ts`
  - Do: Create metrics parser that reads `.gsd/metrics.json`, defines TypeScript types matching the CLI's MetricsLedger/UnitMetrics schema, implements aggregateByPhase/aggregateBySlice/aggregateByModel/getProjectTotals/formatCostProjection. Handle missing file (return null), malformed JSON (return null), version mismatch (return null). Add unit tests covering: valid ledger parsing, aggregation correctness, projection calculation, missing file, corrupt file, empty units array.
  - Verify: `npm test -- --grep "metrics"`
  - Done when: all metrics parser tests pass, handles edge cases gracefully

- [x] **T02: Wire metrics into dashboard data and extend webview rendering** `est:1h`
  - Why: Dashboard needs the parsed metrics data to render new sections
  - Files: `src/extension/dashboard-parser.ts`, `src/extension/webview-provider.ts`, `src/webview/dashboard.ts`, `src/webview/styles.css`
  - Do: Extend `DashboardData` interface with optional `metrics` field containing phase/slice/model aggregates, totals, and projections. In webview-provider's `get_dashboard` handler, call metrics parser and merge into dashboard data. In webview dashboard.ts, add new render sections: (1) phase breakdown table with cost/tokens/duration per phase, (2) slice breakdown table, (3) model breakdown table, (4) cost projection line, (5) activity log showing last N completed units with type/id/duration/cost. Style all new sections with VS Code CSS variables. Preserve existing cost section as fallback when no metrics data exists.
  - Verify: `npm run build` clean, manual visual test with sample metrics.json
  - Done when: dashboard renders all new sections with metrics data, falls back cleanly without it

- [x] **T03: Activity log, elapsed time, and polish** `est:30m`
  - Why: Activity log and auto-mode timing complete the CLI parity; polish ensures readability
  - Files: `src/webview/dashboard.ts`, `src/webview/styles.css`, `src/extension/dashboard-parser.ts`
  - Do: Add auto-mode elapsed time display (sum of unit durations from metrics). Ensure activity log is scrollable if >10 units, shows most recent first. Add compact mode for breakdown tables when data is sparse (≤2 entries per category collapse to inline). Polish spacing, alignment, and responsive behavior within the sidebar width. Verify all sections degrade gracefully when data is partial.
  - Verify: `npm run build` clean, manual visual test at sidebar width
  - Done when: dashboard is visually polished, activity log scrolls, elapsed time shows, responsive at narrow widths

## Files Likely Touched

- `src/extension/metrics-parser.ts` (new)
- `src/extension/metrics-parser.test.ts` (new)
- `src/extension/dashboard-parser.ts`
- `src/extension/webview-provider.ts`
- `src/webview/dashboard.ts`
- `src/webview/styles.css`
- `src/shared/types.ts` (extend DashboardData)
