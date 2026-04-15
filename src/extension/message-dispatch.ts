import * as vscode from "vscode";
import type { SessionState } from "./session-state";
import { toErrorMessage } from "../shared/errors";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
} from "../shared/types";
import type { WatchdogContext } from "./watchdogs";
import type { CommandFallbackContext } from "./command-fallback";
import {
  handleOpenFile,
  handleOpenDiff,
  handleOpenUrl,
  handleExportHtml,
  handleSaveTempFile,
  handleCheckFileAccess,
  handleAttachFiles,
  handleCopyText,
  handleSetTheme,
  type FileOpsContext,
} from "./file-ops";
import {
  handleSetModel,
  handleSetThinkingLevel,
  handleCycleThinkingLevel,
  handleCompactContext,
  handleSetAutoCompaction,
  handleSetAutoRetry,
  handleAbortRetry,
  handleSetSteeringMode,
  handleSetFollowUpMode,
} from "./handlers/config-handlers";
import {
  handleGetState,
  handleGetSessionStats,
  handleGetCommands,
  handleGetAvailableModels,
  handleGetDashboard,
  handleGetChangelog,
} from "./handlers/query-handlers";
import {
  handleReady,
  handleLaunchGsd,
  handleForceKill,
  handleForceRestart,
  handleShutdown,
  handleRunBash,
  handleUpdateInstall,
  handleUpdateDismiss,
  handleUpdateViewRelease,
  handleExtensionUiResponse,
} from "./handlers/process-handlers";
import {
  handleNewConversation,
  handleGetSessionList,
  handleSwitchSession,
  handleRenameSession,
  handleDeleteSession,
  handleResumeLastSession,
} from "./handlers/session-handlers";
import {
  handlePrompt,
  handleSteer,
  handleFollowUp,
  handleInterrupt,
} from "./handlers/prompt-handlers";
import type { StatusBarUpdate } from "./webview-provider";

// ============================================================
// MessageDispatchContext — Everything the switch statement needs from the provider
// ============================================================

export interface MessageDispatchContext {
  getSession: (sessionId: string) => SessionState;
  postToWebview: (webview: vscode.Webview, message: ExtensionToWebviewMessage | Record<string, unknown>) => void;
  output: vscode.OutputChannel;
  emitStatus: (update: Partial<StatusBarUpdate>) => void;
  launchGsd: (webview: vscode.Webview, sessionId: string, cwd?: string) => Promise<void>;
  applySessionCostFloor: (sessionId: string, stats: { cost?: number } | null | undefined) => void;
  extensionContext: vscode.ExtensionContext;
  gsdVersion: string | undefined;
  getUseCtrlEnter: () => boolean;
  getTheme: () => string;
  checkWhatsNew: (webview: vscode.Webview) => Promise<void>;
  cleanupTempFiles: () => void;
  cleanupSession: (sessionId: string) => void;

  // Module contexts for extracted modules
  watchdogCtx: WatchdogContext;
  commandFallbackCtx: CommandFallbackContext;
  fileOpsCtx: FileOpsContext;
}

// ============================================================
// handleWebviewMessage — Thin routing switch
// ============================================================

