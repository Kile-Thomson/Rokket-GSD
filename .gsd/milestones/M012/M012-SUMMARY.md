---
status: complete
started: 2026-03-17
completed: 2026-03-17
---

# M012 Summary: gsd-pi 2.13–2.19 Feature Parity & Auto-Mode Visibility

## Outcome

The VS Code extension now provides visual feedback during auto-mode dispatch, surfaces dynamic model routing changes, supports mid-execution captures, includes a workflow visualizer overlay, and has all new gsd-pi 2.13–2.19 commands accessible from the slash menu.

## Slices Completed

### S01: Auto-Mode Progress Widget
Live progress bar (sticky above input) during auto-mode. Polls `get_state` + `.gsd/` files every 3s. Shows phase, task info, progress bars, elapsed time, cost, and model. 6-layer state detection ensures reliable show/hide.

### S02: Dynamic Model Routing Display
When gsd-pi switches models mid-task, the model badge flashes (CSS animation) and a toast announces the change. Detection via `AutoProgressPoller` comparing `get_state` responses.

### S03: Mid-Execution Capture & Badge
Parses `.gsd/CAPTURES.md` for pending capture count, shows "📌 N" badge in the auto-progress widget. `/gsd capture` flows through pi naturally.

### S04: Workflow Visualizer Overlay
Full-page overlay (`/gsd visualize`) with two tabs: Progress (milestone header, progress bars, slice breakdown, task list, registry, blockers, next action) and Metrics (cost, tool calls, user turns, model, token breakdown, context usage). Auto-refreshes every 5s.

### S05: Slash Menu & Command Parity
Added `steer`, `knowledge`, `config`, `capture`, `visualize` to the slash menu. `visualize` is intercepted locally as a webview command.

## Files Changed

### New files (4)
- `src/extension/auto-progress.ts` — AutoProgressPoller (polls + sends progress data)
- `src/extension/captures-parser.ts` — Parses CAPTURES.md for pending count
- `src/webview/auto-progress.ts` — Auto-progress widget renderer
- `src/webview/visualizer.ts` — Workflow visualizer overlay module

### New tests (3)
- `src/webview/__tests__/auto-progress.test.ts` — 19 tests
- `src/extension/captures-parser.test.ts` — 5 tests
- `src/webview/__tests__/visualizer.test.ts` — 18 tests

### Modified files (8)
- `src/shared/types.ts` — AutoProgressData, auto_progress/model_routed message types
- `src/webview/state.ts` — autoProgress/autoProgressLastUpdate state fields
- `src/extension/webview-provider.ts` — Poller lifecycle, event forwarding
- `src/webview/message-handler.ts` — auto_progress, model_routed, dashboard_data routing
- `src/webview/index.ts` — Module imports/init, /gsd visualize interception
- `src/webview/keyboard.ts` — Visualizer escape handler
- `src/webview/slash-menu.ts` — 5 new gsd subcommands
- `src/webview/styles.css` — ~600 lines for auto-progress widget + visualizer overlay

## Verification
- Build: clean (extension 113.8KB, webview 300.9KB)
- Lint: clean
- Tests: 251 passing (42 new), 0 failures
- No regressions
