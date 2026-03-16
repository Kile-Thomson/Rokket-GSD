---
id: S04
parent: M008
milestone: M008
provides:
  - ARIA attributes (role, tabindex, aria-label, aria-expanded) on all interactive rendered elements
  - Keyboard activation (Enter/Space) for tool blocks and group headers via event delegation
  - Roving tabindex on header toolbar with arrow key navigation
  - ARIA listbox/option pattern with arrow key nav on model picker, thinking picker, slash menu
  - Focus trap (Tab/Shift+Tab cycling) in UI dialogs
  - Focus restoration to trigger element on all overlay dismiss
  - role="complementary" on session history panel
  - 12-test accessibility test suite
requires: []
affects:
  - S05
key_files:
  - src/webview/renderer.ts
  - src/webview/tool-grouping.ts
  - src/webview/index.ts
  - src/webview/styles.css
  - src/webview/helpers.ts
  - src/webview/model-picker.ts
  - src/webview/thinking-picker.ts
  - src/webview/slash-menu.ts
  - src/webview/ui-dialogs.ts
  - src/webview/session-history.ts
  - src/webview/__tests__/accessibility.test.ts
key_decisions:
  - Event delegation on messagesContainer for keyboard activation — consistent with existing click delegation
  - Native <details> toggle event (with capture) to sync aria-expanded on group headers
  - Focus trap as closure factory (createFocusTrap) in ui-dialogs.ts — only dialogs need it; pickers use listbox arrow key pattern instead
  - Slash menu sets role/aria-label imperatively in render() since the element is reused across renders
patterns_established:
  - role="button" + tabindex="0" + aria-label + aria-expanded for collapsible headers
  - Roving tabindex on toolbar with ArrowLeft/Right/Home/End
  - Listbox/option pattern with arrow key nav and roving tabindex for picker overlays
  - Focus trap for dialog overlays (Tab/Shift+Tab wrapping at boundaries)
  - triggerEl capture on show(), restore on hide() for all overlays
observability_surfaces:
  - aria-expanded attributes on tool/group headers reflect open/close state in DOM
  - Focus-visible outlines show keyboard navigation state
  - role, aria-selected, aria-modal attributes inspectable in accessibility tree
  - document.activeElement verifiable after overlay dismiss to confirm focus restoration
drill_down_paths:
  - .gsd/milestones/M008/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M008/slices/S04/tasks/T02-SUMMARY.md
duration: ~45min
verification_result: passed
completed_at: 2026-03-14
---

# S04: Accessibility — ARIA & keyboard nav

**All interactive elements have ARIA roles, labels, and keyboard activation. Overlays have focus trapping and arrow key navigation. 12-test accessibility suite added.**

## What Happened

T01 added ARIA attributes to all rendered content: tool block headers got `role="button"`, `tabindex="0"`, `aria-label`, and `aria-expanded`; group headers in both static and streaming paths got the same treatment; copy buttons got `aria-label`. Keyboard activation (Enter/Space) was wired via event delegation on `messagesContainer`. The header toolbar got roving tabindex with ArrowLeft/Right/Home/End. `aria-expanded` toggles on click and on `<details>` toggle events. Focus-visible CSS was extended to all new tab stops.

T02 added accessibility to all five overlay components. Model picker and thinking picker got `role="listbox"`/`role="option"` with `aria-selected` and ArrowUp/Down/Enter/Escape keyboard nav. Slash menu got the same listbox attributes. UI dialogs (confirm, input, single-select, multi-select) got `role="dialog"`, `aria-modal="true"`, and a focus trap that cycles Tab/Shift+Tab within dialog bounds. Session history got `role="complementary"`. All overlays now track the trigger element before opening and restore focus on dismiss. A 12-test accessibility suite covers ARIA attributes, keyboard activation, overlay roles, and focus trap cycling.

## Verification

- `npx vitest run` — 140 tests pass (7 test files), including 12 new accessibility tests
- `grep -cE 'role=|aria-|tabindex' src/webview/renderer.ts` → 5 (threshold: 5+) ✅
- `grep -cE 'role=|aria-|tabindex' src/webview/tool-grouping.ts` → 1 (single line with 4 attrs) ✅
- `grep -cE 'role=|aria-|tabindex'` across 5 overlay files → 26 (threshold: 15+) ✅

## Deviations

- Added `aria-label="Copy code"` to code block copy button in helpers.ts (not in plan but required for complete coverage)
- Added `aria-hidden="true"` to copy-response SVG icon (accessibility best practice)

## Known Limitations

- tool-grouping.ts grep count is 1 line (containing 4 attributes) vs the plan's 5+ line target — functionally complete but the attributes are on a single template literal line

## Follow-ups

None.

## Files Created/Modified

- `src/webview/renderer.ts` — ARIA on tool block headers, group headers, copy-response button
- `src/webview/tool-grouping.ts` — ARIA on streaming group headers
- `src/webview/helpers.ts` — aria-label on code block copy button
- `src/webview/index.ts` — aria-expanded toggling, keyboard activation, roving tabindex
- `src/webview/styles.css` — Extended focus-visible selectors
- `src/webview/model-picker.ts` — Listbox/option ARIA, arrow key nav, focus restore
- `src/webview/thinking-picker.ts` — Listbox/option ARIA, arrow key nav, focus restore
- `src/webview/slash-menu.ts` — Listbox/option ARIA, focus restore
- `src/webview/ui-dialogs.ts` — Dialog/modal ARIA, focus trap, focus restore
- `src/webview/session-history.ts` — Complementary role, aria-label, focus restore
- `src/webview/__tests__/accessibility.test.ts` — 12-test accessibility suite

## Forward Intelligence

### What the next slice should know
- All interactive elements now have ARIA attributes — S05 decomposition must preserve these when extracting modules from index.ts (keyboard handler, aria-expanded toggling, roving tabindex)
- The keyboard activation delegation and roving tabindex code in index.ts are good extraction candidates for a `keyboard.ts` module

### What's fragile
- Roving tabindex logic in index.ts is interleaved with other event handlers — extraction needs care to preserve the toolbar button query and focus management

### Authoritative diagnostics
- `aria-expanded` on `.gsd-tool-header` elements — reflects current expand/collapse state
- `document.activeElement` after overlay dismiss — confirms focus restoration works

### What assumptions changed
- Plan assumed tool-grouping.ts would need 5+ grep-matching lines — actual implementation puts all attrs on one template literal line (functionally equivalent)