export async function handleWebviewMessage(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: WebviewToExtensionMessage,
): Promise<void> {
  try {
      ctx.output.appendLine(`[${sessionId}] Webview -> Extension: ${msg.type}`);

      switch (msg.type) {
        case "ready": { await handleReady(ctx, webview, sessionId, msg); break; }
        case "launch_gsd": { await handleLaunchGsd(ctx, webview, sessionId, msg); break; }
        case "prompt": { await handlePrompt(ctx, webview, sessionId, msg); break; }
        case "steer": { await handleSteer(ctx, webview, sessionId, msg); break; }
        case "follow_up": { await handleFollowUp(ctx, webview, sessionId, msg); break; }
        case "interrupt":
        case "cancel_request": { await handleInterrupt(ctx, webview, sessionId, msg); break; }
        case "new_conversation": { await handleNewConversation(ctx, webview, sessionId, msg); break; }
        case "set_model": { await handleSetModel(ctx, webview, sessionId, msg); break; }
        case "set_thinking_level": { await handleSetThinkingLevel(ctx, webview, sessionId, msg); break; }
        case "get_dashboard": { await handleGetDashboard(ctx, webview, sessionId, msg); break; }
        case "get_changelog": { await handleGetChangelog(ctx, webview, sessionId, msg); break; }
        case "get_state": { await handleGetState(ctx, webview, sessionId, msg); break; }
        case "get_session_stats": { await handleGetSessionStats(ctx, webview, sessionId, msg); break; }
        case "get_commands": { await handleGetCommands(ctx, webview, sessionId, msg); break; }
        case "get_available_models": { await handleGetAvailableModels(ctx, webview, sessionId, msg); break; }
        case "cycle_thinking_level": { await handleCycleThinkingLevel(ctx, webview, sessionId, msg); break; }
        case "compact_context": { await handleCompactContext(ctx, webview, sessionId, msg); break; }
        case "export_html": { await handleExportHtml(ctx.fileOpsCtx, webview, sessionId, msg as any); break; }
        case "run_bash": { await handleRunBash(ctx, webview, sessionId, msg); break; }
        case "get_session_list": { await handleGetSessionList(ctx, webview, sessionId, msg); break; }
        case "switch_session": { await handleSwitchSession(ctx, webview, sessionId, msg as any); break; }
        case "rename_session": { await handleRenameSession(ctx, webview, sessionId, msg as any); break; }
        case "delete_session": { await handleDeleteSession(ctx, webview, sessionId, msg as any); break; }
        case "set_auto_compaction": { await handleSetAutoCompaction(ctx, webview, sessionId, msg); break; }
        case "set_auto_retry": { await handleSetAutoRetry(ctx, webview, sessionId, msg); break; }
        case "abort_retry": { await handleAbortRetry(ctx, webview, sessionId, msg); break; }
        case "set_steering_mode": { await handleSetSteeringMode(ctx, webview, sessionId, msg); break; }
        case "set_follow_up_mode": { await handleSetFollowUpMode(ctx, webview, sessionId, msg); break; }
        case "resume_last_session": { await handleResumeLastSession(ctx, webview, sessionId, msg); break; }
        case "force_kill": { await handleForceKill(ctx, webview, sessionId, msg); break; }
        case "force_restart": { await handleForceRestart(ctx, webview, sessionId, msg); break; }
        case "update_install": { await handleUpdateInstall(ctx, webview, sessionId, msg); break; }
        case "update_dismiss": { await handleUpdateDismiss(ctx, webview, sessionId, msg); break; }
        case "update_view_release": { await handleUpdateViewRelease(ctx, webview, sessionId, msg); break; }
        case "extension_ui_response": { await handleExtensionUiResponse(ctx, webview, sessionId, msg); break; }
        case "check_file_access": { await handleCheckFileAccess(ctx.fileOpsCtx, webview, sessionId, msg as any); break; }
        case "save_temp_file": { handleSaveTempFile(ctx.fileOpsCtx, webview, sessionId, msg as any); break; }
        case "attach_files": { await handleAttachFiles(ctx.fileOpsCtx, webview, sessionId); break; }
        case "copy_text": { await handleCopyText(ctx.fileOpsCtx, webview, sessionId, msg as any); break; }
        case "set_theme": { await handleSetTheme(ctx.fileOpsCtx, webview, sessionId, msg as any); break; }
        case "open_file": { handleOpenFile(ctx.fileOpsCtx, webview, sessionId, msg as any); break; }
        case "open_url": { handleOpenUrl(ctx.fileOpsCtx, webview, sessionId, msg as any); break; }
        case "open_diff": { handleOpenDiff(ctx.fileOpsCtx, webview, sessionId, msg as any); break; }
        case "shutdown": { await handleShutdown(ctx, webview, sessionId, msg); break; }
      }

  } catch (err: unknown) {
    const errorId = `ERR-${Date.now().toString(36)}`;
    ctx.output.appendLine(`[${sessionId}] [${errorId}] Unhandled error in message handler for "${msg.type}": ${toErrorMessage(err)}`);
    ctx.output.appendLine(`[${sessionId}] [${errorId}] Stack: ${err instanceof Error ? err.stack : "no stack"}`);
    ctx.postToWebview(webview, {
      type: "error",
      message: `[${errorId}] Internal error processing "${msg.type}". Check Output panel (Rokket GSD) for details.`,
    });
  }
}
