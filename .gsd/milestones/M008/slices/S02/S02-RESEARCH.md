# S02: Tool Call Grouping — Research

**Date:** 2026-03-14

## Summary

Tool call grouping is a render-time transformation over the existing segment stream. The data model (`TurnSegment[]` + `toolCalls` map) doesn't need to change — grouping is purely a display concern. Two render paths exist: **streaming** (per-element DOM append) and **finalized** (`buildTurnHtml` full rebuild). The finalized path is straightforward — group consecutive tool segments before generating HTML. The streaming path is trickier because segments arrive one at a time, but can be solved with post-hoc DOM collapsing: when a new tool completes and its predecessor is a completed tool of the same groupable category, merge them into a group element.

Cline's approach is the right model: only group "low-stakes" read-only tools (Read, search, browser reads). Mutating tools (Write, Edit, bash, bg_shell) stay ungrouped because users need to see each one. Categories already exist via `getToolCategory()` in helpers.ts.

## Recommendation

Implement a `groupConsecutiveTools()` pure function that takes `TurnSegment[]` + `toolCalls` map and returns a grouped structure (segments with group markers). Use it in `buildTurnHtml` for finalized turns. For streaming, implement post-hoc DOM collapsing: after each `tool_execution_end`, check if the completed tool and its DOM predecessor form/extend a groupable run, and merge into a `<details>` group element. This avoids buffering or lookahead during streaming.

Only group when: (1) tools are consecutive (no text/thinking between them), (2) all tools in the group are complete, (3) all tools are non-error, (4) tool names belong to the "groupable" set (read-only operations).

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Tool categorization | `getToolCategory()` in helpers.ts | Already maps tool names to categories, tested |
| Tool icon/label | `getToolIcon()` / `getToolKeyArg()` in helpers.ts | Reuse for group summary labels |
| HTML escaping | `escapeHtml()` / `escapeAttr()` in helpers.ts | Already used everywhere in renderer |

## Existing Code and Patterns

- `src/webview/renderer.ts` — Two render paths: `appendToolSegmentElement()` for streaming, `buildTurnHtml()` for finalized. Finalized path iterates `turn.segments` and builds HTML string. Streaming path creates individual `.gsd-tool-segment` divs with `data-seg-idx` and `data-tool-id`.
- `src/webview/state.ts` — `TurnSegment` is `{type:"tool", toolCallId}`. `AssistantTurn.segments` is the ordered array. `ToolCallState` has `isRunning`, `isError`, `name`, `args`.
- `src/webview/helpers.ts` — `getToolCategory()` returns file/shell/browser/search/process/agent/generic. Already tested in helpers.test.ts.
- `src/webview/index.ts:1700-1755` — Tool lifecycle: `tool_execution_start` → creates ToolCallState, pushes segment, calls `appendToolSegmentElement`. `tool_execution_end` → sets `isRunning=false`, calls `updateToolSegmentElement`.
- `src/webview/renderer.ts:145-148` — On finalization, `currentTurnElement.innerHTML = buildTurnHtml(turn)` replaces all streaming DOM with the finalized HTML. This is where grouping naturally applies.
- Thinking blocks already use `<details>/<summary>` pattern (renderer.ts:241) — reuse this pattern for tool groups.

## Constraints

- **Vanilla DOM, no framework** — grouping logic must work with raw DOM manipulation
- **Streaming renders one segment at a time** — can't look ahead; can only look back at already-rendered siblings
- **Finalized render replaces all DOM** — `buildTurnHtml` already rebuilds everything, so grouping here is clean
- **`segmentElements` map tracks DOM by segment index** — grouping in streaming must update or work alongside this map
- **Existing CSS classes** — `.gsd-tool-segment`, `.gsd-tool-block`, `.gsd-tool-header` are established patterns

## Common Pitfalls

- **Grouping running tools** — Don't group a tool that's still spinning. Only group after `tool_execution_end`. Otherwise the group summary hides the active spinner.
- **Breaking the segmentElements map** — Streaming DOM collapsing must not orphan entries in `segmentElements`. Either update the map or ensure `updateToolSegmentElement` can still find elements inside groups.
- **Text segment between tools breaks the run** — If the agent emits text between two reads, they shouldn't group. The segment array ordering handles this naturally.
- **Single-item groups** — A "group" of 1 tool is just a regular tool. Only create group wrappers for 2+ consecutive groupable tools.

## Open Risks

- **Streaming group expansion** — If tool 3 completes and tools 1-2 are already grouped, need to expand the existing group DOM node rather than create a new one. Manageable but adds complexity to the DOM manipulation.
- **Interleaved error tools** — If one tool in a potential group errors, the group should not form (or should exclude the error). Simplest: any error breaks the group run.
- **updateToolSegmentElement during streaming** — Currently finds element by `data-tool-id` via linear scan of `segmentElements`. After grouping, tool elements are nested inside a group wrapper. The scan still works since it checks `el.dataset.toolId` on each entry, but the grouped DOM structure is different. Need to verify the update path works when tools are inside a group container.

## Groupable Tool Classification

Based on Cline's "low-stakes" principle and existing categories:

| Groupable (read-only) | Not Groupable (mutating/important) |
|---|---|
| Read | Write, Edit |
| search-the-web, search_and_read, fetch_page, google_search | bash, bg_shell |
| resolve_library, get_library_docs | subagent |
| browser_find, browser_screenshot, browser_get_* | browser_click, browser_type, browser_navigate |
| mac_find, mac_get_tree, mac_read, mac_screenshot, mac_list_* | mac_click, mac_type, mac_launch_app |
| github_issues (list/view), github_prs (list/view/diff/files/checks) | github_issues (create/update/close), github_prs (create/update) |

Simplification for v1: group by category where the category is inherently read-only (`file` when name is `read`, `search`), and leave everything else ungrouped. Can refine later.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| VS Code Extension | — | none found (niche domain) |

## Sources

- Cline tool grouping pattern (from M008-RESEARCH.md competitive analysis)
- Existing `<details>/<summary>` pattern in thinking blocks (renderer.ts:241-248)
