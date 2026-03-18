---
estimated_steps: 5
estimated_files: 8
---

# T02: Add overlay accessibility — roles, focus trap, keyboard nav, and tests

**Slice:** S04 — Accessibility — ARIA & keyboard nav
**Milestone:** M008

## Description

Overlay components (model picker, thinking picker, slash menu, UI dialogs, session history) have no ARIA roles, no keyboard navigation beyond Escape, and no focus management. This task adds listbox/dialog patterns, arrow key navigation, focus trapping, and focus restoration. Also writes the slice's accessibility test suite.

## Steps

1. In `model-picker.ts` and `thinking-picker.ts`, add `role="listbox"` to the container, `role="option"` + `aria-selected` to each item. Add ArrowUp/ArrowDown handlers to move selection, Enter to confirm. Track the trigger element before showing, restore focus on dismiss.
2. In `slash-menu.ts`, add `role="listbox"` / `role="option"` + `aria-selected`. Add arrow key navigation. Restore focus to input on dismiss.
3. In `ui-dialogs.ts`, add `role="dialog"`, `aria-modal="true"`, `aria-label` to dialog containers. Implement focus trap: on show, focus first focusable element; Tab cycles forward, Shift+Tab cycles backward, wrapping at boundaries. Restore focus to trigger on close.
4. In `session-history.ts`, add `role="complementary"`, `aria-label="Session history"` to the panel. Verify existing arrow key navigation works with the ARIA roles. Restore focus on close.
5. Write `src/webview/__tests__/accessibility.test.ts`: test that rendered tool block HTML contains `role="button"` and `aria-expanded`, group headers have ARIA attrs, copy buttons have `aria-label`, overlay containers have correct roles, focus trap helper cycles correctly.

## Must-Haves

- [ ] Model/thinking pickers have `role="listbox"` with `role="option"` items and arrow key nav
- [ ] Slash menu has listbox pattern with arrow key nav
- [ ] UI dialogs have `role="dialog"`, `aria-modal`, focus trap
- [ ] Session history has `role="complementary"` and `aria-label`
- [ ] All overlays restore focus to trigger element on dismiss
- [ ] `accessibility.test.ts` covers rendered ARIA attrs and overlay roles
- [ ] All tests pass (existing + new)

## Observability Impact

- `role="listbox"` and `role="option"` on model/thinking pickers visible in DOM inspector and accessibility tree
- `role="dialog"` + `aria-modal="true"` on UI dialogs — screen readers announce dialog context
- `role="complementary"` + `aria-label` on session history — landmarks visible in accessibility tree
- `aria-selected` on picker options updates dynamically — inspectable via DOM attributes
- Focus restoration: after dismissing any overlay, `document.activeElement` returns to the trigger element — verifiable via console
- Focus trap in dialogs: Tab/Shift+Tab cycling within dialog boundaries — testable interactively

## Verification

- `npx vitest run` — all tests pass including new accessibility tests
- `grep -cE 'role=|aria-|tabindex' src/webview/model-picker.ts src/webview/thinking-picker.ts src/webview/slash-menu.ts src/webview/ui-dialogs.ts src/webview/session-history.ts` returns 15+

## Inputs

- T01 output — ARIA patterns established in renderer.ts and index.ts
- `src/webview/model-picker.ts`, `thinking-picker.ts`, `slash-menu.ts`, `ui-dialogs.ts`, `session-history.ts` — current overlay implementations
- `src/webview/session-history.ts:102` — existing `handleKeyDown()` pattern to extend
- S04-RESEARCH.md — WAI-ARIA listbox/dialog patterns, focus trap approach, pitfalls

## Expected Output

- All 5 overlay files updated with ARIA roles and keyboard navigation
- `src/webview/__tests__/accessibility.test.ts` — new test file with 8+ test cases
- `src/webview/index.ts` — minor updates for focus tracking on overlay show/hide
