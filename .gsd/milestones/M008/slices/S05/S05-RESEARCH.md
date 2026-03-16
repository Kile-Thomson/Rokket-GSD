# S05: index.ts decomposition — Research

**Date:** 2026-03-14

## Summary

index.ts is 2416 lines. State and types are already in state.ts (133 lines). Several modules are already extracted (renderer, model-picker, slash-menu, etc.). The remaining monolith has clear section boundaries marked with comment separators.

The main extraction candidates by size: message handler (791 lines, L1534-2324), dashboard (289 lines, L1245-1533), UI updates (290 lines, L955-1244), file/image handling (206 lines, L397-602), keyboard/click handlers (221 lines, L734-954). DOM setup (158 lines) and init/header/scroll/timestamps (~231 lines) are the glue that stays in index.ts.

All extracted modules already follow a consistent pattern: export an `init()` function that receives element refs and callbacks. The state singleton is imported directly from state.ts. This pattern should be followed.

## Recommendation

Extract 4 modules in order of decreasing isolation:
1. **dashboard.ts** — most self-contained, only renders into messagesContainer
2. **file-handling.ts** — image paste/drop + file attachments, clear inputs
3. **message-handler.ts** — the big event handler switch statement
4. **keyboard.ts** — keyboard event handlers + click delegation + ARIA toggling

Leave in index.ts: DOM setup/HTML template, element refs, UI update functions, init orchestration. Target: index.ts under 700 lines.

## Existing Code and Patterns

- `src/webview/model-picker.ts` — exemplar pattern: exports `init({el, trigger, onSelect, vscode})`, manages own DOM/state
- `src/webview/slash-menu.ts` — same pattern: `init({slashMenuEl, promptInput, ...})` 
- `src/webview/state.ts` — shared mutable state singleton, imported directly
- `src/webview/renderer.ts` — rendering engine, already extracted

## Constraints

- All 140 existing tests must pass after each extraction
- No new dependencies — vanilla DOM only
- Shared mutable `state` object must remain the single source of truth
- Element refs are created in index.ts DOM setup — passed to modules via init()
- `vscode.postMessage()` calls scattered throughout — modules need the vscode API handle

## Common Pitfalls

- **Circular imports** — message-handler needs UI update functions which need state. Keep state.ts as the leaf. UI functions that message-handler calls should be passed as callbacks.
- **Implicit closure over element refs** — index.ts functions close over `const messagesContainer` etc. Extracted modules need these passed in.

## Open Risks

- Some keyboard handlers reference functions from multiple extraction targets (e.g. `sendMessage` in keyboard handler, `slashMenu` imported module). May need to pass more callbacks than expected.
