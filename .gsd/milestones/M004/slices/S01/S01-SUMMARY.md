---
id: S01
parent: M004
milestone: M004
provides:
  - STATE.md parser (parseGsdWorkflowState) for extracting workflow context
  - Workflow badge UI element showing live GSD phase/milestone/slice/task
  - ~30% header sizing bump across all elements
  - Responsive layout handling at narrow sidebar widths
requires: []
affects: []
key_files:
  - src/extension/state-parser.ts
  - src/shared/types.ts
  - src/extension/webview-provider.ts
  - src/webview/index.ts
  - src/webview/styles.css
key_decisions:
  - Workflow state sourced from STATE.md on disk (no RPC needed)
  - Parser returns null on missing/malformed STATE.md → badge shows "Self-directed"
  - autoMode tracked externally via setStatus events, merged into parsed state at send time
  - Phase-based CSS classes (auto, blocked, paused, complete) for contextual badge coloring
  - Full badge hidden at ≤350px (truncated breadcrumb alone not useful)
patterns_established:
  - parseActiveRef regex for "**Active X:** ID — Title" lines in STATE.md
  - refreshWorkflowState pattern reused across launch, agent_end, setStatus, and poll triggers
  - startWorkflowPolling follows same timer pattern as stats/health polling
observability_surfaces:
  - none (parser is pure read, badge is presentational)
drill_down_paths:
  - .gsd/milestones/M004/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M004/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M004/slices/S01/tasks/T03-SUMMARY.md
duration: 30m
verification_result: passed
completed_at: 2026-03-13
---

# S01: Workflow Badge + Header Sizing

**Header displays live GSD workflow state badge with ~30% larger elements across all header components.**

## What Happened

Three tasks delivered the full pipeline from disk to UI:

1. **T01 — STATE.md parser**: `parseGsdWorkflowState(cwd)` reads `.gsd/STATE.md`, extracts active milestone/slice/task refs and phase via regex. Returns null on missing/malformed files. All 13 phase values mapped. `WorkflowState` and `WorkflowStateRef` types added to shared types with `workflow_state` message type.

2. **T02 — Webview wiring**: Extension host sends workflow state to webview on launch, after `agent_end` events, on `setStatus("gsd-auto")` changes, and via 30s poll interval. `autoModeState` tracked per-session in a Map. Timer cleanup in dispose/cleanupSession/process exit.

3. **T03 — Badge UI + sizing**: Workflow badge renders breadcrumb (e.g., `M004 › S01 › T03`), phase label, and auto-mode prefix icons (⚡/▸/⏸). Header sizing bumped: badges 13px, title 16px, logo 18px, header 46px min-height, action buttons 13px/18px SVG. Badge hidden at ≤350px, truncated at ≤420px.

All three tasks were found already implemented from prior work on this branch; verification confirmed correctness.

## Verification

- `npm run build` — clean build, no errors
- TypeScript compilation clean on parser and shared types
- Parser tested against real STATE.md: extracts M004/S01 refs and phase correctly
- Parser handles missing file (ENOENT → null), `(none)` values, and missing fields gracefully
- All 13 phase values covered in phaseLabels mapping
- Workflow badge HTML element present with correct message handler
- CSS sizing values match spec targets across all header elements
- Responsive media queries confirmed at 420px and 350px breakpoints

## Deviations

None. All deliverables matched the slice plan.

## Known Limitations

- No automated test suite for the parser — verification was manual/scripted
- Workflow badge refresh depends on 30s poll; state changes between polls are delayed

## Follow-ups

None.

## Files Created/Modified

- `src/extension/state-parser.ts` — parseGsdWorkflowState parser (new file)
- `src/shared/types.ts` — WorkflowState, WorkflowStateRef types, workflow_state message
- `src/extension/webview-provider.ts` — Workflow wiring: refresh, polling, autoMode tracking, cleanup
- `src/webview/index.ts` — Workflow badge element, updateWorkflowBadge(), message handler
- `src/webview/styles.css` — Header sizing bump, workflow badge styles, responsive breakpoints

## Forward Intelligence

### What the next slice should know
- Workflow badge is purely presentational — no interaction handlers. Future slices could add click-to-navigate.
- The parser regex is simple and brittle to STATE.md format changes.

### What's fragile
- STATE.md format coupling — if the format changes (e.g., `**Active Milestone:**` wording), parser breaks silently (returns null).

### Authoritative diagnostics
- Browser DevTools in Extension Development Host → filter console for `workflow_state` messages to verify data flow.

### What assumptions changed
- Assumed T01-T03 would require implementation; all were already built and only needed verification.
