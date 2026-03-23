import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { ExtensionToWebviewMessage } from "../shared/types";

// ============================================================
// File operation handlers — extracted from webview-provider.ts
// ============================================================

export interface FileOpsContext {
  postToWebview: (wv: vscode.Webview, msg: ExtensionToWebviewMessage | Record<string, unknown>) => void;
  output: vscode.OutputChannel;
  ensureTempDir: () => string;
}

/**
 * Clean stale auto.lock crash locks that cause infinite wizard loops.
 *
 * When gsd-pi's auto-mode crashes, it leaves .gsd/auto.lock behind.
 * On next /gsd invocation, showSmartEntry reads the lock, shows
 * "Interrupted Session Detected", and if the user picks "Resume",
 * startAuto → bootstrapAutoSession writes a NEW lock, finds no active
 * milestone, calls showSmartEntry again → infinite loop.
 *
 * This pre-launch cleanup removes the lock when STATE.md indicates idle
 * (no active work to resume), breaking the loop before it starts.
 */
export async function cleanStaleCrashLock(cwd: string, output: vscode.OutputChannel): Promise<void> {
  try {
    const lockPath = path.join(cwd, ".gsd", "auto.lock");
    if (!fs.existsSync(lockPath)) return;

    const statePath = path.join(cwd, ".gsd", "STATE.md");
    if (!fs.existsSync(statePath)) {
      // No STATE.md — lock is definitely stale
      fs.unlinkSync(lockPath);
      output.appendLine(`[pre-launch] Removed stale .gsd/auto.lock (no STATE.md)`);
      return;
    }

    const stateContent = await fs.promises.readFile(statePath, "utf-8");
    const phaseMatch = stateContent.match(/\*\*Phase:\*\*\s*(\S+)/);
    const activeMatch = stateContent.match(/\*\*Active Milestone:\*\*\s*(\S+)/);
    const phase = phaseMatch?.[1] || "unknown";
    const activeMilestone = activeMatch?.[1] || "none";

    // If state is idle/complete with no active milestone, lock is stale
    if (activeMilestone === "none" || phase === "idle" || phase === "complete") {
      fs.unlinkSync(lockPath);
      output.appendLine(`[pre-launch] Removed stale .gsd/auto.lock (state: ${phase}, milestone: ${activeMilestone})`);
    }
  } catch {
    // Non-fatal — if we can't clean it, gsd-pi will handle it
  }
}

export function handleOpenFile(
  ctx: FileOpsContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: { path: string },
): void {
  try {
    // Security: only open files within the workspace (resolves symlinks)
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      ctx.output.appendLine(`[${sessionId}] Blocked open_file: no workspace open`);
      return;
    }
    const realFile = fs.realpathSync(path.resolve(msg.path));
    const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
    if (!realFile.startsWith(realRoot + path.sep) && realFile !== realRoot) {
      ctx.output.appendLine(`[${sessionId}] Blocked open_file outside workspace: ${realFile}`);
      return;
    }
    vscode.workspace.openTextDocument(realFile).then(
      (doc) => vscode.window.showTextDocument(doc),
      (err: Error) => vscode.window.showErrorMessage(`Failed to open file: ${err.message}`),
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
  }
}

export function handleOpenDiff(
  ctx: FileOpsContext,
  _webview: vscode.Webview,
  sessionId: string,
  msg: { leftPath: string; rightPath: string },
): void {
  try {
    // Security: only open files within the workspace (resolves symlinks)
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      ctx.output.appendLine(`[${sessionId}] Blocked open_diff: no workspace open`);
      return;
    }
    const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
    const realLeft = fs.realpathSync(path.resolve(msg.leftPath));
    const realRight = fs.realpathSync(path.resolve(msg.rightPath));
    const rootPrefix = realRoot + path.sep;
    if (!realLeft.startsWith(rootPrefix) || !realRight.startsWith(rootPrefix)) {
      ctx.output.appendLine(`[${sessionId}] Blocked open_diff outside workspace`);
      return;
    }
    const left = vscode.Uri.file(realLeft);
    const right = vscode.Uri.file(realRight);
    vscode.commands.executeCommand("vscode.diff", left, right);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to open diff: ${err.message}`);
  }
}

export function handleOpenUrl(
  ctx: FileOpsContext,
  _webview: vscode.Webview,
  sessionId: string,
  msg: { url: string },
): void {
  // Security: only allow http/https URLs
  const url = String(msg.url || "");
  if (/^https?:\/\//i.test(url)) {
    vscode.env.openExternal(vscode.Uri.parse(url));
  } else {
    ctx.output.appendLine(`[${sessionId}] Blocked non-http URL: ${url}`);
  }
}

export async function handleExportHtml(
  ctx: FileOpsContext,
  webview: vscode.Webview,
  _sessionId: string,
  msg: { html?: string; css?: string },
): Promise<void> {
  try {
    const contentHtml = msg.html || "<p>No conversation content</p>";
    const pageCss = msg.css || "";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const extVersion = vscode.extensions.getExtension("rokketek.rokket-gsd")?.packageJSON?.version || "?";
    const exportOverrides = `
    /* VS Code CSS variable fallbacks for standalone browser */
    :root {
      color-scheme: dark;
      --vscode-foreground: #cccccc;
      --vscode-editor-background: #1e1e1e;
      --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --vscode-editor-fontFamily: 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace;
      --vscode-input-background: #2d2d30;
      --vscode-input-foreground: #cccccc;
      --vscode-input-placeholderForeground: #6e6e6e;
      --vscode-panel-border: #2d2d30;
      --vscode-button-background: #0e639c;
      --vscode-button-foreground: #ffffff;
      --vscode-button-hoverBackground: #1177bb;
      --vscode-badge-background: #4d4d4d;
      --vscode-badge-foreground: #ffffff;
      --vscode-descriptionForeground: #9e9e9e;
      --vscode-scrollbarSlider-background: rgba(121,121,121,0.4);
      --vscode-scrollbarSlider-hoverBackground: rgba(100,100,100,0.7);
      --vscode-editor-selectionForeground: #ffffff;
    }
    /* Export overrides */
    body { background: #1e1e1e; color: #cccccc; max-width: 880px; margin: 0 auto; padding: 32px 24px; }
    .gsd-welcome, .gsd-scroll-fab, .gsd-slash-menu, .gsd-model-picker, .gsd-thinking-picker,
    .gsd-session-history, .gsd-copy-response-btn, .gsd-retry-btn,
    .gsd-turn-actions, .gsd-input-area, .gsd-header, .gsd-footer,
    .gsd-overlay-indicators, .gsd-context-bar-container { display: none !important; }
    .gsd-messages { padding: 0; }
`;
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rokket GSD — Export ${timestamp}</title>
  <style>
${pageCss}
${exportOverrides}
  </style>
</head>
<body>
  <h1 style="font-size: 20px; font-weight: 600; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #2a2a2e;">🚀 Rokket GSD — Conversation Export</h1>
  <div class="gsd-messages">${contentHtml}</div>
  <footer style="margin-top: 40px; padding-top: 16px; border-top: 1px solid #2a2a2e; color: #555; font-size: 12px;">
    Exported ${new Date().toLocaleString()} — Rokket GSD v${extVersion}
  </footer>
</body>
</html>`;
    // Show save dialog defaulting to Downloads
    const defaultUri = vscode.Uri.file(
      (process.env.USERPROFILE || process.env.HOME || "") + `\\Downloads\\gsd-export-${timestamp}.html`
    );
    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "HTML": ["html"] },
      title: "Export Conversation",
    });
    if (!uri) return; // user cancelled
    const exportPath = uri.fsPath;
    fs.writeFileSync(exportPath, fullHtml, "utf-8");
    // Open in default browser (cross-platform)
    vscode.env.openExternal(vscode.Uri.file(exportPath));
    vscode.window.showInformationMessage(`Exported to ${exportPath}`);
  } catch (err: any) {
    ctx.postToWebview(webview, { type: "error", message: `Export failed: ${err.message}` });
  }
}

