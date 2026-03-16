# M011: Codebase Quality & Robustness

**Gathered:** 2026-03-15
**Status:** Ready for planning

## Project Description

Rokket GSD VS Code extension — a full chat UI wrapping the gsd-pi coding agent via JSON-RPC over stdin/stdout. ~14K lines of TypeScript across extension host (RPC client, process management, file parsers) and webview (vanilla DOM chat UI with streaming, tool rendering, session management).

## Why This Milestone

A full line-by-line audit found 15 concrete issues: a CI-blocking lint error, type safety gaps where the compiler can't enforce message contracts, unhandled pi events that leave users in the dark when models fail, dead code adding maintenance weight, a cross-platform bug in HTML export, and architectural patterns (2170-line god class, 15 parallel Maps for session state) that make the codebase harder to maintain safely. None of these are user-reported bugs yet, but they're the kind of technical debt that causes bugs later.

## User-Visible Outcome

### When this milestone is complete, the user can:

- See a friendly message when all fallback models fail (instead of silence)
- Export conversations on macOS/Linux (currently Windows-only)
- Experience the same reliability with cleaner internal code paths

### Entry point / environment

- Entry point: VS Code extension (sidebar + tab panels)
- Environment: Local dev, VS Code 1.94+, Node 18+
- Live dependencies involved: gsd-pi RPC subprocess

## Completion Class

- Contract complete means: All tests pass, lint clean, build clean, type union is exhaustive
- Integration complete means: Extension builds and runs with gsd-pi 2.12 — no behavior changes
- Operational complete means: N/A (pure quality work, no new runtime behavior)

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- `npm run lint` passes with zero errors
- `npm test` passes (193+ tests)
- `npm run build` produces clean bundles
- No TypeScript `any` escapes at message protocol boundaries (types enforce all message types)
- The webview-provider is decomposed into focused modules with no behavior change

## Risks and Unknowns

- Refactoring webview-provider.ts could introduce subtle regressions in session lifecycle — mitigated by existing test coverage and incremental approach

## Existing Codebase / Prior Art

- `src/extension/webview-provider.ts` — 2170 lines, handles everything from process lifecycle to message routing
- `src/shared/types.ts` — message protocol types with gaps
- `src/webview/message-handler.ts` — event handler with missing fallback_chain_exhausted case
- `src/webview/index.ts` — dead tool watchdog code, unused import

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Scope

### In Scope

- Fix lint error (unused import)
- Fix type union gaps (resume_last_session, copy_last_response, extensionVersion)
- Remove dead code (tool watchdog no-ops, dead type)
- Deduplicate type definitions (dashboard-parser vs shared/types)
- Handle fallback_chain_exhausted event
- Fix cross-platform export (vscode.env.openExternal)
- Route console.warn to output channel in rpc-client
- Clean up assistantMessageEvent legacy shim
- Add missing tool icons for github_*, mcp_call, etc.
- Refactor webview-provider.ts into focused modules
- Consolidate per-session Maps into a SessionState object

### Out of Scope / Non-Goals

- New features (steering mode, fork picker, navigate tree)
- UI redesign
- New RPC commands
- Upstream pi changes

## Technical Constraints

- Must not change any user-facing behavior
- Must maintain backward compat with gsd-pi 2.12 RPC protocol
- Refactors must be provably safe (same tests pass, same build output structure)

## Integration Points

- gsd-pi 2.12 — RPC event stream (read-only integration, no changes needed)
