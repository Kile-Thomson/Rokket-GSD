---
verdict: needs-attention
remediation_round: 0
---

# Milestone Validation: M009

## Success Criteria Checklist

- [x] **Dashboard displays per-phase, per-slice, and per-model cost breakdowns when metrics.json exists** — evidence: S01 summary confirms dashboard renders phase/slice/model breakdown tables via `metricsSection`, `breakdownTable` helpers in `src/webview/dashboard.ts`. 35 unit tests pass for metrics parser. Build clean.
- [x] **Cost projections shown for remaining slices based on completed work** — evidence: S01 summary confirms cost projection rendering in dashboard. `buildMetricsData` computes all aggregations including projections.
- [x] **Activity log shows completed units with timing** — evidence: S01 summary confirms activity log rendering with unit history and timing. T03 added explicit elapsed time display.
- [x] **Dashboard degrades gracefully to session-level stats when no metrics.json exists** — evidence: S01 summary confirms graceful degradation verified in T03. `loadMetricsLedger` returns null for missing/corrupt/wrong-version files. Dashboard falls back to session stats.
- [x] **Session shutdown event produces clean UI transition (no stale streaming state)** — evidence: S02 found `session_shutdown` is internal to CLI extension system, not an RPC event. However, the real issue was addressed: clean process exit (code 0, SIGTERM, SIGKILL) now produces "stopped" status instead of "crashed", preventing stale streaming state and incorrect auto-restart behavior.

## Slice Delivery Audit

| Slice | Claimed | Delivered | Status |
|-------|---------|-----------|--------|
| S01 | Dashboard shows per-phase, per-slice, per-model cost breakdowns, projections, and activity log; degrades to session stats when metrics.json absent | Metrics parser (35 tests), DashboardMetrics type on DashboardData, dashboard rendering for all breakdown sections, projections, activity log, graceful degradation | **pass** |
| S02 | session_shutdown handled cleanly, set_follow_up_mode and set_steering_mode wired through RPC client | Clean exit detection fixed (stopped vs crashed). session_shutdown found to be internal CLI event (no handler needed). set_follow_up_mode/set_steering_mode deferred — CLI doesn't expose these RPC methods yet | **pass (reduced scope)** |

## Cross-Slice Integration

- S01 and S02 are independent per boundary map — no cross-dependencies. Confirmed: S02 touches only `webview-provider.ts` exit handler, S01 touches metrics parser, shared types, dashboard renderer, and webview-provider's `get_dashboard` handler. No conflicts.
- Boundary map accuracy: S01 produces `DashboardMetrics` type, extended `DashboardData`, new webview sections — all confirmed in summary. S02 produces clean exit detection — confirmed. No mismatches.

## Requirement Coverage

No active requirements from REQUIREMENTS.md were scoped to M009 specifically. The milestone was self-contained with its own success criteria. All five success criteria are addressed.

## Verdict Rationale

**Verdict: needs-attention** (minor gaps that do not block completion)

All five success criteria are met. Both slices delivered their core value. The two items warranting attention:

1. **set_follow_up_mode / set_steering_mode deferred** — The roadmap's Definition of Done includes "RPC plumbing for steering/follow-up modes wired." S02 correctly identified these don't exist in the CLI RPC protocol yet, making implementation impossible. This is a justified scope reduction, not a delivery failure. Documented as a follow-up for when CLI adds these methods.

2. **Visual/UAT verification pending** — S01 notes that visual verification requires loading the extension in VS Code with a real metrics.json. Unit tests (35/35) and build verification passed, but no human visual review was performed. This is acceptable for a contract+unit-test milestone but worth noting.

Neither gap represents a material deficiency — the extension correctly handles all scenarios it can encounter today, and the deferred features are blocked on upstream CLI work.

## Remediation Plan

No remediation needed. The two attention items are:
- **Deferred RPC methods:** Track as future work when CLI exposes `set_follow_up_mode` / `set_steering_mode`. Already noted in S02 follow-ups.
- **Visual UAT:** Can be performed during next integration testing cycle. Not blocking.
