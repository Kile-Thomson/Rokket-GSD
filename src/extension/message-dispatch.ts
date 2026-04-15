import * as vscode from "vscode";
import type { SessionState } from "./session-state";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  RpcCommandsResult,
} from "../shared/types";
import {
  startPromptWatchdog,
  startSlashCommandWatchdog,
  stopActivityMonitor,
  abortAndPrompt,
  type WatchdogContext,
} from "./watchdogs";
import {
  armGsdFallbackProbe,
  startGsdFallbackTimer,
  type CommandFallbackContext,
} from "./command-fallback";
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
import { sendDashboardData } from "./handlers/dispatch-utils";
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
import type { StatusBarUpdate } from "./webview-provider";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Image payload validation ─────────────────────────────────────────────

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function sanitizeImages(
  images?: Array<{ data: string; mimeType: string }>,
): Array<{ type: "image"; data: string; mimeType: string }> | undefined {
  if (!images) return undefined;
  const valid = images
    .filter((img) => typeof img.data === "string" && img.data.length > 0 && ALLOWED_IMAGE_MIME.has(img.mimeType))
    .map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
  return valid.length > 0 ? valid : undefined;
}

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
// appendOverrideFile — Write a user override to .gsd/OVERRIDES.md
// Mirrors the GSD extension's appendOverride() so the extension
// host can persist steers during auto-mode without going through
// a slash command (which would abort the current turn).
// ============================================================

async function appendOverrideFile(cwd: string, change: string): Promise<void> {
  const gsdDir = path.join(cwd, ".gsd");
  const overridesPath = path.join(gsdDir, "OVERRIDES.md");
  const timestamp = new Date().toISOString();
  const entry = [
    `## Override: ${timestamp}`,
    "",
    `**Change:** ${change}`,
    `**Scope:** active`,
    `**Applied-at:** auto-mode/steer`,
    "",
    "---",
    "",
  ].join("\n");

  try {
    const existing = await fs.promises.readFile(overridesPath, "utf-8");
    await fs.promises.writeFile(overridesPath, existing.trimEnd() + "\n\n" + entry, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // Create .gsd dir if needed, then write fresh file
      await fs.promises.mkdir(gsdDir, { recursive: true });
      const header = [
        "# GSD Overrides",
        "",
        "User-issued overrides that supersede plan document content.",
        "",
        "---",
        "",
      ].join("\n");
      await fs.promises.writeFile(overridesPath, header + entry, "utf-8");
    } else {
      throw err;
    }
  }
}

