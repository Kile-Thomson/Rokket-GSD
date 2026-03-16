# S04: Accessibility — ARIA & keyboard nav

**Goal:** All header buttons, message actions, and overlays have ARIA labels. Tab/Enter navigation works throughout. Screen reader live regions announce new messages.
**Demo:** Tabbing through the UI reaches all interactive elements. Tool blocks and groups activate on Enter/Space. Overlays trap focus and dismiss on Escape. Screen reader announcements fire on new messages.

## Must-Haves

- All interactive elements (tool headers, group headers, copy buttons, overlay items) have `role`, `tabindex`, and `aria-label`
- `aria-expanded` toggles in sync with expand/collapse state
- Arrow key navigation works in model picker, thinking picker, slash menu, and session history
- Dialogs have `role="dialog"`, `aria-modal="true"`, and focus trapping
- Session history panel has `role="complementary"` and `aria-label`
- Keyboard activation (Enter/Space) works for all `role="button"` elements
- Focus-visible styles cover all interactive elements
- Screen reader announcements via `announceToScreenReader()` for new messages
- Header toolbar has roving tabindex with arrow key navigation

## Verification

- `npx vitest run src/webview/__tests__/accessibility.test.ts` — 12 tests pass
- `npx vitest run` — all 140 tests pass (no regressions)
- Manual audit: grep confirms ARIA attributes present in renderer.ts, tool-grouping.ts, model-picker.ts, thinking-picker.ts, slash-menu.ts, ui-dialogs.ts, session-history.ts

## Tasks

- [x] **T01: Verify accessibility coverage and fill any remaining gaps** `est:30m`
  - Why: Research identified gaps in ARIA attributes and keyboard nav across rendered content and overlays. Previous slice work has already addressed most gaps — this task audits completeness and fills any remaining holes.
  - Files: `src/webview/renderer.ts`, `src/webview/tool-grouping.ts`, `src/webview/model-picker.ts`, `src/webview/thinking-picker.ts`, `src/webview/slash-menu.ts`, `src/webview/ui-dialogs.ts`, `src/webview/session-history.ts`, `src/webview/index.ts`, `src/webview/styles.css`, `src/webview/__tests__/accessibility.test.ts`
  - Do: Audit all interactive elements for ARIA attributes. Verify keyboard activation handlers exist. Confirm focus-visible CSS covers all interactive selectors. Fill any gaps found. Ensure all 12 accessibility tests pass.
  - Verify: `npx vitest run` — all tests pass, `grep -c "role=\|aria-" src/webview/*.ts` shows coverage across all overlay/renderer files
  - Done when: All interactive elements have proper ARIA attributes, keyboard nav works throughout, all tests pass

## Files Likely Touched

- `src/webview/renderer.ts`
- `src/webview/tool-grouping.ts`
- `src/webview/model-picker.ts`
- `src/webview/thinking-picker.ts`
- `src/webview/slash-menu.ts`
- `src/webview/ui-dialogs.ts`
- `src/webview/session-history.ts`
- `src/webview/index.ts`
- `src/webview/styles.css`
- `src/webview/__tests__/accessibility.test.ts`
