import * as vscode from "vscode";
import { fetchRecentReleases } from "../update-checker";
import { sendDashboardData } from "./dispatch-utils";
import type { MessageDispatchContext } from "../message-dispatch";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  SessionStats,
  RpcCommandsResult,
  RpcModelsResult,
} from "../../shared/types";

type Msg<T extends WebviewToExtensionMessage["type"]> = Extract<WebviewToExtensionMessage, { type: T }>;

export async function handleGetState(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"get_state">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      const state = await client.getState();
      ctx.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
    } catch (err: any) {
      ctx.postToWebview(webview, { type: "error", message: err.message });
    }
  }
}

export async function handleGetSessionStats(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"get_session_stats">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      const stats = await client.getSessionStats() as SessionStats | null;
      if (stats) {
        ctx.applySessionCostFloor(sessionId, stats);
        ctx.postToWebview(webview, { type: "session_stats", data: stats } as ExtensionToWebviewMessage);
      }
    } catch { /* ignored */ }
  }
}

export async function handleGetCommands(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"get_commands">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      const result = await client.getCommands() as RpcCommandsResult;
      ctx.postToWebview(webview, { type: "commands", commands: result?.commands || [] });
    } catch (err: any) {
      ctx.output.appendLine(`[${sessionId}] get_commands error: ${err.message}`);
      ctx.postToWebview(webview, { type: "commands", commands: [] });
    }
  } else {
    ctx.output.appendLine(`[${sessionId}] get_commands: client not running, will retry in 2s`);
    setTimeout(async () => {
      const retryClient = ctx.getSession(sessionId).client;
      if (retryClient?.isRunning) {
        try {
          const result = await retryClient.getCommands() as RpcCommandsResult;
          ctx.postToWebview(webview, { type: "commands", commands: result?.commands || [] });
        } catch (err: any) {
          ctx.output.appendLine(`[${sessionId}] get_commands retry error: ${err.message}`);
          ctx.postToWebview(webview, { type: "commands", commands: [] });
        }
      }
    }, 2000);
  }
}

export async function handleGetAvailableModels(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"get_available_models">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      const result = await client.getAvailableModels() as RpcModelsResult;
      ctx.postToWebview(webview, { type: "available_models", models: result?.models || [] });
    } catch (err: any) {
      ctx.output.appendLine(`[${sessionId}] get_available_models error: ${err.message}`);
    }
  }
}

export async function handleGetDashboard(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"get_dashboard">,
): Promise<void> {
  await sendDashboardData(ctx, webview, sessionId);
}

export async function handleGetChangelog(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"get_changelog">,
): Promise<void> {
  ctx.output.appendLine(`[${sessionId}] Fetching changelog...`);
  try {
    const entries = await fetchRecentReleases(15);
    ctx.output.appendLine(`[${sessionId}] Changelog fetched: ${entries.length} entries`);
    ctx.postToWebview(webview, { type: "changelog", entries } as ExtensionToWebviewMessage);
  } catch (err: any) {
    ctx.output.appendLine(`[${sessionId}] Changelog fetch error: ${err?.message}`);
    ctx.postToWebview(webview, { type: "changelog", entries: [] } as ExtensionToWebviewMessage);
  }
}
