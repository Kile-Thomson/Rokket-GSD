---
id: S02
parent: M008
milestone: M008
provides:
  - groupConsecutiveTools pure grouping function
  - isGroupableTool read-only tool classifier
  - buildGroupSummaryLabel human-readable group labels
  - buildToolGroupHtml finalized render path integration
  - shouldCollapseWithPredecessor streaming predecessor check
  - collapseToolIntoGroup streaming DOM collapse
  - tryStreamingCollapse wired into updateToolSegmentElement
key_files:
  - src/webview/tool-grouping.ts
  - src/webview/renderer.ts
  - src/webview/__tests__/tool-grouping.test.ts
  - src/webview/styles.css
key_decisions:
  - Tool grouping as render-time transform — no data model changes, purely display concern
  - Only read-only tools group (Read, search, fetch, browser/mac reads, github list/view)
  - Args-aware classification for github_issues/github_prs (list/view are groupable, create/close are not)
  - Streaming collapse uses previousElementSibling — no index arithmetic
  - segmentElements map entries for collapsed tools point to group element
patterns_established:
  - GroupedSegment discriminated union for single vs group rendering
  - data-tool-group and data-tool-count DOM attributes for debugging
  - buildSegmentHtml extracted for reuse between single and group paths
observability_surfaces:
  - console.debug "[gsd] Tool grouping: N group(s)" in finalized render
  - console.debug "[gsd] Streaming collapse: created/expanded group" during streaming
  - data-tool-group and data-tool-count attributes for querySelectorAll inspection
drill_down_paths:
  - .gsd/milestones/M008/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M008/slices/S02/tasks/T02-SUMMARY.md
duration: 40min
verification_result: passed
completed_at: 2026-03-14
---

# S02: Tool Call Grouping

**Consecutive read-only tool calls collapse into expandable `<details>` summary rows in both finalized and streaming render paths.**

## What Happened

Created `tool-grouping.ts` with pure grouping logic: `isGroupableTool` classifies ~30 read-only tools via Set lookup + prefix matching (O(1)), `groupConsecutiveTools` walks segments accumulating runs of 2+ consecutive complete non-error groupable tools, and `buildGroupSummaryLabel` produces labels like "Read 3 files".

Integrated into `buildTurnHtml` (finalized path) by running a grouping pre-pass over segments and rendering groups as `<details class="gsd-tool-group">`. Extracted `buildSegmentHtml` from the inline loop for reuse.

Added streaming collapse in `updateToolSegmentElement` — when a tool completes, `tryStreamingCollapse` checks if it and its DOM predecessor are both groupable/complete. If so, creates a new `<details>` group or appends to an existing one. The `segmentElements` map stays valid by pointing collapsed entries to the group element, with fallback querySelector for reparented elements.

## Verification

- `npx vitest run src/webview/__tests__/tool-grouping.test.ts` — 29/29 tests pass (isGroupableTool classification, grouping edge cases, summary labels, streaming collapse DOM manipulation)
- `npx vitest run` — 118/118 tests pass across all 5 test files, zero regressions
- Visual verification deferred to UAT (requires extension running with multi-tool prompts)

## Deviations

- CSS went into `src/webview/styles.css` (actual file) not `src/webview/styles/chat.css` (doesn't exist)
- `src/webview/index.ts` not modified — streaming collapse wired entirely through `updateToolSegmentElement` in renderer.ts
- Added `@vitest-environment jsdom` to test file for DOM manipulation tests

## Known Limitations

- Visual verification not yet done — requires running extension with prompts that trigger multiple reads
- Groups only form from 2+ tools; a single tool always renders standalone
- Error tools always break group runs (by design)

## Follow-ups

None — S03-S06 continue independently per roadmap.

## Files Created/Modified

- `src/webview/tool-grouping.ts` — new module: isGroupableTool, groupConsecutiveTools, buildGroupSummaryLabel, shouldCollapseWithPredecessor, collapseToolIntoGroup
- `src/webview/renderer.ts` — buildSegmentHtml extracted, buildToolGroupHtml added, tryStreamingCollapse wired into updateToolSegmentElement
- `src/webview/__tests__/tool-grouping.test.ts` — 29 unit tests covering classification, grouping, labels, and streaming DOM collapse
- `src/webview/styles.css` — .gsd-tool-group styles (collapsed by default, chevron rotation)

## Forward Intelligence

### What the next slice should know
- `buildSegmentHtml` is now a reusable function in renderer.ts — use it when building HTML for individual segments
- Tool grouping is purely render-time; no changes to TurnSegment or ToolCallState types

### What's fragile
- Streaming collapse relies on `previousElementSibling` — if non-tool DOM nodes get inserted between tool elements during streaming, collapse won't trigger (graceful degradation, not a crash)

### Authoritative diagnostics
- `document.querySelectorAll('[data-tool-group]')` in devtools — lists all active groups with data-tool-count attributes
- Console debug logs prefixed `[gsd]` fire on group creation/expansion

### What assumptions changed
- Plan assumed index.ts would need modification for streaming — all wiring fit into renderer.ts's existing updateToolSegmentElement
