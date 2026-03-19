import * as vscode from "vscode";
import type { GsdRpcClient } from "./rpc-client";
import type { SessionState } from "./session-state";
import type { ExtensionToWebviewMessage } from "../shared/types";
import type { StatusBarUpdate } from "./webview-provider";
import type { WatchdogContext } from "./watchdogs";
import {
  clearPromptWatchdog,
  startActivityMonitor,
  stopActivityMonitor,
} from "./watchdogs";

// ============================================================
// RPC Event Context — dependencies injected by webview-provider
// ============================================================

export interface RpcEventContext {
  getSession(sessionId: string): SessionState;
  postToWebview(webview: vscode.Webview, message: ExtensionToWebviewMessage | Record<string, unknown>): void;
  emitStatus(update: Partial<StatusBarUpdate>): void;
  readonly lastStatus: StatusBarUpdate;
  readonly output: vscode.OutputChannel;
  readonly watchdogCtx: WatchdogContext;
  refreshWorkflowState(webview: vscode.Webview, sessionId: string): Promise<void>;
  isWebviewVisible(sessionId: string): boolean;
  readonly webviewView?: vscode.WebviewView;
}

// ============================================================
// handleRpcEvent — forwards RPC events to the webview
// ============================================================

export function handleRpcEvent(
  ctx: RpcEventContext,
  webview: vscode.Webview,
  sessionId: string,
  event: Record<string, unknown>,
  client: GsdRpcClient
): void {
  const eventType = event.type as string;

  // Track event arrival — used by slash command watchdog
  ctx.getSession(sessionId).lastEventTime = Date.now();

  // Clear slash command watchdog on any event — command is alive
  const slashTimer = ctx.getSession(sessionId).slashWatchdog;
  if (slashTimer) {
    clearTimeout(slashTimer);
    ctx.getSession(sessionId).slashWatchdog = null;
  }

  if (eventType === "extension_ui_request") {
    handleExtensionUiRequest(ctx, webview, sessionId, event, client);
    return;
  }

  // Log extension errors to the output panel
  if (eventType === "extension_error") {
    const extPath = event.extensionPath as string || "unknown";
    const extEvent = event.event as string || "unknown";
    const extError = event.error as string || "unknown error";
    ctx.output.appendLine(`[${sessionId}] Extension error (${extPath}, ${extEvent}): ${extError}`);
  }

  // Update status bar based on event type
  if (eventType === "agent_start") {
    clearPromptWatchdog(ctx.watchdogCtx, sessionId);
    ctx.emitStatus({ isStreaming: true });
    ctx.getSession(sessionId).isStreaming = true;
    startActivityMonitor(ctx.watchdogCtx, webview, sessionId, client);
    // Mark that a real agent turn started (used by /gsd fallback detection)
    ctx.getSession(sessionId).gsdTurnStarted = true;
    // Turn coalescing: detect rapid-fire agent_start after agent_end with no user action
    const session = ctx.getSession(sessionId);
    const timeSinceEnd = Date.now() - session.lastAgentEndTime;
    const timeSinceUser = Date.now() - session.lastUserActionTime;
    if (timeSinceEnd < 1500 && timeSinceUser > timeSinceEnd) {
      (event as any).isContinuation = true;
      ctx.output.appendLine(`[${sessionId}] Turn coalescing: agent_start is a continuation (${timeSinceEnd}ms since last end, ${timeSinceUser}ms since user action)`);
    }
  } else if (eventType === "agent_end") {
    ctx.emitStatus({ isStreaming: false });
    ctx.getSession(sessionId).isStreaming = false;
    ctx.getSession(sessionId).lastAgentEndTime = Date.now();
    stopActivityMonitor(ctx.watchdogCtx, sessionId);
    // Cancel /gsd fallback — the command completed (even without agent_start)
    const gsdTimer = ctx.getSession(sessionId).gsdFallbackTimer;
    if (gsdTimer) {
      clearTimeout(gsdTimer);
      ctx.getSession(sessionId).gsdFallbackTimer = null;
    }
    // Refresh workflow state after each agent turn
    ctx.refreshWorkflowState(webview, sessionId);
  } else if (eventType === "message_end") {
    const msg = event.message as Record<string, unknown> | undefined;
    const usage = (msg?.usage as { cost?: { total?: number } }) ?? undefined;
    if (msg?.role === "assistant" && usage?.cost?.total) {
      ctx.emitStatus({ cost: (ctx.lastStatus.cost || 0) + usage.cost.total });
    }
  } else if (eventType === "fallback_provider_switch") {
    const to = (event as any).to as string || "";
    if (to) ctx.emitStatus({ model: to });
  } else if (eventType === "session_shutdown") {
    ctx.emitStatus({ isStreaming: false });
    ctx.getSession(sessionId).isStreaming = false;
    stopActivityMonitor(ctx.watchdogCtx, sessionId);
  }

  // Forward all other events directly to the webview
  ctx.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
}

