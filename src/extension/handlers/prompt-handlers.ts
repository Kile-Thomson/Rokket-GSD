import * as vscode from "vscode";
import { toErrorMessage } from "../../shared/errors";
import {
  startPromptWatchdog,
  startSlashCommandWatchdog,
  stopActivityMonitor,
  abortAndPrompt,
} from "../watchdogs";
import {
  armGsdFallbackProbe,
  startGsdFallbackTimer,
  TUI_ONLY_COMMAND_RE,
  handleTuiOnlyFallback,
} from "../command-fallback";
import { sendDashboardData } from "./dispatch-utils";
import type { MessageDispatchContext } from "../message-dispatch";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  RpcCommandsResult,
} from "../../shared/types";

type Msg<T extends WebviewToExtensionMessage["type"]> = Extract<WebviewToExtensionMessage, { type: T }>;

// ── Image payload validation ─────────────────────────────────────────────

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function sanitizeImages(
  images?: Array<{ data: string; mimeType: string }>,
): Array<{ type: "image"; data: string; mimeType: string }> | undefined {
  if (!images) return undefined;
  const valid = images
    .filter((img) => typeof img.data === "string" && img.data.length > 0 && ALLOWED_IMAGE_MIME.has(img.mimeType))
    .map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
  return valid.length > 0 ? valid : undefined;
}

// ── Watchdog cleanup ────────────────────────────────────────────────────

function clearSessionWatchdogs(ctx: MessageDispatchContext, sessionId: string): void {
  const sess = ctx.getSession(sessionId);
  if (sess.promptWatchdog) { clearTimeout(sess.promptWatchdog.timer); sess.promptWatchdog = null; }
  if (sess.slashWatchdog) { clearTimeout(sess.slashWatchdog); sess.slashWatchdog = null; }
  if (sess.gsdFallbackTimer) { clearTimeout(sess.gsdFallbackTimer); sess.gsdFallbackTimer = null; }
}

// ── Handlers ─────────────────────────────────────────────────────────────

export async function handlePrompt(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"prompt">,
): Promise<void> {
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
            const cmdResult = await client.getCommands() as RpcCommandsResult;
            ctx.postToWebview(webview, { type: "commands", commands: cmdResult?.commands || [] });
          } catch (postRestartErr: unknown) {
            ctx.output.appendLine(`[${sessionId}] Post-restart state/commands fetch failed: ${toErrorMessage(postRestartErr)}`);
          }
        } else {
          ctx.getSession(sessionId).client = null;
          await ctx.launchGsd(webview, sessionId);
        }
      } catch (restartErr: unknown) {
        ctx.output.appendLine(`[${sessionId}] Restart failed: ${toErrorMessage(restartErr)}`);
        ctx.getSession(sessionId).client = null;
        await ctx.launchGsd(webview, sessionId);
      }
    } else {
      await ctx.launchGsd(webview, sessionId);
    }
  }

  const c = ctx.getSession(sessionId).client;
  if (c?.isRunning) {
    // Intercept TUI-only commands — they use ctx.ui.custom() which can't
    // render through RPC. Convert to an LLM prompt instead.
    if (TUI_ONLY_COMMAND_RE.test(msg.message.trim())) {
      ctx.getSession(sessionId).lastUserActionTime = Date.now();
      await handleTuiOnlyFallback(ctx.commandFallbackCtx, c, webview, sessionId, msg.message.trim());
      return;
    }

    try {
      const images = sanitizeImages(msg.images);

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

      const trimmed = msg.message.trim();
      if (/^\/gsd\s+status\b/i.test(trimmed) ||
          (/^\/gsd\s+auto\b/i.test(trimmed) && /\bstatus\b/i.test(trimmed))) {
        sendDashboardData(ctx, webview, sessionId).catch(() => {});
      }
    } catch (err: unknown) {
      if (err instanceof Error && (err.message.includes("streaming") || err.message.includes("already processing"))) {
        clearSessionWatchdogs(ctx, sessionId);
        const isSlash = msg.message.trimStart().startsWith("/");
        try {
          const imgs = sanitizeImages(msg.images);
          if (isSlash && TUI_ONLY_COMMAND_RE.test(msg.message.trim())) {
            try { await c.abort(); } catch { /* may not be streaming */ }
            await handleTuiOnlyFallback(ctx.commandFallbackCtx, c, webview, sessionId, msg.message.trim());
          } else if (isSlash) {
            startSlashCommandWatchdog(ctx.watchdogCtx, webview, sessionId, msg.message, imgs);
            armGsdFallbackProbe(ctx.commandFallbackCtx, msg.message.trim(), sessionId, webview);
            await abortAndPrompt(ctx.watchdogCtx, c, webview, msg.message, imgs);
            startGsdFallbackTimer(ctx.commandFallbackCtx, msg.message.trim(), sessionId, webview);
            const retryTrimmed = msg.message.trim();
            if (/^\/gsd\s+status\b/i.test(retryTrimmed) ||
                (/^\/gsd\s+auto\b/i.test(retryTrimmed) && /\bstatus\b/i.test(retryTrimmed))) {
              sendDashboardData(ctx, webview, sessionId).catch(() => {});
            }
          } else {
            await c.followUp(msg.message, imgs);
          }
        } catch (followUpErr: unknown) {
          ctx.postToWebview(webview, { type: "error", message: toErrorMessage(followUpErr) });
        }
      } else if (err instanceof Error && err.message.includes("process exited")) {
        clearSessionWatchdogs(ctx, sessionId);
        ctx.postToWebview(webview, {
          type: "error",
          message: "GSD process exited unexpectedly. Try sending your message again to auto-restart.",
        });
      } else {
        clearSessionWatchdogs(ctx, sessionId);
        ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
      }
    }
  } else {
    ctx.postToWebview(webview, {
      type: "error",
      message: "Failed to start GSD. Check the Output panel (GSD) for details.",
    });
  }
}


export async function handleFollowUp(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"follow_up">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client) {
    ctx.getSession(sessionId).lastUserActionTime = Date.now();
    try {
      await client.followUp(msg.message, sanitizeImages(msg.images));
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  } else {
    ctx.postToWebview(webview, { type: "error", message: "Could not deliver message — no active GSD session. Send it again to start a new session." });
  }
}

export async function handleInterrupt(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  _msg: Msg<"interrupt"> | Msg<"cancel_request">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client) {
    try {
      await client.abort();
    } catch (err: unknown) {
      ctx.output.appendLine(`[${sessionId}] Interrupt/abort failed: ${toErrorMessage(err)}`);
      const sess = ctx.getSession(sessionId);
      sess.isStreaming = false;
      stopActivityMonitor(ctx.watchdogCtx, sessionId);
      ctx.emitStatus({ isStreaming: false });
      const wv = sess.webview;
      if (wv) {
        ctx.postToWebview(wv, { type: "agent_end", messages: [] } as ExtensionToWebviewMessage);
      }
    }
  }
  // Always clear watchdog timers — they live on SessionState, not the RPC client
  clearSessionWatchdogs(ctx, sessionId);
}
