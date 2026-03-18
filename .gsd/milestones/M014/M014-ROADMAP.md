# M014: gsd-pi 2.20–2.28 Feature Parity

**Vision:** Bring the VS Code extension to full parity with gsd-pi v2.20–v2.28, covering parallel worker visibility, new dispatch phases, model picker improvements, and missing slash commands.

## Success Criteria

- During parallel auto-mode, the dashboard shows per-worker progress (phase, task, cost) and a budget alert fires at 80% threshold
- The `validate-milestone` phase renders with a distinct label and icon in the progress widget
- `/gsd update` and `/gsd export --html --all` are accessible from the slash menu and execute correctly
- The model picker groups models by provider with section headers
- When auto-mode pauses for slice discussion, the progress widget shows a clear "Awaiting Discussion" state
- HTML report export is available as a VS Code command
- No regressions on existing auto-mode progress, visualizer, capture, or model routing features

## Key Risks / Unknowns

- Parallel worker state format — need to confirm how `.gsd/runtime/` exposes per-worker state and whether RPC `get_state` includes worker data. Medium risk — may need to parse new file formats or add new RPC commands.
- `require_slice_discussion` signaling — unclear whether this emits a distinct RPC event or just a phase change in STATE.md. Low risk — can detect from phase string.

## Proof Strategy

- Parallel worker format → retire in S01 by proving the extension can parse and render multi-worker state from `.gsd/runtime/` or RPC
- Discussion pause detection → retire in S03 by proving the progress widget shows the correct state when auto-mode pauses for discussion

## Verification Classes

- Contract verification: unit tests for parallel worker rendering, validate-milestone phase label, model grouping logic, new slash command routing
- Integration verification: manual test with gsd-pi 2.28.0 — parallel auto-mode, model switching, slash commands
- Operational verification: graceful degradation when running against gsd-pi < 2.20 (no crashes, features silently absent)
- UAT / human verification: visual check of parallel worker dashboard, model picker grouping, validate-milestone progress display

## Milestone Definition of Done

This milestone is complete only when all are true:

- All slice deliverables are complete
- Parallel worker progress renders correctly during parallel auto-mode
- validate-milestone phase displays distinctly in progress widget
- All new slash commands work
- Model picker groups by provider
- Discussion pause is visible in progress widget
- No regressions in existing tests
- Success criteria re-checked against live gsd-pi 2.28.0

## Requirement Coverage

- Covers: gsd-pi 2.20–2.28 user-facing feature parity
- Leaves for later: remote questions UI (Discord/Slack/Telegram), token profile picker, worktree management UI, debug logging UI, SQLite context store UI

## Slices

- [x] **S01: Parallel Worker Progress & Budget Alerts** `risk:high` `depends:[]`
  > After this: during parallel auto-mode, the progress widget shows multiple workers with per-worker phase, task name, and cost. A budget alert toast fires when any worker exceeds 80% of its budget. Graceful degradation when no parallel data is present.

- [x] **S02: Validate-Milestone Phase & New Slash Commands** `risk:low` `depends:[]`
  > After this: the progress widget renders `validate-milestone` with a distinct label and checkmark icon. `/gsd update` and `/gsd export --html --all` appear in the slash menu and execute. HTML report export is available as a `gsd.exportReport` VS Code command.

- [ ] **S03: Model Picker Grouping & Discussion Pause** `risk:medium` `depends:[]`
  > After this: the model picker shows models grouped under provider section headers instead of a flat list. When `require_slice_discussion` pauses auto-mode, the progress widget shows "Awaiting Discussion" with a prompt to use `/gsd discuss`.

## Boundary Map

### S01

Produces:
- `AutoProgressData.workers` field: `Array<{ id: string; phase: string; task: string | null; cost?: number; budgetPercent?: number }>` or null
- `AutoProgressData.budgetAlert` field: boolean flag when any worker exceeds 80%
- Webview rendering for parallel worker cards in progress widget

Consumes:
- Existing `dashboard-parser.ts` and `auto-progress.ts` polling infrastructure
- `.gsd/runtime/` parallel worker state files (format TBD from gsd-pi source)

### S02

Produces:
- Phase label mapping: `validate-milestone` → "Validating Milestone" with checkmark icon
- Two new slash menu entries and one new VS Code command
- `gsd.exportReport` command registration

Consumes:
- Existing `slash-menu.ts` command list
- Existing `auto-progress.ts` phase rendering

### S03

Produces:
- Grouped model picker rendering with provider section headers
- Discussion-pause detection in auto-progress poller
- "Awaiting Discussion" progress widget state

Consumes:
- Existing `model-picker.ts` rendering
- Existing `auto-progress.ts` state detection
- RPC `get_available_models` response (already has `provider` field)
