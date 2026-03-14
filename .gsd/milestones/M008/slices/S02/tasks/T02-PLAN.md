---
estimated_steps: 5
estimated_files: 5
---

# T02: Implement streaming DOM collapsing for tool groups

**Slice:** S02 — Tool call grouping
**Milestone:** M008

## Description

The streaming render path appends tool segments one at a time as they arrive. This task adds post-hoc DOM collapsing: when a tool completes and its predecessor is a completed groupable tool, merge them into a `<details>` group element (or expand an existing group). This is the high-risk part — DOM manipulation during streaming with the `segmentElements` map.

## Steps

1. Add `collapseToolIntoGroup(completedEl, previousEl, turn)` to `tool-grouping.ts`. Given a just-completed tool element and its DOM predecessor, determine if they should group. If predecessor is a standalone groupable tool, create a new `<details>` group wrapper, reparent both into it, insert wrapper at predecessor's position. If predecessor is already a group `<details>`, append the new tool into the group and update the summary count.
2. Add `shouldCollapseWithPredecessor(currentToolId, previousToolIdOrGroup, turn)` helper — checks both tools are complete, non-error, and groupable. Handles the case where predecessor is a group (check all tools in group are groupable).
3. Wire into `updateToolSegmentElement` in renderer.ts: after updating a tool's DOM (marking complete), find the preceding sibling. If it's a `.gsd-tool-segment` or `.gsd-tool-group`, call collapse logic. Ensure `segmentElements` map still holds valid references (elements are reparented, not recreated).
4. Generate the group summary label dynamically — aggregate tool names (e.g., "Read 3 files", "Searched 2 queries", or "5 tool calls" for mixed). Update label when group expands.
5. Add tests for streaming scenarios: two consecutive reads collapse on second completion, third read expands existing group, error tool doesn't collapse, non-groupable tool between groupable ones stays separate. Verify `segmentElements` entries remain valid after reparenting.

## Must-Haves

- [ ] Completed groupable tools collapse with groupable predecessors during streaming
- [ ] Existing groups expand when new groupable tools complete adjacently
- [ ] `segmentElements` map remains valid after DOM reparenting
- [ ] `updateToolSegmentElement` still finds and updates tools inside groups
- [ ] Error tools and non-groupable tools never collapse
- [ ] Finalized render still works (groups rebuild correctly via T01's `buildTurnHtml`)

## Verification

- `npx vitest run` — all tests pass including new streaming collapse tests
- Visual: load extension, trigger a prompt that causes multiple consecutive Read calls, verify they collapse into a group during streaming and the group expands on click

## Observability Impact

- Signals added/changed: console.debug log when tools collapse into group during streaming (with tool count)
- How a future agent inspects this: `document.querySelectorAll('[data-tool-group]')` shows all active groups; each group has `data-tool-count` attribute
- Failure state exposed: if collapse fails, tools remain standalone (graceful degradation) — error logged to console

## Inputs

- `src/webview/tool-grouping.ts` — `isGroupableTool`, `groupConsecutiveTools` from T01
- `src/webview/renderer.ts` — `updateToolSegmentElement`, `segmentElements` map
- T01 summary for any decisions about HTML structure or data attributes

## Expected Output

- `src/webview/tool-grouping.ts` — extended with `collapseToolIntoGroup`, `shouldCollapseWithPredecessor`
- `src/webview/renderer.ts` — modified `updateToolSegmentElement` with collapse call
- `src/webview/index.ts` — any needed wiring for streaming tool completion events
- `src/webview/__tests__/tool-grouping.test.ts` — additional streaming collapse tests
