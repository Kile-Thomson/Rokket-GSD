# M004: Header Enhancements — Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

## Project Description

Enhance the VS Code extension header bar with two improvements: (1) a GSD workflow state indicator showing the current milestone/slice/task and phase, and (2) a ~30% size bump to all header components for better readability.

## Why This Milestone

The header currently shows model/thinking/cost/context badges and action buttons, but nothing about the GSD workflow state. Users running GSD auto-mode or structured work have no at-a-glance visibility into what phase they're in (planning, executing, blocked, etc.) or which milestone/slice/task is active. Additionally, the current header elements are undersized and hard to read.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Glance at the header to see current GSD workflow state (e.g., `M004 › S02 › T03 · Executing`)
- See `Self-directed` when no GSD structure exists
- Read all header badges and buttons comfortably without squinting

### Entry point / environment

- Entry point: VS Code extension sidebar/editor tab
- Environment: VS Code with Rokket GSD extension loaded
- Live dependencies involved: GSD RPC subprocess, `.gsd/STATE.md` on disk

## Completion Class

- Contract complete means: header renders workflow state correctly for all phase values, sizes are visibly larger
- Integration complete means: state updates in real time as GSD progresses through milestones
- Operational complete means: none

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Header shows correct workflow state parsed from STATE.md
- State updates after agent turns complete
- Header elements are visibly ~30% larger than current
- No layout breakage at narrow sidebar widths

## Risks and Unknowns

- STATE.md format changes — low risk, format is template-driven and stable
- Header overflow at narrow widths with workflow badge added — medium risk, need responsive handling

## Existing Codebase / Prior Art

- `src/webview/styles.css` — all header CSS (lines 44-230)
- `src/webview/index.ts` — header HTML template and state update logic
- `src/extension/webview-provider.ts` — message routing, state management
- `src/shared/types.ts` — message type definitions
- `.gsd/STATE.md` — source of workflow state data

## Scope

### In Scope

- Parse STATE.md for active milestone/slice/task and phase
- Workflow state badge in header
- ~30% size increase for all header components
- Responsive handling for narrow widths

### Out of Scope / Non-Goals

- RPC protocol changes to expose GSDState
- Auto-mode controls in the header
- Progress bars or completion percentages
- Modifying STATE.md format

## Technical Constraints

- Must work with existing vanilla DOM architecture (no framework)
- Must handle missing `.gsd/` directory gracefully
- File reads must be non-blocking (async fs)
