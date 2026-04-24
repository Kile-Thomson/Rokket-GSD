import * as vscode from "vscode";
import { listSessions, deleteSession, validateSessionPath } from "./session-list-service";
import { downloadAndInstallUpdate, dismissUpdateVersion, fetchRecentReleases } from "./update-checker";
import { buildDashboardData } from "./dashboard-parser";
import { loadMetricsLedger, buildMetricsData } from "./metrics-parser";
import type { SessionState } from "./session-state";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  SessionStats,
  SessionListItem,
  RpcCommandsResult,
  RpcModelsResult,
  RpcThinkingResult,
  RpcStateResult,
  BashResult,
  AgentMessage,
} from "../shared/types";
import { toGsdState } from "../shared/types";
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
  TUI_ONLY_COMMAND_RE,
  handleTuiOnlyFallback,
  handleOllamaAction,
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
import type { StatusBarUpdate } from "./webview-provider";
import * as fs from "node:fs";
import * as path from "node:path";

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

  // Telegram sync
  telegramSyncToggle?: (sessionId: string, webview: vscode.Webview) => Promise<void>;
  cancelTelegramQuestion?: (requestId: string) => void;
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
// sendDashboardData — Build and send dashboard data to the webview
// ============================================================

async function sendDashboardData(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  try {
    const data = await buildDashboardData(cwd);
    // Merge session stats if available
    if (data) {
      const client = ctx.getSession(sessionId).client;
      if (client?.isRunning) {
        try {
          const statsResult = await client.getSessionStats() as Record<string, unknown> | null;
          if (statsResult) {
            data.stats = {
              cost: statsResult.cost as number | undefined,
              tokens: statsResult.tokens as { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | undefined,
              toolCalls: statsResult.toolCalls as number | undefined,
              userMessages: statsResult.userMessages as number | undefined,
            };
            ctx.applySessionCostFloor(sessionId, data.stats);
          }
        } catch {
          // Stats not available — that's fine
        }
      }
    }
    // Merge metrics data if available
    if (data) {
      try {
        const ledger = await loadMetricsLedger(cwd);
        if (ledger && ledger.units.length > 0) {
          const remainingSlices = data.slices.filter(s => !s.done).length;
          data.metrics = buildMetricsData(ledger, remainingSlices);
        }
      } catch {
        // Metrics not available — that's fine
      }
    }
    ctx.postToWebview(webview, { type: "dashboard_data", data } as ExtensionToWebviewMessage);
  } catch (_err: unknown) {
    ctx.postToWebview(webview, { type: "dashboard_data", data: null } as ExtensionToWebviewMessage);
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

          // Check if this is a first launch after an update — show "What's New"
          ctx.checkWhatsNew(webview).catch(() => {});
          break;
        }

        case "launch_gsd": {
          // Guard: don't launch a second process if one already exists for this session
          const existingLaunch = ctx.getSession(sessionId).client;
          if (existingLaunch?.isRunning) {
            ctx.output.appendLine(`[${sessionId}] launch_gsd: process already running (PID ${existingLaunch.pid}) — skipping`);
            // Re-push state so the webview knows it's running
            ctx.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
            try {
              const rpcState = await existingLaunch.getState();
              ctx.postToWebview(webview, { type: "state", data: toGsdState(rpcState as RpcStateResult) } as ExtensionToWebviewMessage);
            } catch { /* best effort */ }
          } else {
            await ctx.launchGsd(webview, sessionId, msg.cwd);
          }
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
            // Intercept TUI-only commands before sending to gsd-pi
            if (TUI_ONLY_COMMAND_RE.test(msg.message.trim())) {
              ctx.getSession(sessionId).lastUserActionTime = Date.now();
              await handleTuiOnlyFallback(ctx.commandFallbackCtx, c, webview, sessionId, msg.message.trim());
              break;
            }

            try {
              const images = msg.images?.map((img) => ({
                type: "image" as const,
                data: img.data,
                mimeType: img.mimeType,
              }));
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
                  const imgs = msg.images?.map((img) => ({
                    type: "image" as const,
                    data: img.data,
                    mimeType: img.mimeType,
                  }));
                  if (isSlash && TUI_ONLY_COMMAND_RE.test(msg.message.trim())) {
                    try { await c.abort(); } catch { /* may not be streaming */ }
                    await handleTuiOnlyFallback(ctx.commandFallbackCtx, c, webview, sessionId, msg.message.trim());
                  } else if (isSlash) {
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

                await client.steer(steerMessage, msg.images?.map((img) => ({
                  type: "image" as const,
                  data: img.data,
                  mimeType: img.mimeType,
                })));
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
              await client.followUp(msg.message, msg.images?.map((img) => ({
                type: "image" as const,
                data: img.data,
                mimeType: img.mimeType,
              })));
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
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
          ctx.cleanupTempFiles();
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              // Abort streaming if active before new session (FT-20/FT-25)
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
          break;
        }

        case "set_model": {
          const client = ctx.getSession(sessionId).client;
          if (client) {
            try {
              await client.setModel(msg.provider, msg.modelId);
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "set_thinking_level": {
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
            } catch (err: any) {
              ctx.output.appendLine(`[${sessionId}] set_thinking_level: ERROR — ${err.message}`);
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "get_dashboard": {
          await sendDashboardData(ctx, webview, sessionId);
          break;
        }

        case "get_changelog": {
          ctx.output.appendLine(`[${sessionId}] Fetching changelog...`);
          try {
            const entries = await fetchRecentReleases(15);
            ctx.output.appendLine(`[${sessionId}] Changelog fetched: ${entries.length} entries`);
            ctx.postToWebview(webview, { type: "changelog", entries } as ExtensionToWebviewMessage);
          } catch (err: any) {
            ctx.output.appendLine(`[${sessionId}] Changelog fetch error: ${err?.message}`);
            ctx.postToWebview(webview, { type: "changelog", entries: [] } as ExtensionToWebviewMessage);
          }
          break;
        }

        case "get_state": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const state = await client.getState();
              ctx.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "get_session_stats": {
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
          break;
        }

        case "get_commands": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const result = await client.getCommands() as RpcCommandsResult;
              ctx.postToWebview(webview, { type: "commands", commands: result?.commands || [] });
            } catch (err: any) {
              ctx.output.appendLine(`[${sessionId}] get_commands error: ${err.message}`);
              // Send empty commands so the webview at least marks commandsLoaded
              // and doesn't keep retrying on every keystroke
              ctx.postToWebview(webview, { type: "commands", commands: [] });
            }
          } else {
            // Process not running yet — queue a retry after a short delay.
            // This handles the race where the webview requests commands before
            // the GSD process has fully started.
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
          break;
        }

        case "get_available_models": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const result = await client.getAvailableModels() as RpcModelsResult;
              ctx.output.appendLine(`[${sessionId}] get_available_models raw: ${JSON.stringify(result)}`);
              ctx.postToWebview(webview, { type: "available_models", models: result?.models || [] });
            } catch (err: any) {
              ctx.output.appendLine(`[${sessionId}] get_available_models error: ${err.message}`);
              ctx.postToWebview(webview, { type: "available_models", models: [] });
            }
          } else {
            ctx.output.appendLine(`[${sessionId}] get_available_models: client not running`);
            ctx.postToWebview(webview, { type: "available_models", models: [] });
          }
          break;
        }

        case "cycle_thinking_level": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const result = await client.cycleThinkingLevel() as RpcThinkingResult;
              if (result?.level) {
                ctx.postToWebview(webview, { type: "thinking_level_changed", level: result.level });
              }
              // Refresh full state
              const state = await client.getState();
              ctx.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "compact_context": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              ctx.postToWebview(webview, { type: "auto_compaction_start", reason: "manual" } as ExtensionToWebviewMessage);
              await client.compact();
              ctx.postToWebview(webview, { type: "auto_compaction_end", result: {}, aborted: false } as ExtensionToWebviewMessage);
              // Refresh stats
              const stats = await client.getSessionStats() as SessionStats | null;
              if (stats) {
                ctx.applySessionCostFloor(sessionId, stats);
                ctx.postToWebview(webview, { type: "session_stats", data: stats } as ExtensionToWebviewMessage);
              }
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "auto_compaction_end", result: {}, aborted: true } as ExtensionToWebviewMessage);
              ctx.postToWebview(webview, { type: "error", message: `Compact failed: ${err.message}` });
            }
          }
          break;
        }

        case "export_html": {
          await handleExportHtml(ctx.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "run_bash": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            // Security: check for destructive shell patterns before execution
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
                break;
              }
            }
            try {
              const result = await client.executeBash(msg.command) as BashResult;
              ctx.postToWebview(webview, { type: "bash_result", result });
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: `Bash error: ${err.message}` });
            }
          }
          break;
        }

        case "get_session_list": {
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
          break;
        }

        case "switch_session": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              // Validate session path is inside sessions directory
              if (msg.path) validateSessionPath(msg.path);
              // Abort streaming if active before session switch (FT-20/FT-25)
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
                break;
              }
              ctx.getSession(sessionId).accumulatedCost = 0;
              ctx.emitStatus({ cost: 0 });
              // Get the new state and messages after switch
              const state = await client.getState() as RpcStateResult;
              const messagesResult = await client.getMessages() as { messages?: AgentMessage[] } | null;
              ctx.output.appendLine(`[${sessionId}] Switched session, ${messagesResult?.messages?.length || 0} messages`);
              ctx.postToWebview(webview, {
                type: "session_switched",
                state: toGsdState(state),
                messages: messagesResult?.messages || [],
              });
              // Update status bar
              if (state?.model) {
                ctx.emitStatus({ model: (state.model as any).id || (state.model as any).name });
              }
            } catch (err: any) {
              ctx.output.appendLine(`[${sessionId}] Session switch error: ${err.message}`);
              ctx.postToWebview(webview, { type: "error", message: `Failed to switch session: ${err.message}` });
            }
          }
          break;
        }

        case "rename_session": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.setSessionName(msg.name);
              ctx.output.appendLine(`[${sessionId}] Session renamed to: ${msg.name}`);
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: `Failed to rename session: ${err.message}` });
            }
          }
          break;
        }

        case "delete_session": {
          try {
            await deleteSession(msg.path);
            ctx.output.appendLine(`[${sessionId}] Deleted session: ${msg.path}`);
            // Refresh the session list
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
          break;
        }

        case "set_auto_compaction": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.setAutoCompaction(msg.enabled);
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "set_auto_retry": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.setAutoRetry(msg.enabled);
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "abort_retry": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.abortRetry();
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "set_steering_mode": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.setSteeringMode(msg.mode);
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "set_follow_up_mode": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.setFollowUpMode(msg.mode);
            } catch (err: any) {
              ctx.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "resume_last_session": {
          const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!cwd) {
            ctx.postToWebview(webview, { type: "error", message: "No workspace folder open" });
            break;
          }
          try {
            const sessions = await listSessions(cwd);
            if (sessions.length === 0) {
              ctx.postToWebview(webview, { type: "error", message: "No previous sessions found" });
              break;
            }
            // Sessions are sorted most-recent first
            const latest = sessions[0];
            const client = ctx.getSession(sessionId).client;
            if (client?.isRunning) {
              const result = await client.switchSession(latest.path) as { cancelled?: boolean } | null;
              if (result?.cancelled) {
                ctx.output.appendLine(`[${sessionId}] Resume cancelled`);
                break;
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
          break;
        }

        case "force_kill": {
          const client = ctx.getSession(sessionId).client;
          if (client) {
            ctx.output.appendLine(`[${sessionId}] Force-killing GSD process (PID: ${client.pid})`);
            client.forceKill();
          }
          break;
        }

        case "force_restart": {
          if (ctx.getSession(sessionId).isRestarting) {
            ctx.output.appendLine(`[${sessionId}] Force-restart already in progress — ignoring`);
            break;
          }
          const client = ctx.getSession(sessionId).client;
          if (client) {
            ctx.getSession(sessionId).isRestarting = true;
            ctx.output.appendLine(`[${sessionId}] Force-restarting GSD process`);
            client.forceKill();
            // Clean up existing timers before restart
            ctx.cleanupSession(sessionId);
            // Wait a moment for cleanup, then re-launch from scratch
            setTimeout(async () => {
              try {
                // getSession auto-creates if the session was disposed, which is
                // harmless — launchGsd will simply wire up a fresh session.
                ctx.getSession(sessionId).client = null;
                await ctx.launchGsd(webview, sessionId);
                ctx.output.appendLine(`[${sessionId}] GSD re-launched after force-kill`);
              } catch (err: any) {
                ctx.output.appendLine(`[${sessionId}] Force-restart failed: ${err.message}`);
                ctx.postToWebview(webview, { type: "error", message: `[GSD-ERR-030] Force-restart failed: ${err.message}` });
              } finally {
                // Guard: session may have been re-created or cleaned up — only
                // flip the flag if it still exists in the map.
                try { ctx.getSession(sessionId).isRestarting = false; } catch { /* disposed */ }
              }
            }, 1000);
          }
          break;
        }

        case "update_install": {
          // Security: only allow downloads from GitHub API
          const dlUrl = String(msg.downloadUrl || "");
          if (!dlUrl.startsWith("https://api.github.com/") && !dlUrl.startsWith("https://github.com/")) {
            ctx.output.appendLine(`[${sessionId}] Blocked update download from untrusted URL: ${dlUrl}`);
            ctx.postToWebview(webview, { type: "error", message: "Update blocked: download URL is not from GitHub." });
            break;
          }
          await downloadAndInstallUpdate(dlUrl, ctx.extensionContext);
          break;
        }

        case "update_dismiss": {
          await dismissUpdateVersion(msg.version, ctx.extensionContext);
          break;
        }

        case "update_view_release": {
          const releaseUrl = String(msg.htmlUrl || "");
          if (/^https?:\/\//i.test(releaseUrl)) {
            vscode.env.openExternal(vscode.Uri.parse(releaseUrl));
          }
          break;
        }

        case "extension_ui_response": {
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
          ctx.cancelTelegramQuestion?.(msg.id);
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

        case "ollama_action": {
          ctx.getSession(sessionId).lastUserActionTime = Date.now();
          await handleOllamaAction(ctx.commandFallbackCtx, webview, sessionId, msg.action, msg.model);
          break;
        }

        case "telegram_sync_toggle": {
          if (ctx.telegramSyncToggle) {
            await ctx.telegramSyncToggle(sessionId, webview);
          } else {
            ctx.output.appendLine(`[${sessionId}] telegram_sync_toggle: no handler registered`);
          }
          break;
        }

        case "telegram_setup": {
          await vscode.commands.executeCommand("gsd.telegramSetup");
          break;
        }

        case "set_openai_api_key": {
          await vscode.commands.executeCommand("gsd.setOpenAiApiKey");
          break;
        }

        case "shutdown": {
          const client = ctx.getSession(sessionId).client;
          if (client?.isRunning) {
            ctx.output.appendLine(`[${sessionId}] Graceful shutdown requested`);
            try {
              await client.shutdown();
            } catch (err: any) {
              ctx.output.appendLine(`[${sessionId}] Shutdown command failed: ${err.message}`);
              // Fall back to stop
              try {
                await client.stop();
              } catch (stopErr: any) {
                ctx.output.appendLine(`[${sessionId}] Fallback stop also failed: ${stopErr.message}`);
              }
            }
          }
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
