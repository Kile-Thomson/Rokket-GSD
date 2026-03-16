# S04: Workflow Visualizer Overlay

## Tasks

- [x] **T01: Visualizer overlay module** `est:40min`
- [x] **T02: Wire into message handler and index** `est:10min`
- [x] **T03: CSS for visualizer** `est:20min`
- [x] **T04: Tests & verification** `est:15min`

## Approach

### T01: Visualizer overlay module
New `src/webview/visualizer.ts`. Opens as a full-width panel that replaces chat content temporarily (same pattern as session history panel).

Sections:
1. **Header** — milestone title, auto-mode state, elapsed time
2. **Progress** — tasks/slices/milestones progress bars (reuses dashboard-parser data)
3. **Slice breakdown** — list of slices with completion status, active slice tasks
4. **Metrics** — cost, token usage from session stats
5. **Completed units** — timeline from auto_progress data

Opens via `/gsd visualize` command (send as prompt) or via a dedicated message. Closes on Escape or clicking "close".

Data source: requests `get_dashboard` message from extension host (existing mechanism). Also uses `state.autoProgress` for auto-mode specific data. Polls for refresh every 5s.

### T02: Wire into message handler and index
Add `show_visualizer` as a webview-level slash command. Import and init visualizer in index.ts.

### T03: CSS for visualizer
Full-page overlay styling, matching VS Code theme. Sections, progress bars, stats grid.

### T04: Tests & verification
Build, lint, test.
