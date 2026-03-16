# M012: gsd-pi 2.13–2.19 Feature Parity & Auto-Mode Visibility

**Vision:** Eliminate the "hung" appearance during auto-mode dispatch, surface dynamic model routing visually, and bring the extension up to parity with gsd-pi 2.19.0 features.

## Success Criteria

- During auto-mode dispatch, a progress widget shows: current task name, phase label, progress bar (tasks/slices), elapsed time, and cost — updated every 2–5 seconds
- When dynamic model routing switches models, the header badge updates within 3 seconds and a brief visual indicator (flash or toast) makes the switch obvious
- `/gsd capture` sends the capture, and a pending capture badge appears in the dashboard
- A workflow visualizer overlay shows milestone/slice/task progress, completed units, and cost metrics
- All new slash commands (steer, knowledge, config, capture, visualize) are accessible and execute
- No regressions — existing tests pass, no new error states or hangs

## Key Risks / Unknowns

- Auto-mode progress data — RPC mode drops widget factory functions. Must poll `get_state` and parse `.gsd/` files from extension host to reconstruct progress. Medium risk — approach is proven (dashboard-parser already does this), but polling interval and data freshness need tuning.
- Model routing detection latency — no explicit "model_changed" RPC event. Comparing `get_state` responses at intervals introduces up to N seconds of lag. Low risk — 2–3s polling is acceptable.

## Proof Strategy

- Progress data availability → retire in S01 by proving the extension can poll and render live auto-mode progress from `.gsd/` file state
- Model detection latency → retire in S02 by proving model badge updates within 3s of a routing change

## Verification Classes

- Contract verification: unit tests for progress widget rendering, model change detection, capture badge logic
- Integration verification: manual test with gsd-pi 2.19.0 in auto-mode — verify progress updates, model routing visibility, capture flow
- Operational verification: verify no hangs, no error states, graceful degradation when `.gsd/` files don't exist
- UAT / human verification: visual check of progress widget, model flash, visualizer overlay

## Milestone Definition of Done

This milestone is complete only when all are true:

- All slice deliverables are complete
- Auto-mode dispatch shows live progress (not blank/hung)
- Model routing changes are visually obvious in real-time
- Capture command works and badge shows count
- Visualizer overlay renders with real data
- All new slash commands work
- No regressions in existing tests
- Success criteria re-checked against live gsd-pi 2.19.0

## Requirement Coverage

- Covers: gsd-pi 2.13–2.19 user-facing feature parity, auto-mode UX
- Leaves for later: worktree UI, Discord/Slack integration, budget enforcement UI, token profile picker

## Slices

- [x] **S01: Auto-Mode Progress Widget** `risk:high` `depends:[]`
  > After this: during auto-mode dispatch, the chat panel shows a live progress widget with current task, phase, progress bars, elapsed time, and cost — polled from `.gsd/` files every 3 seconds. The "hung" appearance is eliminated.

- [x] **S02: Dynamic Model Routing Display** `risk:medium` `depends:[]`
  > After this: when gsd-pi routes to a different model mid-task, the header model badge updates within 3 seconds, flashes briefly, and a toast announces the switch with the reason.

- [x] **S03: Mid-Execution Capture & Badge** `risk:medium` `depends:[]`
  > After this: `/gsd capture` sends capture text during auto-mode, and the dashboard shows a pending capture count badge. Triage responses are handled inline.

- [x] **S04: Workflow Visualizer Overlay** `risk:medium` `depends:[S01]`
  > After this: `/gsd visualize` opens a full-width overlay in the chat panel showing milestone progress, slice/task breakdown, completed units timeline, and cost/usage metrics — data sourced from dashboard-parser infrastructure built in S01.

- [x] **S05: Slash Menu & Command Parity** `risk:low` `depends:[]`
  > After this: all new gsd-pi 2.13–2.19 commands are accessible in the slash menu (steer, knowledge, config, capture, visualize). Hardcoded subcommand list is updated. Commands execute correctly.

## Boundary Map

### S01

Produces:
- `AutoProgressPoller` in extension host — polls `get_state` + parses `.gsd/` files on interval, sends `auto_progress` messages to webview
- `auto_progress` message type in protocol (`ExtensionToWebviewMessage`)
- Auto-progress widget component in webview — renders progress bar, task info, phase, elapsed time, cost
- CSS for progress widget

Consumes:
- nothing (first slice, extends existing dashboard-parser and polling infrastructure)

### S01 → S04

Produces:
- Shared dashboard-parser utilities for progress data extraction
- `auto_progress` message format that visualizer can also consume

### S02

Produces:
- Model change detection in extension host (compare `get_state` model on interval)
- `model_routed` webview message type
- Header badge flash animation (CSS)
- Model routing toast notification

Consumes:
- nothing (independent, extends existing model badge and toast infrastructure)

### S03

Produces:
- `/gsd capture` sends prompt to RPC
- `capture_badge` message type — pending capture count
- Dashboard badge rendering

Consumes:
- nothing (independent, extends existing slash menu and dashboard)

### S04

Produces:
- Visualizer overlay panel — full-width panel replacing chat content temporarily
- Progress tab, metrics tab, completed units list
- `/gsd visualize` command integration

Consumes:
- S01's dashboard-parser utilities and `auto_progress` data format

### S05

Produces:
- Updated slash menu with new commands
- No new UI — commands execute as prompts

Consumes:
- nothing (independent)
