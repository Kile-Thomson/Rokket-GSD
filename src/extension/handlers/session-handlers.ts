import * as vscode from "vscode";
import { listSessions, deleteSession, validateSessionPath } from "../session-list-service";
import { toGsdState } from "../../shared/types";
import type { MessageDispatchContext } from "../message-dispatch";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  SessionListItem,
  RpcStateResult,
  AgentMessage,
} from "../../shared/types";

type Msg<T extends WebviewToExtensionMessage["type"]> = Extract<WebviewToExtensionMessage, { type: T }>;

export async function handleNewConversation(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"new_conversation">,
): Promise<void> {
  ctx.cleanupTempFiles();
  ctx.getSession(sessionId).autoProgressPoller?.onNewConversation();
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      const sess = ctx.getSession(sessionId);
      if (sess.isStreaming) {
        try {
          await client.abort();
          if (sess.promptWatchdog) { clearTimeout(sess.promptWatchdog.timer); sess.promptWatchdog = null; }
          if (sess.slashWatchdog) { clearTimeout(sess.slashWatchdog); sess.slashWatchdog = null; }
          if (sess.gsdFallbackTimer) { clearTimeout(sess.gsdFallbackTimer); sess.gsdFallbackTimer = null; }
          ctx.output.appendLine(`[${sessionId}] Aborted streaming before new conversation`);
        } catch (abortErr: any) {
          ctx.output.appendLine(`[${sessionId}] Abort before new conversation failed: ${abortErr.message}`);
        }
      }
      await client.newSession();
      ctx.getSession(sessionId).accumulatedCost = 0;
      ctx.emitStatus({ cost: 0 });
      const state = await client.getState();
      ctx.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
    } catch (err: any) {
      ctx.postToWebview(webview, { type: "error", message: err.message });
    }
  }
}

export async function handleGetSessionList(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"get_session_list">,
): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  try {
    const sessions = await listSessions(cwd);
    const items: SessionListItem[] = sessions.map((s) => ({
      path: s.path,
      id: s.id,
      name: s.name,
      firstMessage: s.firstMessage,
      created: s.created.toISOString(),
      modified: s.modified.toISOString(),
      messageCount: s.messageCount,
    }));
    ctx.output.appendLine(`[${sessionId}] Listed ${items.length} sessions`);
    ctx.postToWebview(webview, { type: "session_list", sessions: items });
  } catch (err: any) {
    ctx.output.appendLine(`[${sessionId}] Session list error: ${err.message}`);
    ctx.postToWebview(webview, { type: "session_list_error", message: err.message });
  }
}

export async function handleSwitchSession(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"switch_session">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      if (msg.path) validateSessionPath(msg.path);
      const sess = ctx.getSession(sessionId);
      if (sess.isStreaming) {
        try {
          await client.abort();
          if (sess.promptWatchdog) { clearTimeout(sess.promptWatchdog.timer); sess.promptWatchdog = null; }
          if (sess.slashWatchdog) { clearTimeout(sess.slashWatchdog); sess.slashWatchdog = null; }
          if (sess.gsdFallbackTimer) { clearTimeout(sess.gsdFallbackTimer); sess.gsdFallbackTimer = null; }
          ctx.output.appendLine(`[${sessionId}] Aborted streaming before session switch`);
        } catch (abortErr: any) {
          ctx.output.appendLine(`[${sessionId}] Abort before session switch failed: ${abortErr.message}`);
        }
      }
      const result = await client.switchSession(msg.path) as { cancelled?: boolean } | null;
      if (result?.cancelled) {
        ctx.output.appendLine(`[${sessionId}] Session switch cancelled`);
        return;
      }
      ctx.getSession(sessionId).accumulatedCost = 0;
      ctx.emitStatus({ cost: 0 });
      const state = await client.getState() as RpcStateResult;
      const messagesResult = await client.getMessages() as { messages?: AgentMessage[] } | null;
      ctx.output.appendLine(`[${sessionId}] Switched session, ${messagesResult?.messages?.length || 0} messages`);
      ctx.postToWebview(webview, {
        type: "session_switched",
        state: toGsdState(state),
        messages: messagesResult?.messages || [],
      });
      if (state?.model) {
        ctx.emitStatus({ model: (state.model as any).id || (state.model as any).name });
      }
    } catch (err: any) {
      ctx.output.appendLine(`[${sessionId}] Session switch error: ${err.message}`);
      ctx.postToWebview(webview, { type: "error", message: `Failed to switch session: ${err.message}` });
    }
  }
}

export async function handleRenameSession(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"rename_session">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client?.isRunning) {
    try {
      await client.setSessionName(msg.name);
      ctx.output.appendLine(`[${sessionId}] Session renamed to: ${msg.name}`);
    } catch (err: any) {
      ctx.postToWebview(webview, { type: "error", message: `Failed to rename session: ${err.message}` });
    }
  }
}

export async function handleDeleteSession(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"delete_session">,
): Promise<void> {
  try {
    await deleteSession(msg.path);
    ctx.output.appendLine(`[${sessionId}] Deleted session: ${msg.path}`);
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const sessions = await listSessions(cwd);
    const items: SessionListItem[] = sessions.map((s) => ({
      path: s.path,
      id: s.id,
      name: s.name,
      firstMessage: s.firstMessage,
      created: s.created.toISOString(),
      modified: s.modified.toISOString(),
      messageCount: s.messageCount,
    }));
    ctx.postToWebview(webview, { type: "session_list", sessions: items });
  } catch (err: any) {
    ctx.output.appendLine(`[${sessionId}] Delete session error: ${err.message}`);
    ctx.postToWebview(webview, { type: "error", message: `Failed to delete session: ${err.message}` });
  }
}

export async function handleResumeLastSession(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"resume_last_session">,
): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    ctx.postToWebview(webview, { type: "error", message: "No workspace folder open" });
    return;
  }
  try {
    const sessions = await listSessions(cwd);
    if (sessions.length === 0) {
      ctx.postToWebview(webview, { type: "error", message: "No previous sessions found" });
      return;
    }
    const latest = sessions[0];
    const client = ctx.getSession(sessionId).client;
    if (client?.isRunning) {
      const result = await client.switchSession(latest.path) as { cancelled?: boolean } | null;
      if (result?.cancelled) {
        ctx.output.appendLine(`[${sessionId}] Resume cancelled`);
        return;
      }
      ctx.getSession(sessionId).accumulatedCost = 0;
      ctx.emitStatus({ cost: 0 });
      const state = await client.getState() as RpcStateResult;
      const messagesResult = await client.getMessages() as { messages?: AgentMessage[] } | null;
      ctx.output.appendLine(`[${sessionId}] Resumed last session: ${latest.name || latest.id} (${messagesResult?.messages?.length || 0} messages)`);
      ctx.postToWebview(webview, {
        type: "session_switched",
        state: toGsdState(state),
        messages: messagesResult?.messages || [],
      });
      if (state?.model) {
        ctx.emitStatus({ model: (state.model as any).id || (state.model as any).name });
      }
    }
  } catch (err: any) {
    ctx.output.appendLine(`[${sessionId}] Resume error: ${err.message}`);
    ctx.postToWebview(webview, { type: "error", message: `Failed to resume: ${err.message}` });
  }
}
