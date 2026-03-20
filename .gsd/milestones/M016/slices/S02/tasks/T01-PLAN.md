---
estimated_steps: 5
estimated_files: 5
---

# T01: Harden security functions — crypto nonce, workspace boundary, file size limit, DOMPurify, bash validation

**Slice:** S02 — Inline Style Removal & Security Hardening
**Milestone:** M016

## Description

Implement five independent security hardening items from audit findings SEC-02/03/04/05/10. Each is a self-contained change to an existing function with a clear pattern to follow. This task delivers requirement R003 (Security hardening) completely.

**Relevant skills:** The `review` and `test` skills may be useful for validating security changes.

## Steps

1. **Crypto nonce in `html-generator.ts`** — Replace the `getNonce()` function body. Current implementation uses `Math.random()` in a loop to build a 32-char string. Replace with:
   ```typescript
   import * as crypto from "crypto";
   export function getNonce(): string {
     return crypto.randomBytes(16).toString('base64url');
   }
   ```
   The `crypto` module is available in the VS Code extension host (Node.js). `base64url` encoding is URL-safe and suitable for CSP nonces. Remove the unused `possible` variable and loop.

2. **Workspace boundary on `handleCheckFileAccess` in `file-ops.ts`** — Add workspace boundary validation before the `fs.promises.access` call. The exact pattern already exists in `handleOpenFile` (same file, starting at line 64):
   ```typescript
   const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
   if (!workspaceRoot) {
     // reject all paths if no workspace open
   }
   const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
   // For each path, resolve it and check startsWith(realRoot + path.sep)
   ```
   Paths outside the workspace should return `{ path: p, readable: false }` and log a warning to the output channel: `[${sessionId}] Blocked check_file_access outside workspace: ${realFile}`. Note: `handleCheckFileAccess` doesn't currently receive `sessionId` — you'll need to add it as a parameter or use a generic prefix.

3. **Size limit on `handleSaveTempFile` in `file-ops.ts`** — Add a size check before `Buffer.from(msg.data, "base64")`. Base64 data is ~33% larger than raw, so check `msg.data.length > 66_666_667` (50MB * 4/3 for base64 overhead). If exceeded, post an error message: `{ type: "error", message: "File exceeds 50MB limit" }` and return early. Log: `Blocked save_temp_file: payload exceeds 50MB limit`.

4. **DOMPurify wrap for `formatMarkdownNotes` in `helpers.ts`** — The function already calls `escapeHtml(md)` first, then applies regex transforms. The same file already imports DOMPurify (line 6) and uses it in `renderMarkdown` (line 458). Wrap the final return value: `return DOMPurify.sanitize(result)` where `result` is the current return expression. This is defense-in-depth — the existing `escapeHtml` call handles most cases, but DOMPurify provides a second layer.

5. **Bash command validation in `message-dispatch.ts`** — In the `run_bash` case (line 491), before executing the command, check for destructive patterns. Define a list:
   ```typescript
   const destructivePatterns = [
     /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r|--force|--recursive)\b/,
     /\bformat\b/i,
     /\bmkfs\b/,
     /\bdd\b\s+/,
     /\b(chmod|chown)\s+.*-R/,
   ];
   ```
   If any pattern matches `msg.command`, show a VS Code warning dialog:
   ```typescript
   const choice = await vscode.window.showWarningMessage(
     `This command may be destructive: ${msg.command.slice(0, 100)}`,
     { modal: true },
     "Run Anyway"
   );
   if (choice !== "Run Anyway") {
     ctx.postToWebview(webview, { type: "bash_result", result: { exitCode: 1, stdout: "", stderr: "Cancelled by user" } });
     break;
   }
   ```
   Import `vscode` is already available in message-dispatch.ts. The `BashResult` type is already imported.

6. **Add/update tests** — Add tests in `src/extension/file-ops.test.ts` (or create if needed) for the workspace boundary and size limit. For the crypto nonce, add a simple test asserting `getNonce()` returns a string of expected length and format. For `formatMarkdownNotes`, verify the output is sanitized by checking a test case with embedded script tags.

## Must-Haves

- [ ] `getNonce()` uses `crypto.randomBytes` — zero `Math.random` calls in html-generator.ts
- [ ] `handleCheckFileAccess` rejects paths outside workspace boundary
- [ ] `handleSaveTempFile` rejects payloads >50MB with error message
- [ ] `formatMarkdownNotes` output passes through `DOMPurify.sanitize()`
- [ ] `run_bash` shows confirmation dialog for destructive patterns
- [ ] Tests pass for all changes (`npx vitest --run`)
- [ ] Build succeeds (`npm run build`)

## Verification

- `npx vitest --run` — all tests pass
- `rg "Math\.random" src/extension/html-generator.ts` — zero hits
- `npm run build` — esbuild succeeds
- `rg "randomBytes" src/extension/html-generator.ts` — has hits (crypto nonce present)
- `rg "50.*MB\|66_666_667\|66666667" src/extension/file-ops.ts` — has hits (size limit present)
- `rg "DOMPurify" src/webview/helpers.ts` — has hits on line ~530 (formatMarkdownNotes wrap)

## Inputs

- `src/extension/html-generator.ts` — 45 LOC, extracted by S01. Contains `getNonce()` (line 8) and CSP meta tag (line 33). The CSP change itself happens in T03 — this task only fixes the nonce.
- `src/extension/file-ops.ts` — 280 LOC, wired by S01. Contains `handleCheckFileAccess` (line 227) and `handleSaveTempFile` (line 209). The workspace boundary pattern to copy is in `handleOpenFile` (line 57).
- `src/extension/message-dispatch.ts` — 833 LOC, extracted by S01. The `run_bash` case is at line 491. Already has `vscode` import.
- `src/webview/helpers.ts` — 613 LOC. `formatMarkdownNotes` at line 516. DOMPurify already imported at line 6.
- `src/extension/file-ops.test.ts` — existing test file for file-ops module (may need new test cases added).

## Expected Output

- `src/extension/html-generator.ts` — `getNonce()` rewritten to use `crypto.randomBytes(16).toString('base64url')`
- `src/extension/file-ops.ts` — `handleCheckFileAccess` with workspace boundary validation, `handleSaveTempFile` with 50MB limit
- `src/extension/message-dispatch.ts` — `run_bash` case with destructive pattern detection and confirmation dialog
- `src/webview/helpers.ts` — `formatMarkdownNotes` return wrapped in `DOMPurify.sanitize()`
- `src/extension/file-ops.test.ts` — new test cases for workspace boundary and size limit
