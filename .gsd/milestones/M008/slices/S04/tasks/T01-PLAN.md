---
estimated_steps: 4
estimated_files: 10
---

# T01: Verify accessibility coverage and fill any remaining gaps

**Slice:** S04 — Accessibility — ARIA & keyboard nav
**Milestone:** M008

## Description

The bulk of S04's ARIA and keyboard navigation work has already been implemented across previous slices. Tool blocks have `role="button"`, `tabindex="0"`, and `aria-expanded`. Overlay pickers have `role="listbox"` and `role="option"` with arrow key nav. Dialogs have `role="dialog"`, `aria-modal`, and focus trapping. Session history has `role="complementary"`. The header toolbar has roving tabindex. 12 accessibility tests already pass.

This task audits for any remaining gaps, fills them, and ensures the slice's definition of done is met.

## Steps

1. Audit all interactive elements across renderer.ts, tool-grouping.ts, and overlay modules — verify every clickable/interactive element has appropriate `role`, `tabindex`, and `aria-label`
2. Verify keyboard activation handlers: Enter/Space for role="button" elements, arrow keys in pickers, Escape for overlays, Tab trapping in dialogs
3. Check focus-visible CSS covers all interactive element selectors — add any missing selectors
4. Run full test suite to confirm no regressions, add any missing test coverage for gaps found

## Must-Haves

- [ ] All tool headers, group headers, copy buttons have `role`, `tabindex`, `aria-label`
- [ ] `aria-expanded` toggles on expand/collapse
- [ ] Overlay pickers have `role="listbox"` with `role="option"` items
- [ ] Dialogs have focus trapping
- [ ] Session history has `role="complementary"`
- [ ] Keyboard activation works for all role="button" elements
- [ ] Focus-visible styles cover all interactive selectors
- [ ] All 140+ tests pass

## Verification

- `npx vitest run` — all tests pass
- `grep -rn "role=\|aria-" src/webview/renderer.ts src/webview/tool-grouping.ts src/webview/model-picker.ts src/webview/thinking-picker.ts src/webview/slash-menu.ts src/webview/ui-dialogs.ts src/webview/session-history.ts` shows comprehensive coverage

## Inputs

- `src/webview/__tests__/accessibility.test.ts` — existing 12 tests defining expected ARIA structure
- `.gsd/milestones/M008/slices/S04/S04-RESEARCH.md` — gap analysis and patterns to follow

## Expected Output

- All interactive elements across the webview have proper ARIA attributes
- Any gaps filled with minimal, targeted edits
- All tests green
