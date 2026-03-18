# S01: Auto-Mode Progress Widget

## Tasks

- [x] **T01: Protocol & types** `est:15min`
- [x] **T02: Extension-host auto-progress poller** `est:30min`
- [x] **T03: Webview auto-progress widget** `est:30min`
- [x] **T04: CSS & polish** `est:15min`
- [x] **T05: Bulletproof state detection & cleanup** `est:20min`
- [x] **T06: Tests & verification** `est:20min`

## Approach

### T01: Protocol & types
Add `auto_progress` message type to `ExtensionToWebviewMessage` in `shared/types.ts`. Define `AutoProgressData` interface with: phase, milestone info, slice info, task info, progress counts, elapsed time, cost, auto-mode state. Add `AutoProgressData` to `AppState` in `state.ts`.

### T02: Extension-host auto-progress poller
New class `AutoProgressPoller` in `src/extension/auto-progress.ts`. When auto-mode is detected (`autoModeState` is "auto"|"next"), starts polling every 3 seconds:
1. Calls `client.getState()` — gets current model, streaming state
2. Calls `buildDashboardData(cwd)` — gets milestone/slice/task progress from disk
3. Reads session stats for cost
4. Sends `auto_progress` message to webview

Key: poller starts when `setStatus` event sets `gsd-auto` to "auto"/"next", stops when set to undefined/paused or process exits. Multiple protection layers:
- `setStatus` events start/stop the poller
- Process exit handler clears poller
- Each poll checks `autoModeState` is still active before sending
- Poller sends `auto_progress: null` when stopping (clear signal to webview)

### T03: Webview auto-progress widget
New module `src/webview/auto-progress.ts`. Renders a sticky bar above the input area:
- Phase label (RESEARCH, PLAN, EXECUTE, COMPLETE)
- Current task: "T03: Webview auto-progress widget"
- Progress bar: tasks 2/6, slices 1/5
- Elapsed time: "4m 32s"
- Cost: "$0.42"
- Pulsing dot indicator (CSS animation — no polling needed)

Widget visibility controlled by `state.autoProgress` — when non-null, widget shows. When null, widget hides. Message handler sets `state.autoProgress` on `auto_progress` messages.

### T04: CSS & polish
Styled to match VS Code theme variables. Compact single-line when narrow, expands to two lines when wide. Smooth show/hide transitions.

### T05: Bulletproof state detection & cleanup
Defense in depth — widget MUST disappear when auto-mode ends:
1. `setStatus gsd-auto: undefined` → poller stops → sends `auto_progress: null` → widget hides
2. `process_exit` → poller stops → state cleared → widget hides
3. `agent_end` without auto-mode state → widget stays (auto-mode dispatches between agent turns)
4. `new_conversation` → poller stops → widget hides
5. Poller detects `autoModeState` is null during poll → sends null → stops itself
6. Widget has a 30s stale-data guard: if no `auto_progress` received for 30s, widget auto-hides

### T06: Tests & verification
Unit tests for:
- AutoProgressPoller lifecycle (start/stop/cleanup)
- Widget render logic (show/hide/data display)
- State detection edge cases (process exit during auto, rapid start/stop)
- Build verification (lint + compile)
