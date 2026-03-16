# S05: index.ts decomposition

**Goal:** Break index.ts from 2416 lines into focused modules, each under 500 lines. index.ts stays under 700 lines as the orchestration shell.
**Demo:** `wc -l src/webview/index.ts` shows under 700 lines. All 140 tests pass. Extension builds cleanly.

## Must-Haves

- index.ts under 700 lines
- Each new module under 500 lines
- All 140 existing tests pass after each task
- No behavioral changes — pure refactor

## Verification

- `npx vitest run` — all tests pass (140+)
- `wc -l src/webview/index.ts` < 700
- `wc -l src/webview/dashboard.ts src/webview/file-handling.ts src/webview/message-handler.ts src/webview/keyboard.ts` — each < 500
- `npm run build` succeeds (or `npx esbuild` equivalent)

## Tasks

- [x] **T01: Extract dashboard.ts** `est:30m`
  - Why: Most self-contained section (289 lines). Clean extraction to prove the pattern.
  - Files: `src/webview/index.ts`, `src/webview/dashboard.ts`
  - Do: Move `renderDashboard()`, `formatTokenCount()`, `updateWelcomeScreen()` and the dashboard-related types/constants to dashboard.ts. Export an `init()` or individual functions. Wire calls from message-handler back to dashboard via imports.
  - Verify: `npx vitest run` passes, extension builds
  - Done when: dashboard code removed from index.ts, dashboard.ts < 500 lines

- [x] **T02: Extract file-handling.ts** `est:30m`
  - Why: File/image paste, drop, and attachment logic (206 lines) is cohesive and self-contained.
  - Files: `src/webview/index.ts`, `src/webview/file-handling.ts`
  - Do: Move `handleFiles()`, `parseDroppedUris()`, `addFileAttachments()`, `getFileIcon()`, `renderFileChips()`, `renderImagePreviews()` and the paste/drop event listeners. Export init() that takes element refs and vscode handle.
  - Verify: `npx vitest run` passes
  - Done when: file handling code removed from index.ts, file-handling.ts < 500 lines

- [x] **T03: Extract message-handler.ts** `est:45m`
  - Why: The message event handler (791 lines) is the largest single section. Core of the decomposition.
  - Files: `src/webview/index.ts`, `src/webview/message-handler.ts`
  - Do: Move the `window.addEventListener("message", ...)` handler and all its case branches. Module receives UI update callbacks, element refs, renderer, and vscode handle via init(). Import state, dashboard, renderer, etc.
  - Verify: `npx vitest run` passes
  - Done when: message handler removed from index.ts, message-handler.ts < 800 lines (it's the largest)

- [x] **T04: Extract keyboard.ts and verify final line counts** `est:30m`
  - Why: Keyboard handlers + click delegation + ARIA toggling (221 lines). Final extraction to hit target.
  - Files: `src/webview/index.ts`, `src/webview/keyboard.ts`
  - Do: Move keyboard event listeners (promptInput keydown, global keydown), click delegation on messagesContainer, ARIA aria-expanded toggling, and role="button" keyboard activation. Pass sendMessage, slashMenu, etc. as callbacks.
  - Verify: `npx vitest run` passes, `wc -l src/webview/index.ts` < 700, all new modules < 500 (message-handler allowed up to 800)
  - Done when: index.ts < 700 lines, all tests pass, extension builds

## Files Likely Touched

- `src/webview/index.ts`
- `src/webview/dashboard.ts` (new)
- `src/webview/file-handling.ts` (new)
- `src/webview/message-handler.ts` (new)
- `src/webview/keyboard.ts` (new)
