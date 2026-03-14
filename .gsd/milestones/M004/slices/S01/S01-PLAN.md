# S01: Workflow Badge + Header Sizing

**Goal:** Header shows live GSD workflow state and all elements are ~30% larger.
**Demo:** Open extension → see workflow badge (e.g., `M004 › S01 · Executing`) and visibly larger header elements. With no `.gsd/`, see `Self-directed`.

## Must-Haves

- STATE.md parser in extension host
- Workflow badge element in header
- ~30% size bump on all header components (badges, buttons, brand)
- Refresh on launch, agent_end, and periodic poll
- Graceful handling of missing `.gsd/` or malformed STATE.md

## Verification

- Build extension (`npm run build`), load in VS Code Extension Development Host
- Verify workflow badge shows correct state from STATE.md
- Verify header elements are visibly larger
- Verify narrow sidebar (≤350px) doesn't break layout

## Tasks

- [x] **T01: STATE.md parser + message type** `est:30m`
  - Why: Extension host needs to read and parse STATE.md to extract workflow state
  - Files: `src/extension/state-parser.ts`, `src/shared/types.ts`
  - Do: Create `parseGsdState(cwd)` that reads `.gsd/STATE.md`, extracts active milestone/slice/task IDs+titles, phase, and auto-mode status via `setStatus` events. Add `GsdWorkflowState` type and `workflow_state` message type to shared types.
  - Verify: Parser returns correct data for current STATE.md, returns null gracefully for missing file
  - Done when: Parser handles all 13 phase values and missing/partial data

- [x] **T02: Wire state into webview provider** `est:20m`
  - Why: Extension host must send workflow state to webview on launch, after agent_end, and on setStatus changes
  - Files: `src/extension/webview-provider.ts`
  - Do: Call `parseGsdState()` on launch, after each `agent_end` event, and when `setStatus("gsd-auto", ...)` arrives. Send as `workflow_state` message. Add 30s refresh poll.
  - Verify: Webview receives workflow_state messages at correct times
  - Done when: State updates flow to webview after agent turns and on status changes

- [x] **T03: Workflow badge UI + header sizing** `est:40m`
  - Why: Webview needs to render the workflow badge and all header elements need to be larger
  - Files: `src/webview/index.ts`, `src/webview/styles.css`
  - Do: Add workflow badge element to header HTML. Handle `workflow_state` messages to update badge content. Bump all header sizing ~30%: badges (10→13px font, 22→28px min-height, 2px→3px/8px→10px padding), action buttons (10→13px font, 12→16px SVG icons, 3px→5px/8px→10px padding, 14→18px inline SVG), brand (14→18px logo, 13→16px title), header (36→46px min-height, 6px→8px/12px→16px padding). Responsive handling: truncate workflow badge at narrow widths, hide phase text below 350px.
  - Verify: Build and load in Extension Development Host. Badge shows state, everything is larger.
  - Done when: Header is visually correct at normal and narrow widths

## Files Likely Touched

- `src/extension/state-parser.ts` (new)
- `src/shared/types.ts`
- `src/extension/webview-provider.ts`
- `src/webview/index.ts`
- `src/webview/styles.css`