// ============================================================
// handleWebviewMessage — The entire message dispatch switch
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
        case "ready": {
          await handleReady(ctx, webview, sessionId, msg);
          break;
        }

        case "launch_gsd": {
          await handleLaunchGsd(ctx, webview, sessionId, msg);
          break;
        }

        case "prompt": {
          const client = ctx.getSession(sessionId).client;

          if (!client?.isRunning) {
            if (client && !client.isRunning) {
              ctx.output.appendLine(`[${sessionId}] GSD process not running — restarting...`);
              ctx.postToWebview(webview, { type: "process_status", status: "restarting" } as ExtensionToWebviewMessage);
              try {
                const restarted = await client.restart();
                if (restarted) {
                  ctx.output.appendLine(`[${sessionId}] GSD restarted successfully`);
                  try {
                    const state = await client.getState();
                    ctx.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
                    ctx.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
                    // Re-fetch commands after restart
                    const cmdResult = await client.getCommands() as RpcCommandsResult;
                    ctx.postToWebview(webview, { type: "commands", commands: cmdResult?.commands || [] });
                  } catch { /* ignored */ }
                } else {
                  ctx.getSession(sessionId).client = null;
                  await ctx.launchGsd(webview, sessionId);
                }
              } catch (restartErr: any) {
                ctx.output.appendLine(`[${sessionId}] Restart failed: ${restartErr.message}`);
                ctx.getSession(sessionId).client = null;
                await ctx.launchGsd(webview, sessionId);
              }
            } else {
              await ctx.launchGsd(webview, sessionId);
            }
          }

          const c = ctx.getSession(sessionId).client;
          if (c?.isRunning) {
            try {
              const images = sanitizeImages(msg.images);
              // Start watchdog BEFORE awaiting prompt — if pi never acks the
              // RPC the await hangs forever and the watchdog would never start.
              if (msg.message.startsWith("/")) {
                startSlashCommandWatchdog(ctx.watchdogCtx, webview, sessionId, msg.message, images);
              } else {
                startPromptWatchdog(ctx.watchdogCtx, webview, sessionId, msg.message, images);
              }
              ctx.output.appendLine(`[${sessionId}] Sending prompt to RPC: "${msg.message.slice(0, 80)}"${images?.length ? ` (with ${images.length} image(s), ~${images.reduce((s, i) => s + i.data.length, 0)} base64 chars)` : ""}`);
              armGsdFallbackProbe(ctx.commandFallbackCtx, msg.message.trim(), sessionId, webview);
              ctx.getSession(sessionId).lastUserActionTime = Date.now();

              await c.prompt(msg.message, images);
              ctx.output.appendLine(`[${sessionId}] Prompt RPC resolved for: "${msg.message.slice(0, 80)}"`);
              startGsdFallbackTimer(ctx.commandFallbackCtx, msg.message.trim(), sessionId, webview);

              // When /gsd status is sent, also show our structured dashboard
              // since pi's TUI widget doesn't translate to RPC mode.
              // Also catch /gsd auto with status-related instructions.
              const trimmed = msg.message.trim();
              if (/^\s*\/gsd\s+status\b/i.test(trimmed) ||
                  (/^\s*\/gsd\s+auto\b/i.test(trimmed) && /\bstatus\b/i.test(trimmed))) {
                sendDashboardData(ctx, webview, sessionId).catch(() => {});
              }
            } catch (err: any) {
              if (err.message?.includes("streaming")) {
                const isSlash = msg.message.trimStart().startsWith("/");
                try {
                  const imgs = sanitizeImages(msg.images);
                  if (isSlash) {
                    startSlashCommandWatchdog(ctx.watchdogCtx, webview, sessionId, msg.message, imgs);
                    armGsdFallbackProbe(ctx.commandFallbackCtx, msg.message.trim(), sessionId, webview);
                    await abortAndPrompt(ctx.watchdogCtx, c, webview, msg.message, msg.images);
                    startGsdFallbackTimer(ctx.commandFallbackCtx, msg.message.trim(), sessionId, webview);
                    // Trigger dashboard for /gsd status in retry path too
                    const retryTrimmed = msg.message.trim();
                    if (/^\s*\/gsd\s+status\b/i.test(retryTrimmed) ||
                        (/^\s*\/gsd\s+auto\b/i.test(retryTrimmed) && /\bstatus\b/i.test(retryTrimmed))) {
                      sendDashboardData(ctx, webview, sessionId).catch(() => {});
                    }
                  } else {
                    await c.steer(msg.message, imgs);
                  }
                } catch (steerErr: any) {
                  ctx.postToWebview(webview, { type: "error", message: steerErr.message });
                }
              } else if (err.message?.includes("process exited")) {
                ctx.postToWebview(webview, {
                  type: "error",
                  message: "GSD process exited unexpectedly. Try sending your message again to auto-restart.",
                });
              } else {
                ctx.postToWebview(webview, { type: "error", message: err.message });
              }
            }
          } else {
            ctx.postToWebview(webview, {
              type: "error",
              message: "Failed to start GSD. Check the Output panel (GSD) for details.",
            });
          }
          break;
        }

        case "steer": {
          const client = ctx.getSession(sessionId).client;
          if (client) {
            ctx.getSession(sessionId).lastUserActionTime = Date.now();
            try {
              // Extension commands (slash commands) can't be steered — they need to run
              // as prompts. Abort the current stream first, then send as a prompt.
              if (msg.message.startsWith("/")) {
                await abortAndPrompt(ctx.watchdogCtx, client, webview, msg.message, msg.images);
              } else {
                // During auto-mode, persist as a durable override so subsequent tasks see it.
                // The RPC steer handles the current turn; OVERRIDES.md handles future ones.
                const session = ctx.getSession(sessionId);
                const isAutoMode = !!session.autoModeState;
                if (isAutoMode && session.lastStartOptions?.cwd) {
                  try {
                    await appendOverrideFile(session.lastStartOptions.cwd, msg.message);
                    ctx.output.appendLine(`[${sessionId}] Auto-mode steer persisted to OVERRIDES.md`);
                    ctx.postToWebview(webview, { type: "steer_persisted" } as ExtensionToWebviewMessage);
                  } catch (overrideErr: any) {
                    ctx.output.appendLine(`[${sessionId}] Failed to persist override: ${overrideErr.message}`);
                    // Non-fatal — the RPC steer still goes through for the current turn
                  }
                }

                // Build the steer message — enhanced during auto-mode to include override context
                const steerMessage = isAutoMode
                  ? [
                      "USER OVERRIDE — This instruction has been saved to `.gsd/OVERRIDES.md` and applies to all future tasks.",
                      "",
                      `**Override:** ${msg.message}`,
                      "",
                      "Acknowledge this override and continue your current work respecting it.",
                    ].join("\n")
                  : msg.message;

                await client.steer(steerMessage, sanitizeImages(msg.images));
              }
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: `Steer failed: ${err.message}` });
            }
          } else {
            ctx.postToWebview(webview, { type: "error", message: "Could not deliver message — no active GSD session. Send it again to start a new session." });
          }
          break;
        }

        case "follow_up": {
          const client = ctx.getSession(sessionId).client;
          if (client) {
            ctx.getSession(sessionId).lastUserActionTime = Date.now();
            try {
              await client.followUp(msg.message, sanitizeImages(msg.images));
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          } else {
            ctx.postToWebview(webview, { type: "error", message: "Could not deliver message — no active GSD session. Send it again to start a new session." });
          }
          break;
        }

        case "interrupt":
        case "cancel_request": {
          const client = ctx.getSession(sessionId).client;
          if (client) {
            try {
              await client.abort();
              // Clear watchdog/fallback timers on abort (FT-17/FT-22)
              const sess = ctx.getSession(sessionId);
              if (sess.promptWatchdog) { clearTimeout(sess.promptWatchdog.timer); sess.promptWatchdog = null; }
              if (sess.slashWatchdog) { clearTimeout(sess.slashWatchdog); sess.slashWatchdog = null; }
              if (sess.gsdFallbackTimer) { clearTimeout(sess.gsdFallbackTimer); sess.gsdFallbackTimer = null; }
            } catch (err: any) {
              ctx.output.appendLine(`[${sessionId}] Interrupt/abort failed: ${err.message}`);
              // If abort fails, force-clear streaming state on the webview side
              // so the user isn't stuck
              ctx.getSession(sessionId).isStreaming = false;
              stopActivityMonitor(ctx.watchdogCtx, sessionId);
              ctx.emitStatus({ isStreaming: false });
              // Notify webview so its state is consistent
              const wv = ctx.getSession(sessionId).webview;
              if (wv) {
                ctx.postToWebview(wv, { type: "agent_end", messages: [] } as ExtensionToWebviewMessage);
              }
            }
          }
          break;
        }

        case "new_conversation": {
          await handleNewConversation(ctx, webview, sessionId, msg);
          break;
        }

        case "set_model": {
          await handleSetModel(ctx, webview, sessionId, msg);
          break;
        }

        case "set_thinking_level": {
          await handleSetThinkingLevel(ctx, webview, sessionId, msg);
          break;
        }

        case "get_dashboard": {
          await handleGetDashboard(ctx, webview, sessionId, msg);
          break;
        }

        case "get_changelog": {
          await handleGetChangelog(ctx, webview, sessionId, msg);
          break;
        }

        case "get_state": {
          await handleGetState(ctx, webview, sessionId, msg);
          break;
        }

        case "get_session_stats": {
          await handleGetSessionStats(ctx, webview, sessionId, msg);
          break;
        }

        case "get_commands": {
          await handleGetCommands(ctx, webview, sessionId, msg);
          break;
        }

        case "get_available_models": {
          await handleGetAvailableModels(ctx, webview, sessionId, msg);
          break;
        }

        case "cycle_thinking_level": {
          await handleCycleThinkingLevel(ctx, webview, sessionId, msg);
          break;
        }

        case "compact_context": {
          await handleCompactContext(ctx, webview, sessionId, msg);
          break;
        }

        case "export_html": {
          await handleExportHtml(ctx.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "run_bash": {
          await handleRunBash(ctx, webview, sessionId, msg);
          break;
        }

        case "get_session_list": {
          await handleGetSessionList(ctx, webview, sessionId, msg);
          break;
        }

        case "switch_session": {
          await handleSwitchSession(ctx, webview, sessionId, msg as any);
          break;
        }

        case "rename_session": {
          await handleRenameSession(ctx, webview, sessionId, msg as any);
          break;
        }

        case "delete_session": {
          await handleDeleteSession(ctx, webview, sessionId, msg as any);
          break;
        }

        case "set_auto_compaction": {
          await handleSetAutoCompaction(ctx, webview, sessionId, msg);
          break;
        }

        case "set_auto_retry": {
          await handleSetAutoRetry(ctx, webview, sessionId, msg);
          break;
        }

        case "abort_retry": {
          await handleAbortRetry(ctx, webview, sessionId, msg);
          break;
        }

        case "set_steering_mode": {
          await handleSetSteeringMode(ctx, webview, sessionId, msg);
          break;
        }

        case "set_follow_up_mode": {
          await handleSetFollowUpMode(ctx, webview, sessionId, msg);
          break;
        }

        case "resume_last_session": {
          await handleResumeLastSession(ctx, webview, sessionId, msg);
          break;
        }

        case "force_kill": {
          await handleForceKill(ctx, webview, sessionId, msg);
          break;
        }

        case "force_restart": {
          await handleForceRestart(ctx, webview, sessionId, msg);
          break;
        }

        case "update_install": {
          await handleUpdateInstall(ctx, webview, sessionId, msg);
          break;
        }

        case "update_dismiss": {
          await handleUpdateDismiss(ctx, webview, sessionId, msg);
          break;
        }

        case "update_view_release": {
          await handleUpdateViewRelease(ctx, webview, sessionId, msg);
          break;
        }

        case "extension_ui_response": {
          await handleExtensionUiResponse(ctx, webview, sessionId, msg);
          break;
        }

        case "check_file_access": {
          await handleCheckFileAccess(ctx.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "save_temp_file": {
          handleSaveTempFile(ctx.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "attach_files": {
          await handleAttachFiles(ctx.fileOpsCtx, webview, sessionId);
          break;
        }

        case "copy_text": {
          await handleCopyText(ctx.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "set_theme": {
          await handleSetTheme(ctx.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "open_file": {
          handleOpenFile(ctx.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "open_url": {
          handleOpenUrl(ctx.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "open_diff": {
          handleOpenDiff(ctx.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "shutdown": {
          await handleShutdown(ctx, webview, sessionId, msg);
          break;
        }
      }

  } catch (err: any) {
    const errorId = `ERR-${Date.now().toString(36)}`;
    ctx.output.appendLine(`[${sessionId}] [${errorId}] Unhandled error in message handler for "${msg.type}": ${err.message}`);
    ctx.output.appendLine(`[${sessionId}] [${errorId}] Stack: ${err.stack || "no stack"}`);
    ctx.postToWebview(webview, {
      type: "error",
      message: `[${errorId}] Internal error processing "${msg.type}". Check Output panel (Rokket GSD) for details.`,
    });
  }
}
