# M014: gsd-pi 2.20–2.28 Feature Parity

**Gathered:** 2026-03-19
**Status:** Ready for planning

## Project Description

Bring the VS Code extension up to parity with gsd-pi releases v2.20.0 through v2.28.0. Nine CLI releases have shipped since M012 brought us to v2.19.0 parity.

## Why This Milestone

The CLI has added parallel orchestration, a validate-milestone phase, headless query, model selector grouping, HTML report export, and several new slash commands. Users running the latest CLI will see extension behavior that doesn't reflect these capabilities — stale progress displays during parallel execution, missing phase labels, and no way to trigger new commands.

## User-Visible Outcome

### When this milestone is complete, the user can:

- See parallel worker progress (multiple workers, per-worker phase/task, budget alerts at 80%) in the dashboard during parallel auto-mode
- See the `validate-milestone` phase rendered distinctly in the progress widget
- Use `/gsd update` and `/gsd export --html --all` from the slash menu
- Pick models grouped by provider in the model picker
- See when auto-mode pauses for slice discussion (`require_slice_discussion`)
- Get faster state reads via headless query when available
- Trigger HTML milestone report export

### Entry point / environment

- Entry point: VS Code extension (webview panel, slash menu, progress widget)
- Environment: local dev with gsd-pi ≥ 2.28.0
- Live dependencies involved: gsd-pi RPC subprocess

## Completion Class

- Contract complete means: unit tests verify parallel worker rendering, validate-milestone phase display, model grouping, new slash commands
- Integration complete means: extension works against gsd-pi 2.28.0 in a real auto-mode session with parallel workers
- Operational complete means: graceful degradation when running against older gsd-pi versions

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- During parallel auto-mode, the dashboard shows multiple workers with distinct progress and budget alert fires at 80%
- validate-milestone phase renders with a distinct label and icon in the progress widget
- All new slash commands execute and route correctly
- Model picker groups models by provider
- No regressions on existing auto-mode progress, visualizer, or capture features

## Risks and Unknowns

- Parallel worker state format — need to confirm how `.gsd/runtime/` exposes parallel worker state. Medium risk — may need to parse new file formats.
- headless query availability — the `gsd headless query` command may not be accessible from RPC mode. Low risk — can fall back to existing polling.
- Backward compatibility — older gsd-pi versions won't emit parallel worker data. Must degrade gracefully. Low risk.

## Existing Codebase / Prior Art

- `src/extension/auto-progress.ts` — current auto-mode progress polling from `.gsd/` files
- `src/extension/dashboard-parser.ts` — parses STATE.md, runtime files, metrics
- `src/extension/state-parser.ts` — parses STATE.md phase/milestone/slice state
- `src/webview/auto-progress.ts` — webview-side progress rendering
- `src/webview/visualizer.ts` — workflow visualizer overlay
- `src/webview/slash-menu.ts` — slash command menu with existing gsd subcommands
- `src/webview/model-picker.ts` — current model picker (flat list)
- `src/extension/rpc-client.ts` — RPC client with all current commands

## Scope

### In Scope

- Parallel worker progress display and budget alerts
- validate-milestone phase rendering
- New slash commands: `/gsd update`, `/gsd export --html --all`
- Model picker grouped by provider
- Slice discussion pause visibility
- HTML report export command
- headless query integration (if available via RPC)

### Out of Scope / Non-Goals

- Implementing parallel orchestration itself (CLI responsibility)
- Discord/Slack/Telegram remote questions UI
- Token optimization profile picker UI
- Worktree management UI
- Debug logging UI (`gsd --debug`)
- SQLite context store UI
- File watcher integration

## Technical Constraints

- Must degrade gracefully against gsd-pi < 2.20
- No new runtime dependencies
- Must pass existing test suite without regressions

## Integration Points

- gsd-pi RPC subprocess — same JSON-lines protocol, may have new event types for parallel workers
- `.gsd/runtime/` — may contain new file formats for parallel worker state
- `.gsd/STATE.md` — unchanged format, but new phase values

## Open Questions

- Does `gsd headless query` work via RPC or only as a standalone command? — Likely standalone only, may not be worth integrating
- What's the exact format of parallel worker state files? — Need to inspect `.gsd/runtime/` during a parallel session
