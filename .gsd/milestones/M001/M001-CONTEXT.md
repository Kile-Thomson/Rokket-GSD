# M001: Polish & Hardening — Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

## Project Description

Rokket GSD is a VS Code extension wrapping the GSD AI coding agent. v0.2.0 is fully functional but accumulated technical debt during rapid development — dead code, empty handlers, missing type definitions, and a 2,149-line monolithic webview file.

## Why This Milestone

The extension works well but the codebase has rough edges that will slow down future feature work (especially M002: Conversation History). Dead code creates confusion, missing types hide bugs, and the monolithic webview file makes changes risky. Clean this up now while the codebase is small and well-understood.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Use the extension exactly as before — no regressions, same features, same performance
- (Developers) Navigate a well-organized codebase split into logical modules

### Entry point / environment

- Entry point: VS Code extension activated via activity bar or command palette
- Environment: VS Code Extension Development Host (F5) or installed VSIX
- Live dependencies involved: gsd --mode rpc child process

## Completion Class

- Contract complete means: extension builds, packages, and all existing features work as before
- Integration complete means: webview ↔ extension host ↔ RPC communication still works after refactoring
- Operational complete means: streaming, tool calls, model switching, slash commands, inline UI all function correctly

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- Extension builds cleanly with no TypeScript errors
- A full conversation flow works: send prompt → streaming text + thinking + tool calls render sequentially → steer mid-stream → model switch → slash commands → inline UI dialog
- No dead code remains (followUpQueue, empty handlers, unused message types removed)

## Risks and Unknowns

- Splitting the webview file could break event handler wiring — module boundaries must be clean
- Removing "dead" code that's actually used by an undiscovered path — verify before deleting

## Existing Codebase / Prior Art

- `src/webview/index.ts` — 2,149-line monolith to be split into modules
- `src/shared/types.ts` — message protocol types, needs missing types added
- `src/extension/webview-provider.ts` — has empty handler stubs and untyped message forwarding
- `src/extension/rpc-client.ts` — has duplicate `compact`/`compactContext` methods

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions.

## Scope

### In Scope

- Remove dead code (followUpQueue, empty tool_permission_response handler, duplicate RPC methods)
- Add missing message types to ExtensionToWebviewMessage union (available_models, bash_result, thinking_level_changed)
- Split webview/index.ts into logical modules (renderer, slash-menu, model-picker, ui-dialogs, state, helpers)
- Ensure all `as any` casts in message handlers have proper types
- Clean up tsconfig (remove unused jsx, declaration settings)

### Out of Scope / Non-Goals

- New features (conversation history, persistence, fork conversation UI)
- Testing framework setup (M003)
- Linting/formatting config (M003)
- CSS splitting or CSS modules (premature — `.gsd-` prefix convention works fine)
- Webview framework adoption (vanilla DOM stays per Decision #1)

## Technical Constraints

- esbuild bundles both extension and webview — module splits must work with esbuild's bundling
- Webview runs in browser context (IIFE) — no Node.js APIs
- Must maintain backward compatibility with existing gsd --mode rpc protocol

## Integration Points

- gsd --mode rpc — child process, no changes needed
- VS Code extension API — commands, webview provider, status bar unchanged
- postMessage protocol — types updated but runtime messages unchanged
