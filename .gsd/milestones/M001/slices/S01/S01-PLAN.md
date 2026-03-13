# S01: Webview Module Split

**Goal:** Split the 2,149-line monolithic `src/webview/index.ts` into focused modules with clear responsibilities, keeping all behavior identical.
**Demo:** Extension builds, loads in VS Code, and a full conversation flow (prompt → streaming text + thinking + tool calls → steer → slash commands → model picker → inline UI dialog) works exactly as before.

## Must-Haves

- Each module ≤300 lines with a single clear responsibility
- Shared state accessible across modules without circular dependencies
- All existing event handlers, rendering, and UI behavior preserved exactly
- `npm run build` succeeds with no errors

## Proof Level

- This slice proves: integration (webview ↔ extension host communication still works after split)
- Real runtime required: yes (must test in Extension Development Host)
- Human/UAT required: yes (visual check that rendering is identical)

## Verification

- `npm run build` — both extension and webview build with no errors
- Manual test in Extension Development Host: send a prompt, verify streaming text + thinking + tool calls render sequentially, test slash menu, model picker, inline UI dialog, steer-while-streaming, code block copy button, file path links

## Observability / Diagnostics

- Runtime signals: browser console errors in webview DevTools (Ctrl+Shift+I in Extension Development Host)
- Inspection surfaces: VS Code Output channel "GSD" for extension-side errors
- Failure visibility: build errors from esbuild, runtime errors in console
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `src/shared/types.ts` (message types), VS Code webview API
- New wiring introduced in this slice: module imports in refactored `src/webview/index.ts` entry point
- What remains before the milestone is truly usable end-to-end: S02 (dead code/type cleanup), S03 (config/build cleanup)

## Tasks

- [x] **T01: Extract state, types, and helpers** `est:30m`
  - Why: State and helpers are referenced by every other module — extract first to establish the dependency root
  - Files: `src/webview/index.ts`, `src/webview/state.ts`, `src/webview/helpers.ts`
  - Do: Extract `AppState`, `ChatEntry`, `AssistantTurn`, `TurnSegment`, `ToolCallState`, `AvailableModel` interfaces and the `state` object into `state.ts`. Extract all pure helper functions (`escapeHtml`, `escapeAttr`, `formatCost`, `formatTokens`, `formatContextUsage`, `shortenPath`, `formatDuration`, `truncateArg`, `isLikelyFilePath`, tool category/icon/keyArg functions, `renderMarkdown`, `formatToolResult`, `scrollToBottom`, `nextId`) into `helpers.ts`. Both export their contents for other modules to import.
  - Verify: `npm run build` succeeds, webview loads and renders a welcome screen
  - Done when: `state.ts` ≤150 lines, `helpers.ts` ≤250 lines, index.ts imports from both

- [x] **T02: Extract slash menu module** `est:20m`
  - Why: Slash menu is self-contained UI with its own state (visibility, index, filtered items) — clean module boundary
  - Files: `src/webview/index.ts`, `src/webview/slash-menu.ts`
  - Do: Extract `SlashMenuItem`, `buildSlashItems`, `showSlashMenu`, `hideSlashMenu`, `renderSlashMenu`, `selectSlashCommand`, slash menu state variables, and the input listener that triggers the menu. Export `init` function that takes DOM refs and wires up listeners. Module imports state and helpers.
  - Verify: `npm run build` succeeds, type `/` in input → slash menu appears, arrow keys navigate, Enter selects
  - Done when: `slash-menu.ts` ≤200 lines, slash menu fully functional

- [x] **T03: Extract model picker module** `est:20m`
  - Why: Model picker is self-contained overlay with its own rendering and event handling
  - Files: `src/webview/index.ts`, `src/webview/model-picker.ts`
  - Do: Extract `toggleModelPicker`, `showModelPicker`, `hideModelPicker`, `renderModelPicker`, model picker state, and click-outside handler. Export `init` function for DOM wiring.
  - Verify: `npm run build` succeeds, click Model button → picker opens, select a model → updates header
  - Done when: `model-picker.ts` ≤150 lines, model picker fully functional

- [x] **T04: Extract inline UI dialogs module** `est:20m`
  - Why: Inline UI request handling (select/confirm/input) is a distinct rendering concern
  - Files: `src/webview/index.ts`, `src/webview/ui-dialogs.ts`
  - Do: Extract `handleInlineUiRequest`, `disableUiRequest`, and all dialog rendering/event logic. Export `handleInlineUiRequest` for the message handler to call.
  - Verify: `npm run build` succeeds, trigger an inline UI dialog (e.g. ask a question that prompts confirmation) → renders and resolves correctly
  - Done when: `ui-dialogs.ts` ≤150 lines, all dialog types work

- [x] **T05: Extract renderer module** `est:30m`
  - Why: The streaming segment renderer is the largest and most critical piece — text, thinking, tool call rendering and DOM management
  - Files: `src/webview/index.ts`, `src/webview/renderer.ts`
  - Do: Extract all rendering functions: `createEntryElement`, `renderNewEntry`, `buildUserHtml`, `buildTurnHtml`, `buildToolCallHtml`, `buildSystemHtml`, `buildSubagentOutputHtml`, `clearMessages`. Extract streaming render state and functions: `currentTurnElement`, `segmentElements`, `activeSegmentIndex`, `pendingTextRender`, `ensureCurrentTurnElement`, `appendToTextSegment`, `renderTextSegment`, `insertSegmentElement`, `appendToolSegmentElement`, `updateToolSegmentElement`, `finalizeCurrentTurn`. Export init function and all render/streaming functions needed by the message handler.
  - Verify: `npm run build` succeeds, send a prompt → streaming text renders incrementally, tool calls appear in sequence, thinking block is collapsible, code blocks have copy buttons
  - Done when: `renderer.ts` ≤400 lines (largest module, acceptable), streaming rendering fully functional

- [x] **T06: Wire up index.ts as thin entry point and verify** `est:20m`
  - Why: The remaining index.ts should be a thin orchestrator — DOM setup, message handler switch, init calls
  - Files: `src/webview/index.ts`
  - Do: Ensure index.ts only contains: DOM setup (innerHTML template), element ref acquisition, image paste/drop handling, input/send logic, keyboard handler, global click handlers, message handler (switch statement calling into modules), and init calls. Verify it's ≤400 lines. Review all module boundaries for circular dependencies. Run full build.
  - Verify: `npm run build` succeeds, full conversation flow end-to-end in Extension Development Host — prompt, streaming, tools, thinking, slash menu, model picker, inline UI, steer, code copy, file links
  - Done when: `index.ts` ≤400 lines, no circular dependencies, all features work identically to pre-refactor

## Files Likely Touched

- `src/webview/index.ts` (refactored into thin entry point)
- `src/webview/state.ts` (new)
- `src/webview/helpers.ts` (new)
- `src/webview/slash-menu.ts` (new)
- `src/webview/model-picker.ts` (new)
- `src/webview/ui-dialogs.ts` (new)
- `src/webview/renderer.ts` (new)
