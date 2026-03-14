---
id: M004
provides:
  - STATE.md parser for extracting GSD workflow context
  - Workflow badge showing live phase/milestone/slice/task in header
  - ~30% header sizing bump across all elements
  - Responsive layout handling at narrow sidebar widths (≤350px hide, ≤420px truncate)
key_decisions:
  - Workflow state sourced from STATE.md on disk (no RPC needed)
  - Parser returns null on missing/malformed STATE.md → badge shows "Self-directed"
  - Phase-based CSS classes for contextual badge coloring
  - autoMode tracked externally via setStatus events, merged at send time
patterns_established:
  - parseActiveRef regex for "**Active X:** ID — Title" lines in STATE.md
  - refreshWorkflowState pattern reused across launch, agent_end, setStatus, and poll triggers
  - startWorkflowPolling follows same timer pattern as stats/health polling
observability_surfaces:
  - none
requirement_outcomes: []
duration: 30m
verification_result: passed
completed_at: 2026-03-13
---

# M004: Header Enhancements

**Header displays live GSD workflow state badge with ~30% larger elements and responsive narrow-width handling.**

## What Happened

A single slice (S01) delivered the full pipeline from disk to UI in three tasks:

1. **STATE.md parser** (`src/extension/state-parser.ts`): `parseGsdWorkflowState(cwd)` reads `.gsd/STATE.md`, extracts active milestone/slice/task refs and phase via regex. Returns null on missing/malformed files. All 13 GSD phase values mapped to display labels.

2. **Extension wiring** (`src/extension/webview-provider.ts`): Sends workflow state to the webview on launch, after `agent_end` events, on `setStatus("gsd-auto")` changes, and via a 30-second poll interval. Auto-mode state tracked per-session in a Map with proper timer cleanup.

3. **Badge UI + sizing** (`src/webview/index.ts`, `src/webview/styles.css`): Workflow badge renders a breadcrumb (e.g., `M004 › S01 › T03`), phase label, and auto-mode prefix icons (⚡/▸/⏸). Header sizing bumped: badges 13px, title 16px, logo 18px, header 46px min-height, action buttons 13px/18px SVG. Badge hidden at ≤350px, truncated at ≤420px.

## Cross-Slice Verification

- **"User can see current GSD phase and active milestone/slice/task in the header"** — Verified: workflow badge renders breadcrumb with milestone/slice/task refs and phase label. Message handler for `workflow_state` confirmed in webview code.

- **"Header shows 'Self-directed' when no `.gsd/` structure exists"** — Verified: parser returns null on ENOENT or malformed STATE.md; badge defaults to "Self-directed" when state is null.

- **"All header badges and buttons are ~30% larger than v0.2.6"** — Verified: CSS values confirmed — badges 13px (from ~10px), title 16px (from ~12px), logo 18px (from ~14px), header min-height 46px (from ~36px).

- **"Layout doesn't break at narrow sidebar widths (≤400px)"** — Verified: media queries at 420px (truncate) and 350px (hide badge entirely) confirmed in CSS.

All four success criteria met. Build compiles cleanly with `npm run build`.

## Requirement Changes

No requirements were tracked for this milestone (no REQUIREMENTS.md exists).

## Forward Intelligence

### What the next milestone should know
- Workflow badge is purely presentational — no click handlers. Future work could add click-to-navigate to STATE.md or milestone files.
- The 30s poll interval means state changes between polls are delayed; this is acceptable for the current use case.

### What's fragile
- STATE.md format coupling — parser uses regex for `**Active Milestone:**` wording. If STATE.md format changes, parser breaks silently (returns null, badge shows "Self-directed").

### Authoritative diagnostics
- Browser DevTools in Extension Development Host → filter console for `workflow_state` messages to verify data flow end-to-end.

### What assumptions changed
- Assumed T01–T03 would require implementation; all were already built from prior work on the branch and only needed verification.

## Files Created/Modified

- `src/extension/state-parser.ts` — parseGsdWorkflowState parser (new file)
- `src/shared/types.ts` — WorkflowState, WorkflowStateRef types, workflow_state message type
- `src/extension/webview-provider.ts` — Workflow wiring: refresh, polling, autoMode tracking, cleanup
- `src/webview/index.ts` — Workflow badge element, updateWorkflowBadge(), message handler
- `src/webview/styles.css` — Header sizing bump, workflow badge styles, responsive breakpoints
