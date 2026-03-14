# M005: UI Interactions & Polish — Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

## Project Description

Rokket GSD VS Code extension — AI coding agent chat panel running inside VS Code sidebar/tab.

## Why This Milestone

Three UX pain points and a general visual quality gap:
1. **Thinking level cycling is blind** — clicking the badge cycles through 6 levels sequentially with no visibility into what's available or where you are in the cycle. Models that don't support thinking still show the badge.
2. **No way to delete the current session** — the delete button only appears on non-current sessions, so history accrues permanently unless you switch away first.
3. **The UI is functional but not polished** — header badges are plain text, stats are buried in a dense footer, there's no visual feedback on context pressure, and tool execution lacks presence.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Click the thinking badge to open a dropdown showing all available levels for the current model, with the active level highlighted
- See the thinking dropdown disabled/hidden when the model doesn't support reasoning
- Delete any session from history, including the current one (which auto-creates a new session)
- See context usage as a visual progress bar with color-coded pressure zones
- See session cost and token stats presented cleanly in an accessible stats summary
- Experience smoother panel transitions, refined tool call animations, and tighter header layout

### Entry point / environment

- Entry point: VS Code extension sidebar panel or editor tab
- Environment: VS Code with GSD (gsd-pi) installed
- Live dependencies involved: gsd --mode rpc subprocess

## Completion Class

- Contract complete means: all UI changes render correctly in Extension Development Host
- Integration complete means: thinking dropdown correctly reflects model capabilities via RPC, delete-current-session creates new session via RPC
- Operational complete means: none

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Thinking dropdown shows correct levels for a reasoning model (e.g. Claude Sonnet 4), correctly dims for a non-reasoning model
- Delete current session in history panel → conversation clears and a fresh session starts
- Context bar visually reflects token pressure at 30%, 70%, 90% usage levels
- All panels (thinking, model picker, history) open/close smoothly with no layout jank

## Risks and Unknowns

- Available thinking levels per model aren't currently exposed to the webview — need to either add an RPC call or derive from `reasoning` boolean on model info
- Context bar needs accurate contextPercent data — already available via session stats polling

## Existing Codebase / Prior Art

- `src/webview/model-picker.ts` — overlay panel pattern to follow for thinking dropdown
- `src/webview/session-history.ts` — existing delete for non-current sessions, needs extension
- `src/webview/state.ts` — `AvailableModel.reasoning` field, `thinkingLevel` state
- `src/webview/index.ts` — header badge rendering, thinking click handler
- `src/shared/types.ts` — `ThinkingLevel` type, message protocol

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions.

## Scope

### In Scope

- Thinking level dropdown picker (replaces cycling)
- Model-aware thinking level availability
- Delete current session (with new-conversation fallback)
- Context usage progress bar
- Session stats presentation improvements
- Header layout refinement
- Panel transition animations
- Tool call running state visual refinement

### Out of Scope / Non-Goals

- Test suite (that's M005→M006)
- New features (fork, permissions, etc.)
- Changes to the RPC protocol or backend agent

## Technical Constraints

- Must use VS Code CSS variables for theme compatibility
- Vanilla DOM only (no framework — Decision #1)
- Must work in both sidebar and editor tab panels
- No external font loading (CSP restrictions in webview)

## Integration Points

- gsd --mode rpc — `set_thinking_level` RPC for direct level setting, `get_state` for model info with `reasoning` field
- Session stats polling — already provides contextPercent, cost, tokens
