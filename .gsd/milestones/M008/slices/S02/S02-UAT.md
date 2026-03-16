# S02: Tool Call Grouping — UAT

**Milestone:** M008
**Written:** 2026-03-14

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: Unit tests prove grouping logic; visual verification in running extension proves rendering

## Preconditions

- Extension built and loaded in VS Code (F5 debug or installed VSIX)
- GSD agent process running and responsive
- A project with multiple files available for reading

## Smoke Test

Send a prompt like "Read the package.json and tsconfig.json files" — the response should show tool calls. If 2+ consecutive Read calls appear, they should collapse into a single "Read 2 files" row.

## Test Cases

### 1. Consecutive reads collapse in finalized turn

1. Send a prompt that triggers 3+ consecutive Read tool calls (e.g., "Read package.json, tsconfig.json, and README.md")
2. Wait for the turn to complete (streaming finishes)
3. Look at the tool call section of the response
4. **Expected:** A single collapsed `<details>` row showing "Read 3 files" (or similar count). Clicking it expands to show individual tool calls with their output.

### 2. Streaming collapse as tools complete

1. Send a prompt that triggers multiple consecutive Read calls
2. Watch the tool calls as they stream in
3. **Expected:** First tool appears normally. When the second groupable tool completes, both collapse into a group. Third tool appends to the group. The group summary count updates in real-time.

### 3. Non-groupable tools render standalone

1. Send a prompt that triggers a Write or Edit tool call
2. **Expected:** The tool renders as a normal standalone tool block, not wrapped in a group — even if adjacent to Read calls.

### 4. Error tool breaks group

1. Send a prompt that reads a file that doesn't exist (triggering an error) sandwiched between valid reads
2. **Expected:** The error tool renders standalone. Valid reads before the error may group together, and valid reads after may form a separate group, but the error tool is never inside a group.

### 5. Text between tools prevents grouping

1. Send a prompt where the agent writes a text response between Read calls
2. **Expected:** Each batch of consecutive reads groups separately. Reads separated by text output do not merge into one group.

### 6. Single tool doesn't group

1. Send a prompt that triggers exactly one Read call
2. **Expected:** The tool renders as a normal standalone block with no `<details>` group wrapper.

### 7. Group expands to show individual tools

1. Find a collapsed tool group (from test case 1)
2. Click the group summary row to expand it
3. **Expected:** Individual tool calls visible inside, each with their own icon, name, arguments, duration, and output. Clicking again collapses.

## Edge Cases

### Mixed groupable tools in one run

1. Send a prompt that triggers a Read, then a search-the-web, then another Read in sequence
2. **Expected:** All three collapse into a single group (they're all groupable read-only tools). Label reflects the mixed types.

### GitHub action-aware grouping

1. If possible, trigger `github_issues` with action `list` followed by `github_issues` with action `create`
2. **Expected:** `list` is groupable but `create` is not. They should NOT be in the same group.

## Failure Signals

- Tool calls render individually when they should be grouped (2+ consecutive groupable completed tools)
- Group wrapper appears around a single tool
- Error tools hidden inside a group
- Mutating tools (Write, Edit, bash) appear inside a group
- Expanding a group shows empty content or duplicated tools
- `segmentElements` lookup fails for grouped tools (would show as missing tool updates during streaming)

## Not Proven By This UAT

- Performance with very large numbers of tool calls (50+)
- Accessibility of group expand/collapse (covered by S04)
- Loading states within tool groups (covered by S03)

## Notes for Tester

- Use browser devtools in the webview: `document.querySelectorAll('[data-tool-group]')` lists all groups, each has a `data-tool-count` attribute
- Console shows `[gsd] Tool grouping: N group(s)` on finalized renders and `[gsd] Streaming collapse: created/expanded` during streaming
- If no grouping occurs, the agent may not have made consecutive reads — check the raw segments