// ============================================================
// handleExtensionUiRequest — handles UI interaction requests
// ============================================================

export async function handleExtensionUiRequest(
  ctx: RpcEventContext,
  webview: vscode.Webview,
  sessionId: string,
  event: Record<string, unknown>,
  client: GsdRpcClient
): Promise<void> {
  const id = event.id as string;
  const method = event.method as string;

  switch (method) {

    case "select":
    case "confirm":
    case "input": {
      // Forward to webview for inline rendering
      ctx.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);

      // Show a native VS Code notification so the user knows they need to respond,
      // but only if the webview isn't currently visible. Avoids notification spam
      // when the user is already looking at the GSD panel.
      const isWebviewVisible = ctx.isWebviewVisible(sessionId);
      if (!isWebviewVisible) {
        const title = event.title as string || event.message as string || "GSD needs your input";
        const truncatedTitle = title.length > 80 ? title.slice(0, 77) + "…" : title;
        vscode.window.showInformationMessage(
          `🚀 GSD: ${truncatedTitle}`,
          "Open GSD"
        ).then((action) => {
          if (action === "Open GSD") {
            // Bring the GSD panel/sidebar into view
            if (ctx.webviewView) {
              ctx.webviewView.show(true);
            }
            const panel = ctx.getSession(sessionId).panel;
            if (panel) {
              panel.reveal();
            }
          }
        });
      }
      break;
    }

    case "editor": {
      const title = event.title as string || "GSD";
      const prefill = event.prefill as string || "";

      const doc = await vscode.workspace.openTextDocument({
        content: prefill,
        language: "markdown",
      });

      await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
      });

      const result = await vscode.window.showInformationMessage(
        `${title}\n\nEdit the document and click Submit when done.`,
        "Submit",
        "Cancel"
      );

      const text = doc.getText();
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

      if (result === "Submit") {
        client.sendExtensionUiResponse({ type: "extension_ui_response", id, value: text });
      } else {
        client.sendExtensionUiResponse({ type: "extension_ui_response", id, cancelled: true });
      }
      break;
    }

    case "notify": {
      const message = event.message as string || "";
      const notifyType = event.notifyType as string || "info";

      // Suppress noisy startup info about optional tools/keys — not actionable for most users
      const isStartupNoise = notifyType === "info" && (
        /No \w+_API_KEY set/i.test(message) ||
        /\bfree tier\b/i.test(message) ||
        /\b(MCPorter|Web search)\b.*\b(ready|loaded)\b/i.test(message)
      );
      if (isStartupNoise) {
        ctx.output.appendLine(`[${sessionId}] [suppressed] ${message}`);
        break;
      }

      // Forward to webview — chat is the primary notification surface
      ctx.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
      break;
    }

    case "setStatus": {
      // Track auto-mode status for workflow badge
      if (event.statusKey === "gsd-auto") {
        const autoMode = event.statusText as string | undefined;
        ctx.getSession(sessionId).autoModeState = autoMode || null;
        ctx.refreshWorkflowState(webview, sessionId);
        // Cancel /gsd fallback — setStatus proves the command is working
        const gsdTimer = ctx.getSession(sessionId).gsdFallbackTimer;
        if (gsdTimer) {
          clearTimeout(gsdTimer);
          ctx.getSession(sessionId).gsdFallbackTimer = null;
        }
        // Forward to auto-progress poller
        const poller = ctx.getSession(sessionId).autoProgressPoller;
        if (poller) {
          poller.onAutoModeChanged(autoMode);
        }
      }
      ctx.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
      break;
    }
    case "setWidget":
    case "set_editor_text": {
      ctx.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
      break;
    }

    case "setTitle": {
      const title = event.title as string;
      const sessionPanel = ctx.getSession(sessionId).panel;
      if (sessionPanel && title) {
        sessionPanel.title = title;
      }
      break;
    }

    default: {
      ctx.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
      ctx.output.appendLine(`[${sessionId}] Unknown extension_ui method: ${method}`);
      break;
    }
  }
}
