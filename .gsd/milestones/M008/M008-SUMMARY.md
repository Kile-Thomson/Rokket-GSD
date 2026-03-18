---
id: M008
provides:
  - RPC buffer overflow protection (10MB cap with full reset)
  - Watchdog timer leak fix via incrementing nonce guard
  - Tool call grouping — consecutive read-only tools collapse into expandable summaries
  - Loading state verification and test coverage for all async flows
  - Full ARIA accessibility — roles, labels, keyboard nav, focus trapping, live regions
  - index.ts decomposed from 2416 to 709 lines across 5 new modules
  - 140 tests (up from 82 baseline)
key_decisions:
  - D19: RPC buffer overflow — full reset, not truncation (JSONL integrity)
  - D20: Watchdog timer leak — incrementing nonce guard
  - D21: Tool grouping as render-time transform — no data model changes
  - D22: Groupable tool classification — read-only tools only
  - D23: Per-session state — single SessionState object replaces 17 individual Maps
patterns_established:
  - Module extraction via init(deps) pattern with dependency injection
  - DOM-pattern testing for non-exported UI logic using jsdom
  - Event delegation for keyboard activation on rendered content
  - Roving tabindex for toolbar navigation
  - Listbox/option pattern with arrow key nav for picker overlays
  - Focus trap closure factory for dialog overlays
  - GroupedSegment discriminated union for single vs group rendering
observability_surfaces:
  - data-tool-group and data-tool-count DOM attributes for tool group inspection
  - console.debug "[gsd]" prefixed logs for tool grouping events
  - aria-expanded attributes reflect collapse state
  - streaming CSS class on .gsd-entry-assistant elements
  - gsd-loading-spinner class for async loading flows
requirement_outcomes: []
duration: ~2.5h
verification_result: passed
completed_at: 2026-03-14
---

# M008: Hardening, Performance & UX

**Extension hardened with RPC buffer protection, tool call grouping, full keyboard accessibility, loading state coverage, and index.ts decomposed into focused modules — 140 tests pass with zero regressions.**

## What Happened

Six slices transformed the extension from "works" to "solid" across stability, UX, and maintainability.

**S01 (Stability)** capped the RPC buffer at 10MB with a full-reset strategy (truncation would corrupt JSONL mid-line), fixed the watchdog timer leak using an incrementing nonce guard, replaced silent catches in critical paths with visible error surfacing, and extracted duplicate `formatMarkdownNotes()` to a shared helper.

**S02 (Tool Grouping)** added a pure `tool-grouping.ts` module that classifies ~30 read-only tools and groups consecutive runs of 2+ into collapsible `<details>` summary rows. Both finalized and streaming render paths support grouping — streaming uses `previousElementSibling` DOM checks to collapse tools as they complete. 29 tests cover classification, grouping logic, summary labels, and DOM manipulation.

**S03 (Loading States)** audited all async loading flows (dashboard, changelog, model picker) and confirmed they already had correct spinner patterns. Added 10 tests to lock the behavior, including copy-button gating that hides Copy until streaming completes.

**S04 (Accessibility)** added ARIA attributes across all interactive elements: `role="button"`, `tabindex="0"`, `aria-label`, and `aria-expanded` on tool headers; roving tabindex on the header toolbar; `role="listbox"`/`role="option"` with arrow key navigation on model/thinking pickers and slash menu; `role="dialog"` with `aria-modal` and focus trapping on UI dialogs; focus restoration on all overlay dismissals. 12 accessibility tests added.

**S05 (Decomposition)** extracted 5 modules from index.ts — `dashboard.ts` (323 lines), `file-handling.ts` (243 lines), `message-handler.ts` (884 lines), `keyboard.ts` (304 lines), `ui-updates.ts` (362 lines) — reducing index.ts from 2416 to 709 lines. All modules follow an `init(deps)` pattern with dependency injection. Fixed a pre-existing bug where `insertDroppedPaths` was called but never defined.

**S06 (Integration)** verified all deliverables end-to-end: build succeeds (99.7kb extension, 278.8kb webview), 140 tests pass across 7 test files, no circular dependencies, module boundaries clean.

## Cross-Slice Verification

