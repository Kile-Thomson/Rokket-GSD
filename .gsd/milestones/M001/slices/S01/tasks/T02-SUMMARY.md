---
id: T02
parent: S01
milestone: M001
provides:
  - slash-menu.ts module (228 lines) with all slash menu state, rendering, and navigation
  - Clean public API: init(), show(), hide(), isVisible(), navigateUp/Down(), selectCurrent()
  - Dependency injection via init() — no circular imports
  - handleNewConversation() extracted as shared function in index.ts
key_files:
  - src/webview/slash-menu.ts
  - src/webview/index.ts
key_decisions:
  - "Slash menu module uses dependency injection via init() deps object to avoid circular imports with index.ts"
  - "Renamed DOM ref from slashMenu to slashMenuEl to avoid name collision with module import"
  - "Extracted handleNewConversation() as shared function — used by both slash menu /new command and newConvoBtn click handler"
patterns_established:
  - "Module extraction pattern: init(deps) for DOM refs and callbacks, public API as named exports"
drill_down_paths:
  - .gsd/milestones/M001/slices/S01/tasks/T02-PLAN.md
duration: 10min
verification_result: pass
completed_at: 2026-03-12T08:25:00Z
---

# T02: Extract slash menu module

**Slash menu fully extracted to slash-menu.ts (228 lines) with init()-based dependency injection — build passes, no residual state in index.ts**

## What Happened

Extracted all slash menu code from index.ts into a self-contained slash-menu.ts module. The module owns its own state (visibility, index, filtered items), the SlashMenuItem interface, item building, rendering, and command selection logic. Dependencies (DOM refs, vscode postMessage, callbacks for autoResize/showModelPicker/handleNewConversation) are injected via an init() function to avoid circular imports.

Also extracted handleNewConversation() as a shared function in index.ts since both the slash menu's /new command and the newConvoBtn handler need the same reset logic.

Renamed the DOM element ref from `slashMenu` to `slashMenuEl` to avoid collision with the `import * as slashMenu` namespace.

## Deviations

- Module is 228 lines vs the planned ≤200 — the init() deps interface and dependency injection pattern add ~30 lines of scaffolding. Acceptable tradeoff for clean module boundaries.

## Files Created/Modified

- `src/webview/slash-menu.ts` — New module: slash menu state, rendering, navigation, command selection (228 lines)
- `src/webview/index.ts` — Removed ~140 lines of slash menu code, added slash-menu import and init() call, extracted handleNewConversation()
