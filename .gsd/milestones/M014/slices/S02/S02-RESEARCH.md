# S02 — Research: Validate-Milestone Phase & New Slash Commands

**Date:** 2026-03-19
**Depth:** Light — straightforward wiring of known patterns to existing code.

## Summary

This slice adds three things: (1) a `validate-milestone` phase label + icon in the progress widget, (2) two new slash menu entries (`/gsd update`, `/gsd export --html --all`), and (3) a new `gsd.exportReport` VS Code command for HTML milestone report export. All three follow well-established patterns already in the codebase — the phase mapping is a single `case` addition in `formatPhase()`, the slash commands are entries in the `gsdSubcommands` array, and the VS Code command follows the same `registerCommand` pattern used by the existing 5 commands.

No new dependencies, no new data flows, no architectural changes.

## Recommendation

Implement as three small tasks in any order — they are independent. The phase label is a one-line change. The slash commands are array entries. The VS Code command is ~15 lines of registration + handler. All can be unit-tested by checking the `formatPhase` return value, the `buildItems()` output, and the command registration in `package.json`.

## Implementation Landscape

### Key Files

- `src/webview/auto-progress.ts` — Contains `formatPhase()` (line 298). Add `case "validate-milestone": return "VALIDATING";` with a checkmark icon in the render template. The phase string comes from `STATE.md` via `state-parser.ts` → `dashboard-parser.ts` → `auto-progress.ts` polling. The `parsePhase()` function (state-parser.ts:53) lowercases the raw value, so the case should match `"validate-milestone"`.

- `src/webview/slash-menu.ts` — Contains `buildItems()` with the `gsdSubcommands` array (line ~112). Add two entries:
  - `{ name: "gsd update", desc: "Update GSD artifacts and status", sendOnSelect: true }`
  - `{ name: "gsd export", desc: "Export milestone report (HTML)" }` — needs arguments, so `sendOnSelect` should be false, letting the user append `--html --all`.

- `src/extension/index.ts` — Register `gsd.exportReport` command (~line 72, inside `context.subscriptions.push`). Handler should prompt for a save location via `vscode.window.showSaveDialog()`, then invoke the GSD CLI to generate the report, or send a prompt through the RPC client.

- `src/extension/webview-provider.ts` — May need a new message handler case for `export_report` if the command triggers through the webview. However, the existing `export_html` case (which exports conversation HTML) is a different feature — `gsd.exportReport` is about milestone report export, not conversation export.

- `package.json` — Add `gsd.exportReport` to `contributes.commands` array with title like `"Rokket GSD: Export Milestone Report"`.

### Build Order

1. **Phase label** (smallest, zero dependencies) — add the `validate-milestone` case to `formatPhase()` and update the render function to show a checkmark icon (✓ or codicon `$(check)`) when the phase is `validate-milestone`.

2. **Slash menu entries** — add `/gsd update` and `/gsd export` to `gsdSubcommands`. `/gsd update` is `sendOnSelect: true` (no args needed). `/gsd export` is `sendOnSelect: false` so the user can type `--html --all`.

3. **VS Code command** — register `gsd.exportReport` in `package.json` contributes and in `index.ts`. The handler should:
   - Get the active session's RPC client
   - Send `/gsd export --html --all` as a prompt
   - Or, if we want a standalone flow: invoke `gsd export --html --all` via direct CLI spawn and open the result

   The simplest approach: have the command focus the GSD panel and send `/gsd export --html --all` as a prompt, reusing the existing prompt flow. This avoids duplicating CLI invocation logic.

### Verification Approach

- **Phase label:** Unit test `formatPhase("validate-milestone")` returns `"VALIDATING"`. Visual check: when STATE.md contains `**Phase:** validate-milestone`, the progress widget shows "VALIDATING" with a checkmark icon.

- **Slash commands:** Unit test that `buildItems()` includes entries with names `"gsd update"` and `"gsd export"`. Manual test: type `/gsd u` in the input and see "gsd update" appear; type `/gsd e` and see "gsd export".

- **VS Code command:** Verify `gsd.exportReport` appears in the VS Code command palette. Manual test: run the command and confirm it triggers the export flow.

- **Regression:** Run existing test suite (`npm test`) to confirm no breakage.

## Constraints

- The `formatPhase()` switch uses the lowercased phase string from `parsePhase()`, so the case must be the exact lowercase form `"validate-milestone"`.
- The `gsd.exportReport` command must be added to both `package.json` (contributes) and registered in code — VS Code requires both.
- Slash menu items with `sendOnSelect: true` fire immediately as prompts. `/gsd export` should NOT be `sendOnSelect` because it requires `--html --all` arguments.
