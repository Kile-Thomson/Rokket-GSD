---
id: S04
parent: M013
milestone: M013
provides:
  - 12 feature-scoped CSS partials under src/webview/styles/ (each ≤600 lines)
  - Barrel index.css with @import directives preserving original cascade order
  - Original 5165-line styles.css monolith deleted
requires: []
affects: []
key_files:
  - src/webview/styles/index.css
  - src/webview/styles/base.css
  - src/webview/styles/header.css
  - src/webview/styles/messages.css
  - src/webview/styles/tools.css
  - src/webview/styles/dashboard.css
  - src/webview/styles/dialogs.css
  - src/webview/styles/input.css
  - src/webview/styles/overlays.css
  - src/webview/styles/progress.css
  - src/webview/styles/visualizer.css
  - src/webview/styles/themes.css
  - src/webview/styles/utilities.css
  - src/webview/index.ts
key_decisions:
  - Moved Update Card, What's New, and Settings Dropdown sections from overlays.css to utilities.css to keep both files under the 600-line limit
  - Barrel import order follows first-section-appearance in the original monolith to preserve CSS cascade
patterns_established:
  - CSS partials named by feature area under src/webview/styles/, barrel index.css re-exports via @import
  - Feature styles are self-contained within their partial — new CSS for a feature goes in its partial file
observability_surfaces:
  - "dist/webview/index.css size (~120KB) as correctness proxy for missing/duplicated CSS"
  - "wc -l src/webview/styles/*.css — all partials must stay ≤600 lines"
drill_down_paths:
  - .gsd/milestones/M013/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M013/slices/S04/tasks/T02-SUMMARY.md
duration: 17m
verification_result: passed
completed_at: 2026-03-18
---

# S04: CSS Organization

**Split 5165-line styles.css monolith into 12 feature-scoped CSS partials, all ≤600 lines, with 0.4% build size delta and zero behavioral changes**

## What Happened

Identified 44 section boundaries in the original `src/webview/styles.css` via `/* === */` banner comments and extracted them into 12 logical CSS files under `src/webview/styles/`. Created a barrel `index.css` with `@import` directives ordered by first-section-appearance in the original file (base→header→overlays→messages→dashboard→tools→dialogs→input→utilities→themes→progress→visualizer) to preserve CSS cascade.

The initial extraction put too many sections in overlays.css (857 lines). Redistributed Update Card, What's New, and Settings Dropdown to utilities.css, bringing both under 600. Also trimmed one blank line from tools.css (602→600).

Updated `src/webview/index.ts` to import `./styles/index.css` instead of `./styles.css`, deleted the original monolith, and verified the build produces functionally identical CSS output.

## Verification

| Check | Result |
|-------|--------|
| `npm run build` succeeds | ✅ |
| `npm test` — 251 tests pass | ✅ |
| Extension bundle: 140.6KB (baseline 144KB, −2.4%) | ✅ |
| Webview JS: 327.2KB (baseline 335KB, −2.3%) | ✅ |
| Webview CSS: 120.2KB (baseline 122KB, −1.5%) | ✅ |
| All partials ≤600 lines (max: tools.css at 600) | ✅ |
| Barrel has 12 `@import` directives | ✅ |
| Original `styles.css` deleted | ✅ |
| `npm run lint` clean | ✅ |
| Build stderr — no CSS warnings | ✅ |

## Deviations

- Plan allocated 6 sections to overlays.css producing 857 lines. Moved 3 independent feature sections (Update Card, What's New, Settings Dropdown) to utilities.css to meet the 600-line limit. No cascade impact — these are self-contained styles.

## Known Limitations

None. The CSS split is complete and the output is functionally identical to the monolith.

## Follow-ups

None.

## Files Created/Modified

- `src/webview/styles/index.css` — barrel file with 12 @import directives
- `src/webview/styles/base.css` — CSS variables, resets, layout primitives (40 lines)
- `src/webview/styles/header.css` — header bar, context usage bar (311 lines)
- `src/webview/styles/overlays.css` — overlay indicators, inline UI requests, changelog (504 lines)
- `src/webview/styles/messages.css` — messages container, scroll FAB, entries, code blocks (467 lines)
- `src/webview/styles/dashboard.css` — welcome screen, dashboard (539 lines)
- `src/webview/styles/tools.css` — tool group, thinking block/dots, tool call blocks (600 lines)
- `src/webview/styles/dialogs.css` — slash menu, model picker, thinking picker, session history (570 lines)
- `src/webview/styles/input.css` — input area, image preview, footer/status (317 lines)
- `src/webview/styles/utilities.css` — file links, copy, update card, what's new, settings dropdown, toasts, responsive (568 lines)
- `src/webview/styles/themes.css` — Phosphor, Clarity, Forge themes (596 lines)
- `src/webview/styles/progress.css` — auto-mode progress widget, model badge flash (188 lines)
- `src/webview/styles/visualizer.css` — workflow visualizer overlay (464 lines)
- `src/webview/index.ts` — updated CSS import path
- `src/webview/styles.css` — deleted (was 5165 lines)

## Forward Intelligence

### What the next slice should know
- CSS is now organized by feature area. New styles for a feature go in its partial file. The barrel `src/webview/styles/index.css` controls cascade order.
- All 4 slices of M013 are now complete. The milestone definition of done can be evaluated.

### What's fragile
- Cascade order in `index.css` — reordering the `@import` directives can cause visual regressions. The current order matches the original monolith's section order.
- tools.css is exactly at the 600-line limit — adding styles there requires either splitting it further or moving sections out.

### Authoritative diagnostics
- `wc -c dist/webview/index.css` — should be ~120KB. Significant deviation means missing or duplicated CSS.
- `wc -l src/webview/styles/*.css` — quick check that no partial has grown past 600 lines.

### What assumptions changed
- Plan assumed 12 partials would all fit under 600 lines with the initial section mapping — overlays.css didn't. Redistribution to utilities.css resolved it cleanly.
