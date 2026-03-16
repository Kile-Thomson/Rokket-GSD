# S03: Loading States & Async UX — Research

**Date:** 2026-03-14

## Summary

This slice's scope is largely already implemented. The codebase audit reveals that all three async loading flows (dashboard, changelog, model picker) already have loading spinner HTML and corresponding CSS styles. Code block copy buttons are already hidden during streaming via a CSS class toggle (`streaming` on the assistant entry element).

The remaining work is minimal — primarily verification that the existing spinners render correctly, and potentially minor polish. The roadmap description ("Changelog fetch, dashboard load, and model picker show spinners while loading. Code blocks hide Copy button until streaming completes.") describes behavior that already exists in the codebase.

## Recommendation

Verify the existing loading states work end-to-end visually. If they do, this slice is essentially a verification-only pass. If any gaps are found during visual testing, address them. The main risk is that the spinner CSS was added but never visually verified — there could be subtle rendering issues.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Spinner animation | `gsd-spinner` class + `gsd-spin` keyframe (styles.css:3313-3324) | Already themed with VS Code variables |
| Tool spinner | `gsd-tool-spinner` class (styles.css:1516-1528) | Smaller variant for inline use |
| Copy button gating | `.streaming .gsd-copy-btn { display: none }` (styles.css:3296-3298) | CSS-only, no JS needed |

## Existing Code and Patterns

- `src/webview/index.ts:618-622` — Dashboard loading: creates div with `gsd-loading-spinner` class, posts `get_dashboard` message
- `src/webview/index.ts:778-784` — Changelog loading: creates div with `gsd-loading-spinner` class, posts `get_changelog` message
- `src/webview/model-picker.ts:60-64` — Model picker: renders `gsd-tool-spinner` with "Loading models…" when model list is empty
- `src/webview/renderer.ts:72` — Adds `streaming` class to assistant entries during streaming
- `src/webview/renderer.ts:209` — Removes `streaming` class when turn completes
- `src/webview/renderer.ts:324-335` — Copy button only rendered when `turn.isComplete` is true
- `src/webview/styles.css:3296-3298` — CSS hides `.gsd-copy-btn` inside `.streaming` entries
- `src/webview/styles.css:3304-3324` — Loading spinner CSS (`.gsd-loading-spinner`, `.gsd-spinner`, `@keyframes gsd-spin`)

## Constraints

- Vanilla DOM, no framework (Decision #1)
- Spinner CSS must use VS Code theme variables for consistency across light/dark themes
- `streaming` class toggle is the only mechanism for gating UI during active streaming — no per-code-block completion tracking exists

## Common Pitfalls

- **Duplicate keyframe names** — `@keyframes spin` (line 1526) and `@keyframes gsd-spin` (line 3322) both exist. If both are loaded, the unprefixed one could collide with other extensions. Stick with `gsd-spin`.
- **Loading div not replaced on response** — Dashboard and changelog handlers must remove/replace the loading spinner div when data arrives. Verify `renderDashboard` and `showChangelog` handle this correctly (dashboard: line 1199 removes existing `.gsd-dashboard`; changelog should do similar).

## Open Risks

- **Spinner may never have been visually tested** — CSS was added but no test or screenshot confirms it renders correctly. The `gsd-spinner` class relies on border animation which can be invisible if border colors don't contrast with background.
- **Changelog loading replacement** — Need to verify `showChangelog` properly replaces the loading spinner element. Dashboard does this via `.gsd-dashboard` class removal, but changelog flow needs checking.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| VS Code Extension | — | No specialized skill needed — patterns already established |

## Sources

- All findings from direct codebase analysis (rg, read)
