---
estimated_steps: 5
estimated_files: 5
---

# T01: Implement groupConsecutiveTools and integrate into finalized render path

**Slice:** S02 — Tool call grouping
**Milestone:** M008

## Description

Build the pure grouping logic and integrate it into `buildTurnHtml`, the finalized render path that rebuilds all DOM when a turn completes. This is the clean starting point — no DOM manipulation complexity, just segment analysis and HTML generation.

## Steps

1. Create `src/webview/tool-grouping.ts` with `isGroupableTool(name: string): boolean` — returns true for read-only tools (Read, search-the-web, search_and_read, fetch_page, google_search, resolve_library, get_library_docs, browser_find, browser_screenshot, browser_get_*, mac_find, mac_get_tree, mac_read, mac_screenshot, mac_list_*, github_issues with list/view, github_prs with list/view/diff/files/checks). Use a Set for O(1) lookup + prefix matching for browser_get_*/mac_list_*.
2. Create `groupConsecutiveTools(segments, toolCalls)` that returns a `GroupedSegment[]` — either `{type: 'single', segment}` or `{type: 'group', segments, toolNames}`. Walk segments linearly, accumulating runs of consecutive tool segments where all tools are complete, non-error, and groupable. Flush group when run breaks or ends. Only emit group for 2+ tools.
3. Add `buildToolGroupHtml(groupedTools, toolCalls)` in renderer.ts that generates a `<details class="gsd-tool-group">` with a `<summary>` showing aggregated label (e.g., "Read 3 files") and contains individual `buildToolCallHtml` outputs inside.
4. Wire into `buildTurnHtml`: replace direct segment iteration with `groupConsecutiveTools()` output, rendering groups via `buildToolGroupHtml` and singles via existing logic.
5. Add CSS for `.gsd-tool-group` — matches existing `<details>` thinking block styling. Add tests covering: basic 3-read group, error breaks group, text between tools breaks group, single tool no wrapper, mixed groupable/non-groupable, empty segments.

## Must-Haves

- [ ] `isGroupableTool` correctly classifies read-only vs mutating tools
- [ ] `groupConsecutiveTools` produces correct groupings for all edge cases
- [ ] `buildTurnHtml` renders grouped HTML with `<details>/<summary>` wrapper
- [ ] Groups show aggregated summary (e.g., "Read 3 files")
- [ ] Single ungroupable tools render unchanged
- [ ] All existing tests pass

## Verification

- `npx vitest run src/webview/__tests__/tool-grouping.test.ts` — all new tests pass
- `npx vitest run` — all existing tests pass (no regressions)

## Inputs

- `src/webview/renderer.ts` — `buildTurnHtml` and `buildToolCallHtml` functions
- `src/webview/helpers.ts` — `getToolCategory()`, `getToolIcon()`, `getToolKeyArg()`
- `src/webview/state.ts` — `TurnSegment`, `AssistantTurn`, `ToolCallState` types

## Expected Output

- `src/webview/tool-grouping.ts` — new module with `isGroupableTool`, `groupConsecutiveTools`, exported types
- `src/webview/renderer.ts` — modified `buildTurnHtml` using grouping, new `buildToolGroupHtml`
- `src/webview/__tests__/tool-grouping.test.ts` — comprehensive unit tests
- `src/webview/styles/chat.css` — `.gsd-tool-group` styles

## Observability Impact

- **Console signal**: `buildTurnHtml` logs `[gsd] Tool grouping: N group(s) from M segments` via `console.debug` when grouping occurs, enabling runtime verification that grouping is active.
- **DOM inspection**: grouped tools render inside `<details class="gsd-tool-group" data-tool-group="N">` — queryable via `document.querySelectorAll('[data-tool-group]')` for debugging.
- **Failure visibility**: error tools (`isError: true`) and running tools (`isRunning: true`) always break groups and render standalone, ensuring errors are never hidden inside a collapsed group.
