# M008: Hardening, Performance & UX

**Vision:** Transform the extension from "works" to "solid" — visible errors, accessible UI, grouped tool calls, loading states, and a maintainable codebase.

## Success Criteria

- All interactive elements have ARIA labels and are keyboard-navigable
- Async operations (changelog, dashboard, model fetch) show loading indicators
- Silent catch blocks replaced with visible error surfacing where appropriate
- Tool calls group into collapsible summaries (e.g. "Read 3 files" instead of 3 separate entries)
- RPC buffer capped to prevent OOM from misbehaving pi process
- index.ts decomposed from 2,379 lines into focused modules under 500 lines each
- All existing 82 tests pass, new tests added for new functionality

## Key Risks / Unknowns

- Tool call grouping during streaming — segments arrive one-at-a-time, grouping requires buffering/lookahead or post-hoc collapsing
- index.ts decomposition — heavy use of shared mutable state and closures makes extraction non-trivial

## Proof Strategy

- Tool grouping risk → retire in S02 by proving grouped tool calls render correctly during live streaming
- Decomposition risk → retire in S04 by proving all tests pass after extraction

## Verification Classes

- Contract verification: vitest unit tests + existing 82 tests
- Integration verification: extension loads and chat works end-to-end after each slice
- Operational verification: none beyond existing health monitoring
- UAT / human verification: visual check of loading states, tool grouping, keyboard nav

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 6 slices are complete with tests passing
- Extension builds and packages without errors
- Chat works end-to-end with streaming, tool calls, and grouped display
- Keyboard navigation works for all header actions and message controls
- Loading spinners visible on changelog, dashboard, and model fetch
- No silent catch blocks in critical paths (RPC, process spawn, message handling)

## Slices

- [x] **S01: Stability fixes & error surfacing** `risk:low` `depends:[]`
  > After this: RPC buffer is capped, watchdog timer leak fixed, silent catches in critical paths replaced with visible errors, duplicate formatNotes extracted to shared helper
- [x] **S02: Tool call grouping** `risk:high` `depends:[]`
  > After this: Sequential read-only tool calls (read_file, list_files, search) collapse into a single expandable summary row during rendering
- [x] **S03: Loading states & async UX** `risk:low` `depends:[]`
  > After this: Changelog fetch, dashboard load, and model picker show spinners while loading. Code blocks hide Copy button until streaming completes.
- [ ] **S04: Accessibility — ARIA & keyboard nav** `risk:medium` `depends:[]`
  > After this: All header buttons, message actions, and overlays have ARIA labels. Tab/Enter navigation works throughout. Screen reader live regions announce new messages.
- [ ] **S05: index.ts decomposition** `risk:medium` `depends:[S01,S02,S03,S04]`
  > After this: index.ts broken into focused modules (message-handler.ts, changelog.ts, dashboard.ts, welcome.ts, keyboard.ts). Each under 500 lines. All tests pass.
- [ ] **S06: Integration verification & polish** `risk:low` `depends:[S05]`
  > After this: Full end-to-end verification — extension loads, streams, groups tools, shows loading states, keyboard navigable, errors surface visibly. All tests green.

## Boundary Map

### S01 → S05

Produces:
- Shared `formatMarkdownNotes()` helper in `src/webview/helpers.ts`
- Clean error surfacing pattern (errors forwarded to output channel + webview)

Consumes:
- nothing (first slice)

### S02 → S05

Produces:
- Tool grouping logic in renderer (new `groupConsecutiveTools()` function)
- Collapsible group component in DOM

Consumes:
- nothing (independent)

### S03 → S05

Produces:
- Loading spinner component pattern
- Code block completion tracking in renderer

Consumes:
- nothing (independent)

### S04 → S05

Produces:
- ARIA attributes on all interactive elements
- Keyboard handler module

Consumes:
- nothing (independent)

### S05 → S06

Produces:
- Decomposed modules extracted from index.ts
- Same public API, imports rewired

Consumes:
- All patterns from S01-S04 are stable
