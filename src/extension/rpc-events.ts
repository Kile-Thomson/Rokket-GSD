import * as vscode from "vscode";
import type { GsdRpcClient } from "./rpc-client";
import type { SessionState } from "./session-state";
import type { ExtensionToWebviewMessage } from "../shared/types";
import { toGsdState, type RpcStateResult } from "../shared/types";
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

  // Late RPC error (e.g. "No API key") — clear watchdog and streaming state
  if (eventType === "error") {
    clearPromptWatchdog(ctx.watchdogCtx, sessionId);
    const session = ctx.getSession(sessionId);
    if (session.isStreaming) {
      session.isStreaming = false;
      ctx.emitStatus({ isStreaming: false });
      stopActivityMonitor(ctx.watchdogCtx, sessionId);
    }
    ctx.output.appendLine(`[${sessionId}] RPC error event: ${event.message}`);
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
      event.isContinuation = true;
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
    if (msg?.role === "assistant" && usage?.cost?.total && Number.isFinite(usage.cost.total)) {
      const session = ctx.getSession(sessionId);
      session.accumulatedCost += usage.cost.total;
      ctx.emitStatus({ cost: session.accumulatedCost });
    }
    // Check for error stopReason — clear streaming state even if agent_end never arrives
    const stopReason = (msg as Record<string, unknown> | undefined)?.stopReason as string | undefined;
    if (stopReason === "error") {
      const session = ctx.getSession(sessionId);
      session.isStreaming = false;
      ctx.emitStatus({ isStreaming: false });
      stopActivityMonitor(ctx.watchdogCtx, sessionId);
      ctx.output.appendLine(`[${sessionId}] message_end stopReason=error — cleared streaming state`);
    }
  } else if (eventType === "fallback_provider_switch") {
    const to = event.to as string || "";
    if (to) ctx.emitStatus({ model: to });
  } else if (eventType === "session_shutdown") {
    ctx.emitStatus({ isStreaming: false });
    ctx.getSession(sessionId).isStreaming = false;
    stopActivityMonitor(ctx.watchdogCtx, sessionId);
  } else if (eventType === 'session_switch') {
    // Session switched internally (e.g. /resume command) — refresh state and messages
    ctx.output.appendLine(`[${sessionId}] session_switch event — refreshing state`);
    Promise.all([
      client.getState().catch(() => null),
      client.getMessages().catch(() => null),
    ]).then(([stateResult, msgsResult]) => {
      const gsdState = stateResult ? toGsdState(stateResult as RpcStateResult) : toGsdState({} as RpcStateResult);
      const msgsObj = msgsResult as Record<string, unknown> | null;
      const messages = Array.isArray(msgsObj?.messages) ? msgsObj.messages : [];
      ctx.postToWebview(webview, { type: 'state', data: gsdState });
      ctx.postToWebview(webview, { type: 'session_switched', state: gsdState, messages });
    }).catch((err: unknown) => {
      ctx.output.appendLine(`[${sessionId}] session_switch refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  } else if (eventType === 'cost_update') {
    // v2 protocol: per-turn cost update — update status bar cost
    const cumulativeCost = event.cumulativeCost as number | undefined;
    if (cumulativeCost !== undefined) {
      const session = ctx.getSession(sessionId);
      session.accumulatedCost = cumulativeCost;
      ctx.emitStatus({ cost: cumulativeCost });
    }
  } else if (eventType === 'execution_complete') {
    // v2 protocol: execution run completed — refresh workflow state
    ctx.refreshWorkflowState(webview, sessionId);
  } else if (eventType === "extensions_ready") {
    // gsd-pi 2.44+: extensions finished loading — fetch definitive command and model lists.
    // Extensions like Ollama register providers asynchronously after session_start,
    // so the initial get_available_models response may be incomplete.
    ctx.output.appendLine(`[${sessionId}] extensions_ready — refreshing commands and models`);
    client.getCommands()
      .then((result) => {
        const r = result as Record<string, unknown> | null;
        const commands = Array.isArray(r?.commands) ? r.commands : [];
        ctx.postToWebview(webview, { type: "commands", commands } as ExtensionToWebviewMessage);
      })
      .catch((err: unknown) => {
        ctx.output.appendLine(`[${sessionId}] extensions_ready get_commands failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    client.getAvailableModels()
      .then((result) => {
        ctx.output.appendLine(`[${sessionId}] extensions_ready get_available_models raw: ${JSON.stringify(result)}`);
        const models = (result as Record<string, unknown> | null)?.models;
        ctx.postToWebview(webview, { type: "available_models", models: Array.isArray(models) ? models : [] } as ExtensionToWebviewMessage);
      })
      .catch((err: unknown) => {
        ctx.output.appendLine(`[${sessionId}] extensions_ready get_available_models failed: ${err instanceof Error ? err.message : String(err)}`);
      });
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
