import * as vscode from "vscode";
import { toErrorMessage } from "../../shared/errors";
import type { MessageDispatchContext } from "../message-dispatch";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  SessionStats,
  RpcStateResult,
  RpcThinkingResult,
} from "../../shared/types";

type Msg<T extends WebviewToExtensionMessage["type"]> = Extract<WebviewToExtensionMessage, { type: T }>;

export async function handleSetModel(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"set_model">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client) {
    try {
      await client.setModel(msg.provider, msg.modelId);
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  }
}

export async function handleSetThinkingLevel(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"set_thinking_level">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  ctx.output.appendLine(`[${sessionId}] set_thinking_level: level=${msg.level}, client=${!!client}, isRunning=${client?.isRunning}`);
  if (client) {
    try {
      await client.setThinkingLevel(msg.level);
      const updatedState = await client.getState();
      const confirmedLevel = (updatedState as RpcStateResult)?.thinkingLevel ?? "off";
      ctx.output.appendLine(`[${sessionId}] set_thinking_level: RPC succeeded, confirmed=${JSON.stringify(confirmedLevel)}`);
      ctx.postToWebview(webview, { type: "thinking_level_changed", level: confirmedLevel });
      ctx.postToWebview(webview, { type: "state", data: updatedState } as ExtensionToWebviewMessage);
    } catch (err: unknown) {
      ctx.output.appendLine(`[${sessionId}] set_thinking_level: ERROR — ${toErrorMessage(err)}`);
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  }
}

export async function handleCycleThinkingLevel(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"cycle_thinking_level">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      const result = await client.cycleThinkingLevel() as RpcThinkingResult;
      if (result?.level) {
        ctx.postToWebview(webview, { type: "thinking_level_changed", level: result.level });
      }
      const state = await client.getState();
      ctx.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  }
}

export async function handleCompactContext(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"compact_context">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      ctx.postToWebview(webview, { type: "auto_compaction_start", reason: "manual" } as ExtensionToWebviewMessage);
      await client.compact();
      ctx.postToWebview(webview, { type: "auto_compaction_end", result: {}, aborted: false } as ExtensionToWebviewMessage);
      const stats = await client.getSessionStats() as SessionStats | null;
      if (stats) {
        ctx.applySessionCostFloor(sessionId, stats);
        ctx.postToWebview(webview, { type: "session_stats", data: stats } as ExtensionToWebviewMessage);
      }
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "auto_compaction_end", result: {}, aborted: true } as ExtensionToWebviewMessage);
      ctx.postToWebview(webview, { type: "error", message: `Compact failed: ${toErrorMessage(err)}` });
    }
  }
}

export async function handleSetAutoCompaction(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"set_auto_compaction">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      await client.setAutoCompaction(msg.enabled);
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  }
}

export async function handleSetAutoRetry(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"set_auto_retry">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      await client.setAutoRetry(msg.enabled);
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  }
}

export async function handleAbortRetry(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"abort_retry">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      await client.abortRetry();
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  }
}

export async function handleSetSteeringMode(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"set_steering_mode">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      await client.setSteeringMode(msg.mode);
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  }
}

export async function handleSetFollowUpMode(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"set_follow_up_mode">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      await client.setFollowUpMode(msg.mode);
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  }
}
