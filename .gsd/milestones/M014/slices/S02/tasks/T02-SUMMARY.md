---
id: T02
parent: S02
milestone: M014
provides:
  - gsd.exportReport VS Code command registered and functional
key_files:
  - package.json
  - src/extension/index.ts
  - src/extension/webview-provider.ts
key_decisions: []
patterns_established:
  - exportReport() follows same session-iteration pattern as newConversation() for finding a running client
observability_surfaces:
  - GSD output channel logs "Error exporting report: <err>" on prompt failures
  - Info message shown when no session is running; error message on prompt failure
  - Command palette entry "Rokket GSD: Export Milestone Report" visible when extension is active
duration: 5m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T02: Register gsd.exportReport VS Code command

**Added `gsd.exportReport` command to package.json, WebviewProvider, and extension activation — focuses panel and sends `/gsd export --html --all` to active session**

## What Happened

Added the `gsd.exportReport` command across three files following the existing `newConversation` pattern:
1. `package.json` — new entry in `contributes.commands` with title "Rokket GSD: Export Milestone Report"
2. `webview-provider.ts` — new `exportReport()` method that focuses the panel, finds a running client session, and calls `client.prompt("/gsd export --html --all")` with error handling
3. `index.ts` — registered the command in `context.subscriptions.push()` block

The method handles two failure cases: no running session (info message) and prompt failure (error message + output channel logging).

## Verification

- `npm run build` — compiles without errors (extension 141.3kb, webview 328.5kb)
- `npx vitest run` — all 251 tests pass across 14 test files
- Command appears in package.json contributes.commands for palette discovery

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm run build` | 0 | ✅ pass | 15.7s |
| 2 | `npx vitest run` | 0 | ✅ pass | 15.7s |
| 3 | `npx vitest run src/webview/__tests__/auto-progress.test.ts` | 0 | ✅ pass (19 tests) | — |
| 4 | `npx vitest run src/webview/__tests__/slash-menu.test.ts` | — | ⏭ skipped (T01 file, not re-run separately) | — |

## Diagnostics

- **Command palette**: Search "Export Milestone Report" in Ctrl+Shift+P — command should appear when extension is active
- **No-session path**: Invoke command with no GSD session running → info message "Start a GSD session first to export a milestone report."
- **Error path**: If `client.prompt()` throws, error logged to GSD output channel and error message shown to user
- **Runtime failure**: If `exportReport()` is missing from provider, VS Code throws at command invocation — visible in developer console

## Deviations

None

## Known Issues

None

## Files Created/Modified

- `package.json` — added `gsd.exportReport` command entry to `contributes.commands`
- `src/extension/webview-provider.ts` — added `exportReport()` method with focus, session lookup, prompt, and error handling
- `src/extension/index.ts` — registered `gsd.exportReport` command in subscriptions
