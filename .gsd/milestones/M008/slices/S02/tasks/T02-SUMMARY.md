---
id: T02
parent: S02
milestone: M008
provides:
  - shouldCollapseWithPredecessor — checks if a completed tool should merge with its DOM predecessor
  - collapseToolIntoGroup — DOM manipulation to create/expand tool groups during streaming
  - tryStreamingCollapse — wired into updateToolSegmentElement for automatic collapse on tool completion
key_files:
  - src/webview/tool-grouping.ts
  - src/webview/renderer.ts
  - src/webview/__tests__/tool-grouping.test.ts
key_decisions:
  - segmentElements map entries for collapsed tools point to the group element, not the original tool element — keeps map valid for future lookups
  - updateToolSegmentElement falls back to querySelector inside groups when segmentElements miss (handles reparented elements)
  - collectGroupToolNames uses .gsd-tool-segment[data-tool-id] selector to avoid double-counting inner .gsd-tool-block elements
patterns_established:
  - Streaming collapse uses previousElementSibling to find predecessor — no index arithmetic needed
  - Group expansion reuses same group element, updating label/count attributes in place
observability_surfaces:
  - console.debug "[gsd] Streaming collapse: created group with N tools" when new group formed
  - console.debug "[gsd] Streaming collapse: expanded group to N tools" when existing group grows
  - data-tool-group and data-tool-count attributes on group elements for DOM inspection
duration: 25min
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T02: Implement streaming DOM collapsing for tool groups

**Added post-hoc DOM collapsing so consecutive groupable tools merge into `<details>` groups during streaming as each tool completes.**

## What Happened

Added three exported functions to `tool-grouping.ts`: `shouldCollapseWithPredecessor` checks if a just-completed tool and its DOM predecessor are both complete/non-error/groupable; `collapseToolIntoGroup` either creates a new `<details>` group (reparenting both elements) or appends to an existing group (updating label and count). The `escapeHtmlBasic` helper avoids a circular dependency on `helpers.ts`.

Wired into `updateToolSegmentElement` in `renderer.ts` — after updating a tool's innerHTML, if the tool just completed, `tryStreamingCollapse` checks the preceding sibling and collapses if appropriate. The `segmentElements` map is updated so both the predecessor's and current tool's entries point to the group element, keeping future lookups valid. A fallback querySelector finds tools inside groups when the map entry doesn't match directly.

Added `@vitest-environment jsdom` to the test file since the new tests manipulate DOM nodes. 10 new tests cover: shouldCollapseWithPredecessor (6 cases — both groupable, error current, non-groupable predecessor, existing group predecessor, running current, non-tool predecessor) and collapseToolIntoGroup (4 cases — create group, expand group, reparented elements stay valid, mixed tool type labels).

## Verification

- `npx vitest run src/webview/__tests__/tool-grouping.test.ts` — 29/29 tests pass
- `npx vitest run` — 118/118 tests pass (all 5 test files)
- Slice verification: tool-grouping unit tests pass ✅, full suite passes ✅, visual verification deferred to slice completion

## Diagnostics

- `document.querySelectorAll('[data-tool-group]')` — lists all active groups in DOM
- Each group has `data-tool-count` attribute showing current tool count
- Console debug logs fire on group creation and expansion during streaming
- If collapse fails, tools remain standalone (graceful degradation)

## Deviations

- Added `@vitest-environment jsdom` directive to test file — required for DOM manipulation tests, not mentioned in plan
- Did not modify `src/webview/index.ts` — no wiring needed there; all streaming collapse logic lives in `updateToolSegmentElement` which is already called from the message handler

## Known Issues

None.

## Files Created/Modified

- `src/webview/tool-grouping.ts` — added shouldCollapseWithPredecessor, collapseToolIntoGroup, and helpers (collectGroupToolNames, collectToolNames, updateGroupLabel, escapeHtmlBasic)
- `src/webview/renderer.ts` — updated updateToolSegmentElement with collapse call, added tryStreamingCollapse, imported new functions
- `src/webview/__tests__/tool-grouping.test.ts` — added jsdom environment, 10 new streaming collapse tests
