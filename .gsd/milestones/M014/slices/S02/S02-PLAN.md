# S02: Validate-Milestone Phase & New Slash Commands

**Goal:** The progress widget renders `validate-milestone` with a distinct label and checkmark icon. `/gsd update` and `/gsd export --html --all` appear in the slash menu and execute. HTML report export is available as a `gsd.exportReport` VS Code command.

**Demo:** During a validate-milestone phase, the progress widget shows "✓ VALIDATING" instead of a raw phase string. Typing `/gsd u` in the input shows "gsd update" in the slash menu and selecting it sends the command. Running "Rokket GSD: Export Milestone Report" from the command palette focuses the GSD panel and sends `/gsd export --html --all`.

## Must-Haves

- `formatPhase("validate-milestone")` returns `"VALIDATING"` with a checkmark icon in the rendered output
- `/gsd update` appears in slash menu with `sendOnSelect: true`
- `/gsd export` appears in slash menu with `sendOnSelect: false` (user appends args)
- `gsd.exportReport` registered in `package.json` and extension code
- `gsd.exportReport` command focuses the GSD panel and sends `/gsd export --html --all` as a prompt
- No regressions in existing tests

## Verification

- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — includes test for `validate-milestone` phase rendering
- `npx vitest run src/webview/__tests__/slash-menu.test.ts` — includes tests for new slash menu entries (create this file if needed, or add to existing test)
- `npx vitest run` — full suite passes with no regressions
- `npx vitest run src/webview/__tests__/slash-menu.test.ts` — slash menu entries verified (includes failure-path: missing entry would fail assertion)
- Manual: `gsd.exportReport` appears in VS Code command palette

## Observability / Diagnostics

- **Progress widget phase rendering**: When `phase === "validate-milestone"`, the widget renders `"✓ VALIDATING"` in the `.gsd-auto-progress-phase` span. Inspect via DOM or accessibility tree.
- **Slash menu entries**: `buildItems()` (exported for testing) returns the full item list. New entries `gsd update` and `gsd export` can be verified via unit tests or by typing `/gsd u` or `/gsd e` in the prompt input.
- **Failure visibility**: If `formatPhase` receives an unknown phase string, it falls back to `phase.toUpperCase()` — no crash, but the raw string appears instead of a friendly label. Missing slash menu entries would silently omit the command from the menu (no error).
- **Export command errors**: `gsd.exportReport` shows an info message if no GSD session is running. The command handler logs no structured errors beyond that.

## Tasks

- [x] **T01: Add validate-milestone phase label and new slash menu entries** `est:30m`
  - Why: Covers two of the three slice deliverables — the phase label mapping and the slash menu additions. Both are webview-side data additions following existing patterns.
  - Files: `src/webview/auto-progress.ts`, `src/webview/slash-menu.ts`, `src/webview/__tests__/auto-progress.test.ts`
  - Do: (1) Add `case "validate-milestone": return "VALIDATING";` to `formatPhase()` switch in `auto-progress.ts` (~line 298). (2) Update the render template to show a checkmark icon (`✓`) when phase is `validate-milestone` — add a conditional in the innerHTML template near the phase span (~line 165). (3) Add two entries to `gsdSubcommands` array in `slash-menu.ts` (~line 115): `{ name: "gsd update", desc: "Update GSD artifacts and status", sendOnSelect: true }` and `{ name: "gsd export", desc: "Export milestone report (HTML)" }` (no `sendOnSelect`, defaults to false). (4) Add a test case to `auto-progress.test.ts` that creates progress data with `phase: "validate-milestone"` and asserts the rendered widget contains "VALIDATING" and "✓". (5) Add or create a test for slash menu that asserts `buildItems()` includes entries named "gsd update" and "gsd export".
  - Verify: `npx vitest run src/webview/__tests__/auto-progress.test.ts` and `npx vitest run` both pass
  - Done when: `formatPhase("validate-milestone")` returns `"VALIDATING"`, the checkmark icon renders for that phase, both new slash commands appear in `buildItems()`, and all tests pass

- [x] **T02: Register gsd.exportReport VS Code command** `est:30m`
  - Why: Adds the `gsd.exportReport` command to the VS Code command palette, completing the slice's third deliverable.
  - Files: `package.json`, `src/extension/index.ts`, `src/extension/webview-provider.ts`
  - Do: (1) In `package.json`, add to `contributes.commands` array: `{ "command": "gsd.exportReport", "title": "Rokket GSD: Export Milestone Report" }`. (2) In `webview-provider.ts`, add a public method `exportReport()` that: focuses the panel (`this.focus()`), then for the active sidebar session sends a prompt message by calling `this.handleWebviewMessage` with a `prompt` type message containing `/gsd export --html --all`, OR more directly — get the active session's client and call `client.prompt("/gsd export --html --all")`. Use the simpler approach: post a message to the webview that pre-fills and submits the prompt. (3) In `index.ts`, register the command inside `context.subscriptions.push(...)` (~line 75): `vscode.commands.registerCommand("gsd.exportReport", () => { provider.exportReport(); })`. (4) The `exportReport()` method should: call `this.focus()`, then find the active session's client (iterate `this.sessions` or use the sidebar session), and if client is running, call `await client.prompt("/gsd export --html --all")`. If no client is running, show an info message: `vscode.window.showInformationMessage("Start a GSD session first.")`.
  - Verify: `npx vitest run` passes (no regressions). Manual: open VS Code command palette, type "Export Milestone Report", confirm the command appears and executes.
  - Done when: `gsd.exportReport` is in `package.json` contributes, registered in `index.ts`, and the handler focuses the panel and sends the export prompt

## Files Likely Touched

- `src/webview/auto-progress.ts`
- `src/webview/slash-menu.ts`
- `src/webview/__tests__/auto-progress.test.ts`
- `src/extension/index.ts`
- `src/extension/webview-provider.ts`
- `package.json`