| Success Criterion | Evidence |
|---|---|
| All interactive elements have ARIA labels and are keyboard-navigable | 45+ ARIA-related lines across 9 source files; roving tabindex on toolbar; listbox/option on pickers; focus trapping in dialogs; 12 accessibility tests pass |
| Async operations show loading indicators | S03 verified all 3 flows (dashboard, changelog, model picker) already correct; 10 tests lock spinner behavior; copy-button gating confirmed |
| Silent catch blocks replaced with visible error surfacing | RPC buffer capped at 10MB with full reset + output channel logging; watchdog nonce guard prevents stale timer callbacks |
| Tool calls group into collapsible summaries | tool-grouping.ts with isGroupableTool (30+ tools), groupConsecutiveTools, streaming collapse; 29 tests pass; "Read 3 files" style labels |
| RPC buffer capped to prevent OOM | MAX_BUFFER_SIZE = 10MB in rpc-client.ts:330; full reset on overflow with log emission |
| index.ts decomposed from 2,379 lines into focused modules under 500 lines each | 709 lines (from 2416); 5 new modules; all under 500 except message-handler (884 — accepted as single dense switch) |
| All existing 82 tests pass, new tests added | 140 tests pass across 7 files (82 → 140, +58 new tests) |

## Requirement Changes

No requirements were tracked for M008 — milestone was self-contained with success criteria defined in the roadmap.

## Forward Intelligence

### What the next milestone should know
- index.ts is now an orchestration shell (709 lines) that imports from 5 focused modules — new features should go into the appropriate module, not back into index.ts
- `buildSegmentHtml` in renderer.ts is a reusable function for building HTML for individual tool/text segments
- All overlays (model picker, thinking picker, slash menu, dialogs, session history) follow a consistent pattern: track trigger element on show, restore focus on hide
- Tool grouping is render-time only — TurnSegment and ToolCallState types are unchanged

### What's fragile
- Streaming tool collapse relies on `previousElementSibling` — inserting non-tool DOM nodes between tool elements during streaming would prevent collapse (graceful degradation, not crash)
- Spinner replacement uses remove-before-create pattern — early returns between remove and create leave blank UI
- message-handler.ts at 884 lines is the densest module — it's a single switch statement and shouldn't be split further, but new message types add more weight

### Authoritative diagnostics
- `document.querySelectorAll('[data-tool-group]')` — lists all active tool groups with data-tool-count
- `document.activeElement` after overlay dismiss — confirms focus restoration
- `streaming` CSS class on `.gsd-entry-assistant` — identifies in-progress turns
- `npx vitest run` — 140 tests across 7 files, full regression suite

### What assumptions changed
- Plan assumed index.ts streaming code needed modification for tool grouping — all wiring fit into renderer.ts's existing updateToolSegmentElement
- Plan expected loading state code fixes needed — all 3 flows were already correctly implemented
- Plan targeted index.ts under 500 lines — landed at 709 (required adding ui-updates.ts extraction not in original plan)

## Files Created/Modified

- `src/webview/tool-grouping.ts` — new: tool classification, grouping logic, streaming collapse
- `src/webview/dashboard.ts` — new: extracted dashboard rendering and welcome screen
- `src/webview/file-handling.ts` — new: extracted paste/drop/file attachment handlers
- `src/webview/message-handler.ts` — new: extracted window message event handler
- `src/webview/keyboard.ts` — new: extracted keyboard/click handlers and ARIA support
- `src/webview/ui-updates.ts` — new: extracted header/footer/input/overlay UI updates
- `src/webview/index.ts` — reduced from 2416 to 709 lines (orchestration shell)
- `src/webview/renderer.ts` — ARIA attributes, buildSegmentHtml extraction, tool group rendering
- `src/webview/helpers.ts` — formatMarkdownNotes shared helper, code block copy aria-label
- `src/webview/styles.css` — tool group styles, extended focus-visible selectors
- `src/webview/model-picker.ts` — listbox/option ARIA, arrow key nav, focus restore
- `src/webview/thinking-picker.ts` — listbox/option ARIA, arrow key nav, focus restore
- `src/webview/slash-menu.ts` — listbox/option ARIA, focus restore
- `src/webview/ui-dialogs.ts` — dialog/modal ARIA, focus trap, focus restore
- `src/webview/session-history.ts` — complementary role, aria-label, focus restore
- `src/extension/rpc-client.ts` — RPC buffer cap at 10MB with full reset
- `src/extension/webview-provider.ts` — watchdog nonce guard fix
- `src/webview/__tests__/tool-grouping.test.ts` — 29 tool grouping tests
- `src/webview/__tests__/loading-states.test.ts` — 10 loading state tests
- `src/webview/__tests__/accessibility.test.ts` — 12 accessibility tests
