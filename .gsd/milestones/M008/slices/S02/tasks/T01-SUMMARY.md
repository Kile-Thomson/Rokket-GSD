---
id: T01
parent: S02
milestone: M008
provides:
  - isGroupableTool classification function
  - groupConsecutiveTools grouping logic
  - buildGroupSummaryLabel for human-readable labels
  - buildToolGroupHtml renderer integration
  - gsd-tool-group CSS styles
key_files:
  - src/webview/tool-grouping.ts
  - src/webview/renderer.ts
  - src/webview/__tests__/tool-grouping.test.ts
  - src/webview/styles.css
key_decisions:
  - Tool grouping args-aware for github_issues/github_prs (list/view/diff/files/checks are read-only, create/close are not)
  - Extracted buildSegmentHtml from inline loop in buildTurnHtml for reuse between single and group rendering
patterns_established:
  - GroupedSegment discriminated union type for single vs group rendering
  - data-tool-group DOM attribute for debugging grouped tools
observability_surfaces:
  - console.debug "[gsd] Tool grouping" log when groups form in buildTurnHtml
  - data-tool-group attribute on <details> elements for querySelectorAll inspection
duration: 15min
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T01: Implement groupConsecutiveTools and integrate into finalized render path

**Built pure tool grouping logic and wired it into buildTurnHtml so consecutive read-only tool calls collapse into a single `<details>` row.**

## What Happened

Created `tool-grouping.ts` with three exports: `isGroupableTool` (Set + prefix matching for O(1) classification), `groupConsecutiveTools` (linear walk accumulating runs of complete non-error groupable tools, flushing groups of 2+), and `buildGroupSummaryLabel` (friendly labels like "Read 3 files").

In `renderer.ts`, extracted a new `buildSegmentHtml` helper from the inline loop, added `buildToolGroupHtml` that wraps grouped tools in a `<details class="gsd-tool-group">` with summary label, and replaced direct segment iteration in `buildTurnHtml` with `groupConsecutiveTools()` output.

Added CSS for `.gsd-tool-group` matching the existing thinking block pattern — collapsed by default, with chevron rotation on open.

## Verification

- `npx vitest run src/webview/__tests__/tool-grouping.test.ts` — 19 tests pass (isGroupableTool classification, grouping edge cases, summary labels)
- `npx vitest run` — all 108 tests pass, zero regressions
- Visual verification deferred to T02/T03 (streaming integration needed for live demo)

## Diagnostics

- `document.querySelectorAll('[data-tool-group]')` — lists all grouped tool blocks in DOM
- Console debug log `[gsd] Tool grouping: N group(s)` fires when grouping occurs in finalized turns
- Error/running tools always render standalone — never hidden in groups

## Deviations

- CSS went into `src/webview/styles.css` (the actual CSS file) rather than `src/webview/styles/chat.css` (which doesn't exist in this project)

## Known Issues

None

## Files Created/Modified

- `src/webview/tool-grouping.ts` — new module with isGroupableTool, groupConsecutiveTools, buildGroupSummaryLabel
- `src/webview/renderer.ts` — added buildSegmentHtml, buildToolGroupHtml, wired grouping into buildTurnHtml
- `src/webview/__tests__/tool-grouping.test.ts` — 19 unit tests covering all edge cases
- `src/webview/styles.css` — added .gsd-tool-group styles
- `.gsd/milestones/M008/slices/S02/tasks/T01-PLAN.md` — added Observability Impact section