export function handleSaveTempFile(
  ctx: FileOpsContext,
  webview: vscode.Webview,
  _sessionId: string,
  msg: { name: string; data: string },
): void {
  try {
    // Security: reject payloads exceeding 50MB (base64 is ~33% larger than raw)
    if (msg.data.length > 66_666_667) {
      ctx.output.appendLine(`[${_sessionId}] Blocked save_temp_file: payload exceeds 50MB limit`);
      ctx.postToWebview(webview, { type: "error", message: "File exceeds 50MB limit" });
      return;
    }
    const dir = ctx.ensureTempDir();
    // Sanitize filename — strip path separators
    const safeName = msg.name.replace(/[/\\]/g, "_");
    const filePath = path.join(dir, safeName);
    fs.writeFileSync(filePath, Buffer.from(msg.data, "base64"));
    ctx.postToWebview(webview, { type: "temp_file_saved", path: filePath, name: safeName });
  } catch (err: any) {
    ctx.postToWebview(webview, { type: "error", message: `Failed to save file: ${err.message}` });
  }
}

export async function handleCheckFileAccess(
  ctx: FileOpsContext,
  webview: vscode.Webview,
  _sessionId: string,
  msg: { paths: string[] },
): Promise<void> {
  // Security: validate all paths are within the workspace boundary
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let realRoot: string | null = null;
  if (workspaceRoot) {
    try {
      realRoot = fs.realpathSync(path.resolve(workspaceRoot));
    } catch {
      realRoot = null;
    }
  }

  const results = await Promise.all(
    msg.paths.map(async (p: string) => {
      try {
        // If no workspace open or root unresolvable, reject all paths
        if (!realRoot) {
          ctx.output.appendLine(`[check_file_access] Blocked: no workspace open`);
          return { path: p, readable: false };
        }
        const realFile = fs.realpathSync(path.resolve(p));
        if (!realFile.startsWith(realRoot + path.sep) && realFile !== realRoot) {
          ctx.output.appendLine(`[${_sessionId}] Blocked check_file_access outside workspace: ${realFile}`);
          return { path: p, readable: false };
        }
        await fs.promises.access(p, fs.constants.R_OK);
        return { path: p, readable: true };
      } catch {
        return { path: p, readable: false };
      }
    })
  );
  ctx.postToWebview(webview, { type: "file_access_result", results });
}

export async function handleAttachFiles(
  ctx: FileOpsContext,
  webview: vscode.Webview,
  _sessionId: string,
): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: false,
    openLabel: "Attach to GSD",
    filters: { "All Files": ["*"] },
  });
  if (uris && uris.length > 0) {
    const paths = uris.map(u => u.fsPath);
    ctx.postToWebview(webview, { type: "files_attached", paths });
  }
}

export async function handleCopyText(
  _ctx: FileOpsContext,
  _webview: vscode.Webview,
  _sessionId: string,
  msg: { text: string },
): Promise<void> {
  await vscode.env.clipboard.writeText(msg.text);
}

export async function handleSetTheme(
  _ctx: FileOpsContext,
  _webview: vscode.Webview,
  _sessionId: string,
  msg: { theme: string },
): Promise<void> {
  await vscode.workspace.getConfiguration("gsd").update("theme", msg.theme, vscode.ConfigurationTarget.Global);
}
