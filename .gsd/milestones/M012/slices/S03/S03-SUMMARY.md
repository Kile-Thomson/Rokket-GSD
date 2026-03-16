---
status: complete
started: 2026-03-17
completed: 2026-03-17
---

# S03 Summary: Mid-Execution Capture & Badge

## What was built

Pending capture count badge in the auto-progress widget, sourced from `.gsd/CAPTURES.md`.

### New files
- `src/extension/captures-parser.ts` — `countPendingCaptures(cwd)` reads CAPTURES.md and counts entries with `**Status:** pending`
- `src/extension/captures-parser.test.ts` — 5 unit tests for parser

### Modified files
- `src/shared/types.ts` — Added `pendingCaptures` to `AutoProgressData`
- `src/extension/auto-progress.ts` — Poller reads capture count during each poll
- `src/webview/auto-progress.ts` — Renders "📌 N" badge when captures > 0
- `src/webview/styles.css` — Yellow-styled captures badge

### How `/gsd capture` works
User types `/gsd capture <text>` → sent as a prompt to pi → pi extension stores it in `.gsd/CAPTURES.md` → extension host reads the count every 3s during auto-mode → badge appears in progress widget.

## Verification
- Build: clean
- Lint: clean
- Tests: 24 new tests passing (19 auto-progress widget + 5 captures parser)
