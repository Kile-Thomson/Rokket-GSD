import * as vscode from "vscode";
import { downloadAndInstallUpdate, dismissUpdateVersion } from "../update-checker";
import { toGsdState } from "../../shared/types";
import type { MessageDispatchContext } from "../message-dispatch";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  RpcStateResult,
  BashResult,
} from "../../shared/types";

type Msg<T extends WebviewToExtensionMessage["type"]> = Extract<WebviewToExtensionMessage, { type: T }>;

export async function handleReady(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  _sessionId: string,
  _msg: Msg<"ready">,
): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const extVersion = vscode.extensions.getExtension("rokketek.rokket-gsd")?.packageJSON?.version;
  ctx.postToWebview(webview, {
    type: "config",
    useCtrlEnterToSend: ctx.getUseCtrlEnter(),
    theme: ctx.getTheme(),
    cwd,
    version: ctx.gsdVersion,
    extensionVersion: extVersion,
  });

  ctx.checkWhatsNew(webview).catch(() => {});
}

export async function handleLaunchGsd(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"launch_gsd">,
): Promise<void> {
  const existingLaunch = ctx.getSession(sessionId).client;
  if (existingLaunch?.isRunning) {
    ctx.output.appendLine(`[${sessionId}] launch_gsd: process already running (PID ${existingLaunch.pid}) — skipping`);
    ctx.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
    try {
      const rpcState = await existingLaunch.getState();
      ctx.postToWebview(webview, { type: "state", data: toGsdState(rpcState as RpcStateResult) } as ExtensionToWebviewMessage);
    } catch { /* best effort */ }
  } else {
    await ctx.launchGsd(webview, sessionId, msg.cwd);
  }
}

export async function handleForceKill(
  ctx: MessageDispatchContext,
  _webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"force_kill">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client) {
    ctx.output.appendLine(`[${sessionId}] Force-killing GSD process (PID: ${client.pid})`);
    client.forceKill();
  }
}

export async function handleForceRestart(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"force_restart">,
): Promise<void> {
  if (ctx.getSession(sessionId).isRestarting) {
    ctx.output.appendLine(`[${sessionId}] Force-restart already in progress — ignoring`);
    return;
  }
  const client = ctx.getSession(sessionId).client;
  if (client) {
    ctx.getSession(sessionId).isRestarting = true;
    ctx.output.appendLine(`[${sessionId}] Force-restarting GSD process`);
    client.forceKill();
    ctx.cleanupSession(sessionId);
    setTimeout(async () => {
      try {
        ctx.getSession(sessionId).client = null;
        await ctx.launchGsd(webview, sessionId);
        ctx.output.appendLine(`[${sessionId}] GSD re-launched after force-kill`);
      } catch (err: any) {
        ctx.output.appendLine(`[${sessionId}] Force-restart failed: ${err.message}`);
        ctx.postToWebview(webview, { type: "error", message: `[GSD-ERR-030] Force-restart failed: ${err.message}` });
      } finally {
        try { ctx.getSession(sessionId).isRestarting = false; } catch { /* disposed */ }
      }
    }, 1000);
  }
}

export async function handleShutdown(
  ctx: MessageDispatchContext,
  _webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"shutdown">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    ctx.output.appendLine(`[${sessionId}] Graceful shutdown requested`);
    try {
      await client.shutdown();
    } catch (err: any) {
      ctx.output.appendLine(`[${sessionId}] Shutdown command failed: ${err.message}`);
      try {
        await client.stop();
      } catch (stopErr: any) {
        ctx.output.appendLine(`[${sessionId}] Fallback stop also failed: ${stopErr.message}`);
      }
    }
  }
}

export async function handleRunBash(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"run_bash">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    const destructivePatterns = [
      /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r|--force|--recursive)\b/,
      /\bformat\b/i,
      /\bmkfs\b/,
      /\bdd\b\s+/,
      /\b(chmod|chown)\s+.*-R/,
    ];
    const isDestructive = destructivePatterns.some((p) => p.test(msg.command));
    if (isDestructive) {
      const choice = await vscode.window.showWarningMessage(
        `This command may be destructive: ${msg.command.slice(0, 100)}`,
        { modal: true },
        "Run Anyway",
      );
      if (choice !== "Run Anyway") {
        ctx.postToWebview(webview, {
          type: "bash_result",
          result: { exitCode: 1, stdout: "", stderr: "Cancelled by user" } as BashResult,
        });
        return;
      }
    }
    try {
      const result = await client.executeBash(msg.command) as BashResult;
      ctx.postToWebview(webview, { type: "bash_result", result });
    } catch (err: any) {
      ctx.postToWebview(webview, { type: "error", message: `Bash error: ${err.message}` });
    }
  }
}

export async function handleUpdateInstall(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"update_install">,
): Promise<void> {
  const dlUrl = String(msg.downloadUrl || "");
  if (!dlUrl.startsWith("https://api.github.com/") && !dlUrl.startsWith("https://github.com/")) {
    ctx.output.appendLine(`[${sessionId}] Blocked update download from untrusted URL: ${dlUrl}`);
    ctx.postToWebview(webview, { type: "error", message: "Update blocked: download URL is not from GitHub." });
    return;
  }
  await downloadAndInstallUpdate(dlUrl, ctx.extensionContext);
}

export async function handleUpdateDismiss(
  ctx: MessageDispatchContext,
  _webview: vscode.Webview,
  _sessionId: string,
  msg: Msg<"update_dismiss">,
): Promise<void> {
  await dismissUpdateVersion(msg.version, ctx.extensionContext);
}

export async function handleUpdateViewRelease(
  _ctx: MessageDispatchContext,
  _webview: vscode.Webview,
  _sessionId: string,
  msg: Msg<"update_view_release">,
): Promise<void> {
  const releaseUrl = String(msg.htmlUrl || "");
  if (/^https?:\/\//i.test(releaseUrl)) {
    vscode.env.openExternal(vscode.Uri.parse(releaseUrl));
  }
}

export async function handleExtensionUiResponse(
  ctx: MessageDispatchContext,
  _webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"extension_ui_response">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client) {
    client.sendExtensionUiResponse({
      type: "extension_ui_response",
      id: msg.id,
      value: msg.value,
      values: msg.values,
      confirmed: msg.confirmed,
      cancelled: msg.cancelled,
    });
  }
}
