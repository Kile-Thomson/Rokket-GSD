---
id: T02
parent: S04
milestone: M008
provides:
  - ARIA roles (listbox/option/dialog/complementary) on all overlay components
  - Arrow key navigation in model picker and thinking picker
  - Focus trap in UI dialogs (Tab/Shift+Tab cycling)
  - Focus restoration to trigger element on all overlay dismiss
  - Accessibility test suite (12 test cases)
key_files:
  - src/webview/model-picker.ts
  - src/webview/thinking-picker.ts
  - src/webview/slash-menu.ts
  - src/webview/ui-dialogs.ts
  - src/webview/session-history.ts
  - src/webview/__tests__/accessibility.test.ts
key_decisions:
  - Focus trap implemented as a reusable closure factory (createFocusTrap) in ui-dialogs.ts rather than a shared module — only dialogs need it since pickers use listbox pattern with arrow keys instead
  - Slash menu sets role/aria-label attributes imperatively in render() since the element is reused across renders, while pickers use inline HTML attributes
patterns_established:
  - Listbox/option pattern with arrow key nav and roving tabindex for picker overlays
  - Focus trap pattern for dialog overlays (Tab/Shift+Tab wrapping at boundaries)
  - triggerEl capture on show(), restore on hide() for all overlays
observability_surfaces:
  - role, aria-selected, aria-modal, aria-label attributes inspectable in DOM/accessibility tree
  - document.activeElement verifiable in console after overlay dismiss to confirm focus restoration
duration: ~20min
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T02: Add overlay accessibility — roles, focus trap, keyboard nav, and tests

**Added ARIA listbox/dialog patterns, arrow key navigation, focus trapping, and focus restoration to all 5 overlay components. Wrote 12-test accessibility suite.**

## What Happened

1. **Model picker** — Added `role="listbox"` containers, `role="option"` + `aria-selected` on items, `aria-label` on close button. Added ArrowUp/ArrowDown/Enter/Escape keyboard handling with roving tabindex. Tracks `triggerEl` before show, restores focus on hide. Active item receives focus on show.

2. **Thinking picker** — Same listbox/option pattern. Arrow key nav, roving tabindex, focus restore. Initial activeIndex set to current thinking level.

3. **Slash menu** — Added `role="listbox"` + `aria-label` on container, `role="option"` + `aria-selected` on items. Arrow key nav already existed (navigateUp/Down). Focus restores to prompt input on hide.

4. **UI dialogs** — Added `role="dialog"` + `aria-modal="true"` + `aria-label` to confirm, input, single-select, and multi-select dialogs. Added `role="listbox"` + `role="option"` to select option containers. Multi-select options sync `aria-selected` on toggle. Created `createFocusTrap()` helper — Tab wraps from last to first, Shift+Tab wraps from first to last. Focus trap applied after dialog appended. Focus restores to pre-dialog element on resolve.

5. **Session history** — Added `role="complementary"` + `aria-label="Session history"` on panel (set in both loading and loaded states). Added `aria-label` on close button. Tracks triggerEl for focus restore on hide. Existing arrow key nav already works with the ARIA roles.

6. **Test suite** — Created `accessibility.test.ts` with 12 tests covering: tool block header ARIA, aria-expanded toggle, group header ARIA, copy button aria-label, model picker options, thinking picker listbox, slash menu listbox, UI dialog roles (confirm + select), session history role, and focus trap cycling (both Tab and Shift+Tab wrapping).

## Verification

- `npx vitest run` — 140 tests pass (7 test files), including 12 new accessibility tests
- `grep -cE 'role=|aria-|tabindex'` across 5 overlay files returns 26 (threshold: 15+)
- Slice-level checks:
  - ✅ `npx vitest run` — all pass
  - ✅ `grep -c` on renderer.ts — checked in T01, still passing
  - ✅ `grep -c` on overlay files — 26, well above 15+

## Diagnostics

- Inspect `role="listbox"` and `role="option"` on model/thinking picker items in DOM inspector
- Check `aria-selected` attribute updates when navigating picker items with arrow keys
- Verify `document.activeElement` returns to trigger after Escape from any overlay
- Tab through a UI dialog to verify focus trap wrapping at boundaries
- `role="dialog"` + `aria-modal="true"` visible in accessibility tree when dialog is active

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/webview/model-picker.ts` — Added listbox/option ARIA, arrow key nav, focus tracking/restore
- `src/webview/thinking-picker.ts` — Added listbox/option ARIA, arrow key nav, focus tracking/restore
- `src/webview/slash-menu.ts` — Added listbox/option ARIA attributes, focus restore to prompt
- `src/webview/ui-dialogs.ts` — Added dialog/modal ARIA, listbox for selects, focus trap, focus restore
- `src/webview/session-history.ts` — Added complementary role, aria-label, focus restore
- `src/webview/__tests__/accessibility.test.ts` — New test file with 12 accessibility test cases
- `.gsd/milestones/M008/slices/S04/tasks/T02-PLAN.md` — Added Observability Impact section
