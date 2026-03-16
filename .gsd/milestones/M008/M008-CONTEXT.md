# M008: Hardening, Performance & UX — Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

## Project Description

Rokket GSD VS Code extension — AI chat panel wrapping the GSD agent. Currently at v0.2.19, functional but with significant opportunities for improvement across stability, performance, security, and UX.

## Why This Milestone

The extension works but has accumulated technical debt and lacks patterns used by best-in-class competitors (Cline, Continue, Cody). Long conversations degrade performance (no virtualization), errors are silently swallowed (47 catch blocks), accessibility is near-zero (2 ARIA attributes total), and the 2,379-line index.ts monolith is becoming hard to maintain.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Use the extension for long conversations (100+ messages) without performance degradation
- See clear loading indicators when fetching data (changelog, dashboard, models)
- Navigate the UI entirely via keyboard
- Trust that errors surface visibly instead of being swallowed silently
- Experience smoother streaming with grouped tool calls reducing visual noise

### Entry point / environment

- Entry point: VS Code extension (webview panel/sidebar)
- Environment: VS Code on Windows/macOS/Linux
- Live dependencies: gsd-pi child process via JSON-RPC

## Completion Class

- Contract complete means: all tests pass, no regressions in existing 82 tests, new tests for added functionality
- Integration complete means: extension loads, chat works end-to-end, streaming renders correctly
- Operational complete means: extension survives long sessions, crashes surface visibly, recovery works

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Extension handles a 100+ message conversation without noticeable lag
- All interactive elements are keyboard-accessible with visible focus indicators
- Errors from pi process, RPC, and webview render as user-visible messages (not silent swallows)
- Tool call groups collapse into summaries, reducing visual noise by ~50% for read-heavy operations

## Risks and Unknowns

- Virtual scrolling without React — we use vanilla DOM, not React. react-virtuoso is out. Need a vanilla approach or lightweight lib.
- Tool call grouping may break streaming assumptions — current renderer appends segments sequentially
- Refactoring index.ts may introduce regressions if not careful with shared mutable state

## Existing Codebase / Prior Art

- `src/webview/index.ts` — 2,379 line monolith, main refactoring target
- `src/webview/renderer.ts` — streaming segment renderer, key for tool grouping
- `src/extension/rpc-client.ts` — RPC buffer with no size limit, needs cap
- `src/extension/webview-provider.ts` — 1,497 lines, prompt watchdog timer leak
- `src/webview/styles.css` — 3,350 lines, 3 duplicate formatNotes functions in index.ts

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions.

## Competitive Research (from Cline, Continue, Cody analysis)

Key patterns competitors use that we lack:
1. **Virtual scrolling** (Cline uses react-virtuoso) — essential for long conversations
2. **Low-stakes tool grouping** (Cline) — collapse read-only ops into compact summaries
3. **Per-message error boundaries** — prevent one bad render from crashing chat
4. **Declarative button state machine** (Cline) — clean action button management
5. **Loading skeletons/spinners** — for async operations (changelog, dashboard, models)
6. **ARIA roles + keyboard nav** — zero accessibility currently
7. **Code block completion gating** — don't show Copy/Apply on half-streamed code
8. **Scrollbar markers** (Cody) — dots showing human message positions
9. **Chat search (Cmd+F)** (Continue) — text search across conversation

## Scope

### In Scope

- RPC buffer size limit
- Prompt watchdog timer leak fix
- Loading states for async fetches
- Extract duplicate formatNotes helper
- ARIA labels and keyboard navigation
- Tool call grouping/collapsing
- Visible error surfacing (replace silent catches)
- index.ts decomposition into focused modules

### Out of Scope / Non-Goals

- Framework migration (React/Svelte) — Decision #1 says vanilla DOM
- Virtual scrolling — too risky without framework, defer to M009
- Smart Apply / code actions — requires pi-side changes
- Quote & reply — nice-to-have, not hardening

## Technical Constraints

- Vanilla DOM, no framework (Decision #1)
- esbuild bundler (Decision #2)
- Must maintain backward compatibility with existing GSD pi versions
- All existing 82 tests must continue passing

## Integration Points

- gsd-pi child process — JSON-RPC over stdin/stdout (no changes needed)
- VS Code webview API — CSP, message passing, theme variables
- GitHub API — changelog/update fetching (no changes needed)
