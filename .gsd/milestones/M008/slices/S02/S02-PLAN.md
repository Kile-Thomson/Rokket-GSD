# S02: Tool Call Grouping

**Goal:** Sequential read-only tool calls collapse into a single expandable summary row during rendering.
**Demo:** In a finalized turn with 3 consecutive `Read` calls, only one `<details>` group row appears showing "Read 3 files". During streaming, tools collapse into a group as each one completes. Expanding the group shows individual tool details.

## Must-Haves

- Pure `groupConsecutiveTools()` function that identifies groupable runs in a segment array
- Only read-only tools are groupable (Read, search-the-web, search_and_read, fetch_page, google_search, resolve_library, get_library_docs, browser read-only ops, mac read-only ops, github list/view)
- Groups require 2+ consecutive completed non-error tools of groupable type
- Any text/thinking segment between tools breaks the group
- Error tools break the group run
- Finalized path (`buildTurnHtml`) renders groups as `<details>/<summary>` with tool count
- Streaming path collapses completed tools into group DOM nodes post-hoc
- Single tools that don't form a group render normally (no wrapper)
- `updateToolSegmentElement` still works for tools nested inside group containers
- All existing 82+ tests pass

## Proof Level

- This slice proves: integration (grouping renders correctly in both render paths)
- Real runtime required: yes (visual verification in extension)
- Human/UAT required: yes (visual check of grouped tool display)

## Verification

- `npx vitest run src/webview/__tests__/tool-grouping.test.ts` — unit tests for `groupConsecutiveTools()` covering: basic grouping, error-breaks-group, text-between-tools, single-tool-no-group, mixed groupable/non-groupable
- `npx vitest run` — all existing tests still pass
- Visual: extension loads, send a prompt that triggers multiple reads, verify they collapse into a group

## Observability / Diagnostics

- Runtime signals: group count logged to console when grouping occurs in `buildTurnHtml`
- Inspection surfaces: grouped tool DOM uses `data-tool-group` attribute for easy querySelectorAll debugging
- Failure visibility: individual tool errors prevent grouping — error tools always render standalone

## Integration Closure

- Upstream surfaces consumed: `getToolCategory()`, `getToolIcon()`, `getToolKeyArg()` from helpers.ts; `TurnSegment`, `AssistantTurn`, `ToolCallState` from state.ts
- New wiring introduced in this slice: `groupConsecutiveTools()` in new `src/webview/tool-grouping.ts`, called from `buildTurnHtml` and streaming update path
- What remains before the milestone is truly usable end-to-end: S03-S06 (loading states, a11y, decomposition, integration)

## Tasks

- [x] **T01: Implement groupConsecutiveTools and integrate into finalized render path** `est:1.5h`
  - Why: The finalized render path (`buildTurnHtml`) is the clean place to start — it rebuilds all DOM from segments, so grouping is a pure pre-pass with no DOM manipulation complexity
  - Files: `src/webview/tool-grouping.ts`, `src/webview/renderer.ts`, `src/webview/helpers.ts`, `src/webview/__tests__/tool-grouping.test.ts`
  - Do: (1) Create `tool-grouping.ts` with `isGroupableTool(name)` predicate and `groupConsecutiveTools(segments, toolCalls)` that returns a structure marking group boundaries. (2) Add `buildToolGroupHtml()` that renders a `<details>/<summary>` with tool count and category icons, containing individual tool HTMLs. (3) Wire into `buildTurnHtml` — before iterating segments, run the grouping pass and render groups as collapsed `<details>`. (4) Add CSS for `.gsd-tool-group` in webview styles. (5) Write comprehensive unit tests.
  - Verify: `npx vitest run src/webview/__tests__/tool-grouping.test.ts` passes; `npx vitest run` all tests pass
  - Done when: `groupConsecutiveTools` correctly identifies groups in test cases covering all edge cases, and `buildTurnHtml` renders grouped HTML for consecutive groupable tools

- [x] **T02: Implement streaming DOM collapsing for tool groups** `est:1.5h`
  - Why: Streaming renders tools one at a time — need post-hoc DOM collapsing so groups form as tools complete, which is the high-risk part of this slice
  - Files: `src/webview/tool-grouping.ts`, `src/webview/renderer.ts`, `src/webview/index.ts`, `src/webview/__tests__/tool-grouping.test.ts`
  - Do: (1) Add `collapseToolIntoGroup(completedToolEl, segIdx, turn)` that checks if the just-completed tool and its DOM predecessor form/extend a groupable run. If yes, wrap them in a `<details>` group or append to existing group. (2) Wire into `updateToolSegmentElement` — after marking tool complete, call collapse logic. (3) Ensure `segmentElements` map entries still resolve correctly when tools are nested in group wrappers (elements stay in map, just reparented). (4) Handle group expansion: if tool 3 completes and tools 1-2 are already grouped, add tool 3 to the existing group. (5) Add tests for streaming collapse scenarios.
  - Verify: `npx vitest run` all tests pass; visual test in extension — trigger multiple reads during streaming, verify they collapse into group as each completes
  - Done when: Streaming tool calls collapse into expandable groups in real-time, `updateToolSegmentElement` works for grouped tools, and finalized render still works (groups rebuild correctly on finalization)

## Files Likely Touched

- `src/webview/tool-grouping.ts` (new)
- `src/webview/renderer.ts`
- `src/webview/helpers.ts`
- `src/webview/index.ts`
- `src/webview/__tests__/tool-grouping.test.ts` (new)
- `src/webview/styles/chat.css`
