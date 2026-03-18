---
estimated_steps: 4
estimated_files: 3
---

# T02: Register gsd.exportReport VS Code command

**Slice:** S02 — Validate-Milestone Phase & New Slash Commands
**Milestone:** M014

## Description

Register a new `gsd.exportReport` VS Code command that focuses the GSD panel and sends `/gsd export --html --all` as a prompt to the active GSD session. This makes milestone report export accessible from the command palette without requiring the user to type the slash command manually.

The command follows the same pattern as `gsd.newConversation` — a method on `WebviewProvider` called from a `registerCommand` handler. The `package.json` contributes entry makes it appear in the command palette.

## Steps

1. In `package.json`, find the `contributes.commands` array (around line 106). Add a new entry:
   ```json
   {
     "command": "gsd.exportReport",
     "title": "Rokket GSD: Export Milestone Report"
   }
   ```

2. In `src/extension/webview-provider.ts`, add a public `async exportReport()` method near the existing `focus()` and `newConversation()` methods (~line 169). The method should:
   - Call `this.focus()` to ensure the panel is visible
   - Find an active session with a running client. Check the sidebar session first (iterate `this.sessions`, find one with `client?.isRunning`)
   - If a running client is found, call `await client.prompt("/gsd export --html --all")`
   - If no running client is found, show: `vscode.window.showInformationMessage("Start a GSD session first to export a milestone report.")`

   Example implementation:
   ```typescript
   async exportReport(): Promise<void> {
     this.focus();
     for (const [, session] of this.sessions) {
       if (session.client?.isRunning) {
         try {
           await session.client.prompt("/gsd export --html --all");
         } catch (err) {
           this.output.appendLine(`Error exporting report: ${err}`);
           vscode.window.showErrorMessage("Failed to export milestone report.");
         }
         return;
       }
     }
     vscode.window.showInformationMessage("Start a GSD session first to export a milestone report.");
   }
   ```

3. In `src/extension/index.ts`, find the `context.subscriptions.push(...)` block (~line 55) where existing commands are registered. Add:
   ```typescript
   vscode.commands.registerCommand("gsd.exportReport", () => {
     provider.exportReport();
   }),
   ```

4. Run `npx vitest run` to confirm no regressions. Build with `npm run build` to confirm TypeScript compiles cleanly.

## Must-Haves

- [ ] `gsd.exportReport` entry exists in `package.json` `contributes.commands`
- [ ] `exportReport()` method exists on `WebviewProvider`
- [ ] `gsd.exportReport` command is registered in `index.ts` subscriptions
- [ ] Method focuses the panel and sends `/gsd export --html --all` as a prompt
- [ ] Graceful handling when no GSD session is running (info message)
- [ ] Build succeeds and all existing tests pass

## Verification

- `npm run build` — compiles without errors
- `npx vitest run` — all tests pass
- Manual: open VS Code command palette (Ctrl+Shift+P), type "Export Milestone Report" — command appears

## Inputs

- `package.json` — existing `contributes.commands` array structure
- `src/extension/index.ts` — existing `registerCommand` pattern (lines 55–82)
- `src/extension/webview-provider.ts` — existing `focus()`, `newConversation()` methods, `sessions` map, `client.prompt()` API

## Expected Output

- `package.json` — new command entry in contributes
- `src/extension/index.ts` — new `registerCommand` call
- `src/extension/webview-provider.ts` — new `exportReport()` method

## Observability Impact

- **Command palette visibility**: `gsd.exportReport` appears when searching "Export Milestone Report" in VS Code command palette (Ctrl+Shift+P). Its absence indicates the `package.json` contributes entry is missing or the extension failed to activate.
- **Error logging**: Export failures log `Error exporting report: <err>` to the GSD output channel (`this.output`). Check Output panel → "Rokket GSD" for error traces.
- **User-facing messages**: When no session is running, an info message "Start a GSD session first to export a milestone report." is shown. On prompt failure, an error message "Failed to export milestone report." appears. Both are inspectable via VS Code notification history.
- **Failure mode**: If the command is registered but `exportReport()` is not defined on the provider, VS Code will throw at runtime when the command is invoked — visible in the developer console (Help → Toggle Developer Tools).
