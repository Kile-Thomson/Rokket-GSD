# S04: Accessibility — ARIA & keyboard nav — Research

**Date:** 2026-03-14

## Summary

The codebase already has more ARIA coverage than the M008-RESEARCH audit suggested ("zero ARIA attributes" — actually 26 in index.ts). The header toolbar has proper `role="toolbar"`, all header buttons have `aria-label`, the messages container is `role="log"` with `aria-live="polite"`, and there's an `srAnnouncer` element with `announceToScreenReader()` helper. Focus-visible styles exist for buttons, copy buttons, and the scroll FAB.

The gaps are in **dynamically rendered content** and **overlay components**. The renderer (`renderer.ts`) produces zero ARIA attributes — tool blocks are clickable divs without `role="button"` or `tabindex`, copy buttons lack `aria-label`, and the copy-response button has no label. Overlay components (model-picker, thinking-picker, slash-menu, ui-dialogs) have no ARIA roles, no keyboard navigation, and no focus trapping. Session history has keyboard handling but no ARIA roles.

The scope is well-bounded: add ARIA to rendered content, add keyboard nav to overlays, and ensure focus management follows WAI-ARIA patterns for dialogs and listboxes.

## Recommendation

Work in three layers:

1. **Renderer ARIA** — Add `role="button"`, `tabindex="0"`, `aria-label`, and `aria-expanded` to tool block headers, copy buttons, and group headers. This is HTML string changes in `renderer.ts` and `tool-grouping.ts`.

2. **Overlay accessibility** — Model picker and thinking picker should be `role="listbox"` with `role="option"` items and arrow key navigation. Slash menu similarly. UI dialogs should be `role="dialog"` with `aria-modal="true"` and focus trapping. Session history panel needs `role="dialog"` or `role="complementary"`.

3. **Keyboard navigation** — Header toolbar needs arrow key nav between buttons (WAI-ARIA toolbar pattern). Message actions need tab stops. Global Escape handling already exists for overlays — extend it.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Focus trap in dialogs | WAI-ARIA dialog pattern (first/last element cycling) | Standard, simple to implement in vanilla JS — ~20 lines |
| Screen reader announcements | Existing `announceToScreenReader()` in index.ts | Already wired up with sr-only element and rAF debounce |
| Focus-visible styles | Existing CSS rules at line 3283 in styles.css | Already covers `.gsd-action-btn`, `.gsd-copy-btn`, `.gsd-scroll-fab` |

## Existing Code and Patterns

- `src/webview/index.ts:264-269` — `announceToScreenReader()` helper, reuse for new announcements (tool completion, message arrival)
- `src/webview/index.ts:107-151` — Header HTML template with solid ARIA pattern to follow for new elements
- `src/webview/index.ts:749-764` — Global keydown handler for overlays, extend for new keyboard shortcuts
- `src/webview/index.ts:788-794` — Version badge keyboard activation pattern (`Enter`/`Space` → click), replicate for other non-button interactive elements
- `src/webview/session-history.ts:102` — `handleKeyDown()` for arrow nav in list, extend pattern to pickers
- `src/webview/styles.css:3283-3289` — Focus-visible outline rules, extend selector list for new interactive elements
- `src/webview/renderer.ts:458-464` — Tool block HTML template, needs `role`/`tabindex`/`aria-expanded` additions
- `src/webview/tool-grouping.ts` — Group headers need same treatment as tool blocks

## Constraints

- Vanilla DOM only — no framework helpers for focus management
- HTML is generated as strings in renderer.ts (template literals), not DOM API — ARIA must be inline in the HTML strings
- Tool blocks toggle via click handlers delegated on `messagesContainer` (event delegation pattern in index.ts) — keyboard activation must hook into same delegation
- VS Code webview CSP prevents inline event handlers — all JS must be in the bundled script
- `retainContextWhenHidden: true` means overlay state persists — focus must be restored correctly when panel regains visibility

## Common Pitfalls

- **Forgetting `aria-expanded` updates on toggle** — Tool blocks and groups expand/collapse via CSS class. The `aria-expanded` attribute must be toggled in the same click handler that toggles the class.
- **Focus trap escaping on Tab** — Dialog focus traps need both Tab and Shift+Tab handling. Missing Shift+Tab lets focus escape backwards.
- **Stale aria-live announcements** — The existing `announceToScreenReader` uses rAF to clear then set text. Rapid successive calls can clobber. Use it sparingly (message arrival, not every segment).
- **roving tabindex vs tabindex="0" on all items** — Toolbar buttons should use roving tabindex (only active item has tabindex="0", others have tabindex="-1") for proper arrow key nav. Don't put tabindex="0" on every button.

## Open Risks

- **Tool block keyboard nav at scale** — A conversation with 50+ tool blocks means 50+ tab stops. May need a skip-to-next-message shortcut or group-level tabbing only.
- **Slash menu is a custom autocomplete** — WAI-ARIA combobox pattern is complex. May need to scope to basic listbox behavior and note full combobox as future work.
- **Model/thinking picker dismiss behavior** — Currently dismiss on Escape but focus doesn't return to the trigger button. Need to track and restore focus origin.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| VS Code Extension | N/A | No specific accessibility skill found — WAI-ARIA patterns are standard web |

## Sources

- WAI-ARIA Authoring Practices are the reference for toolbar, dialog, and listbox patterns (source: [W3C APG](https://www.w3.org/WAI/ARIA/apg/))
- Existing codebase audit via grep — 26 ARIA attributes in index.ts, 0 in renderer/overlays
