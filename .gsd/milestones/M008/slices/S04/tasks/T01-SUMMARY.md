---
id: T01
parent: S04
milestone: M008
provides:
  - ARIA attributes on all rendered tool block headers, group headers, and copy buttons
  - Keyboard activation (Enter/Space) for tool blocks and group headers
  - Roving tabindex on header toolbar with arrow key navigation
  - aria-expanded toggling on expand/collapse
  - Focus-visible CSS for new interactive elements
key_files:
  - src/webview/renderer.ts
  - src/webview/tool-grouping.ts
  - src/webview/index.ts
  - src/webview/styles.css
  - src/webview/helpers.ts
key_decisions:
  - Used event delegation on messagesContainer for keyboard activation rather than per-element listeners — consistent with existing click delegation pattern
  - Used native <details> toggle event (with capture) to sync aria-expanded on group headers rather than intercepting clicks
patterns_established:
  - role="button" + tabindex="0" + aria-label + aria-expanded pattern for collapsible headers
  - Roving tabindex pattern on toolbar with ArrowLeft/Right/Home/End
observability_surfaces:
  - aria-expanded attributes reflect current open/close state in DOM
  - Focus-visible outlines show keyboard navigation state
duration: 25min
verification_result: passed
completed_at: 2026-03-14
blocker_discovered: false
---

# T01: Add ARIA attributes and keyboard activation to rendered content

**Added role="button", tabindex, aria-label, and aria-expanded to all tool block headers, group headers, and copy buttons. Wired keyboard activation and roving tabindex on the header toolbar.**

## What Happened

Added ARIA attributes in five areas:

1. **renderer.ts** — Tool block headers get `role="button"`, `tabindex="0"`, `aria-label="Toggle {toolName} details"`, `aria-expanded`. Copy-response button gets `aria-label="Copy response"` and `aria-hidden="true"` on its SVG. Error fallback tool headers also get full ARIA treatment.
2. **tool-grouping.ts** — Streaming group creation (`collapseToolIntoGroup`) adds same ARIA pattern to dynamically created group headers.
3. **renderer.ts** (group HTML) — Static `buildToolGroupHtml` group headers get `role="button"`, `tabindex="0"`, `aria-label`, `aria-expanded`.
4. **helpers.ts** — Code block copy button gets `aria-label="Copy code"`.
5. **index.ts** — Click handler for tool headers now toggles `aria-expanded`. Keyboard activation via Enter/Space delegated on `messagesContainer`. Toggle event listener syncs `aria-expanded` on `<details>` group elements. Roving tabindex on header toolbar with ArrowLeft/Right/Home/End.
6. **styles.css** — Extended focus-visible rules to cover `[role="button"]` tool headers, group headers, and copy-response buttons.

## Verification

- `npx vitest run` — all 128 tests pass (6 test files)
- `grep -cE 'role=|aria-|tabindex' src/webview/renderer.ts` → 5 (meets 5+ threshold)
- `grep -cE 'role=|aria-|tabindex' src/webview/tool-grouping.ts` → 1 (single line has 4 attrs; T02 will add more lines to meet slice-level 5+ target)
- Slice-level verification partial: renderer ✓, tool-grouping partial (line count 1 vs 5+ target — T02 scope), overlay files not yet touched (T02 scope)

## Diagnostics

- Inspect `aria-expanded` on `.gsd-tool-header` elements to verify expand/collapse state tracking
- Tab into header toolbar and use arrow keys to verify roving tabindex — only focused button should have `tabindex="0"`
- Enter/Space on tool headers and group headers should trigger click via delegation

## Deviations

- Also added `aria-label="Copy code"` to code block copy button in `helpers.ts` (not listed in task plan as a file but required for complete copy button coverage)
- Added `aria-hidden="true"` to copy-response button SVG icon (accessibility best practice, not in plan)

## Known Issues

None.

## Files Created/Modified

- `src/webview/renderer.ts` — ARIA attributes on tool block headers, group headers, copy-response button
- `src/webview/tool-grouping.ts` — ARIA attributes on streaming group headers
- `src/webview/helpers.ts` — aria-label on code block copy button
- `src/webview/index.ts` — aria-expanded toggling, keyboard activation, roving tabindex
- `src/webview/styles.css` — Extended focus-visible selectors
