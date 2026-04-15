import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
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

// ── Override file persistence ────────────────────────────────────────────

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
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
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
          } catch { /* ignored */ }
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
      if (/^\s*\/gsd\s+status\b/i.test(trimmed) ||
          (/^\s*\/gsd\s+auto\b/i.test(trimmed) && /\bstatus\b/i.test(trimmed))) {
        sendDashboardData(ctx, webview, sessionId).catch(() => {});
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("streaming")) {
        const isSlash = msg.message.trimStart().startsWith("/");
        try {
          const imgs = sanitizeImages(msg.images);
          if (isSlash) {
            startSlashCommandWatchdog(ctx.watchdogCtx, webview, sessionId, msg.message, imgs);
            armGsdFallbackProbe(ctx.commandFallbackCtx, msg.message.trim(), sessionId, webview);
            await abortAndPrompt(ctx.watchdogCtx, c, webview, msg.message, msg.images);
            startGsdFallbackTimer(ctx.commandFallbackCtx, msg.message.trim(), sessionId, webview);
            const retryTrimmed = msg.message.trim();
            if (/^\s*\/gsd\s+status\b/i.test(retryTrimmed) ||
                (/^\s*\/gsd\s+auto\b/i.test(retryTrimmed) && /\bstatus\b/i.test(retryTrimmed))) {
              sendDashboardData(ctx, webview, sessionId).catch(() => {});
            }
          } else {
            await c.steer(msg.message, imgs);
          }
        } catch (steerErr: unknown) {
          ctx.postToWebview(webview, { type: "error", message: toErrorMessage(steerErr) });
        }
      } else if (err instanceof Error && err.message.includes("process exited")) {
        ctx.postToWebview(webview, {
          type: "error",
          message: "GSD process exited unexpectedly. Try sending your message again to auto-restart.",
        });
      } else {
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

export async function handleSteer(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
  msg: Msg<"steer">,
): Promise<void> {
  const client = ctx.getSession(sessionId).client;
  if (client) {
    ctx.getSession(sessionId).lastUserActionTime = Date.now();
    try {
      if (msg.message.startsWith("/")) {
        await abortAndPrompt(ctx.watchdogCtx, client, webview, msg.message, msg.images);
      } else {
        const session = ctx.getSession(sessionId);
        const isAutoMode = !!session.autoModeState;
        if (isAutoMode && session.lastStartOptions?.cwd) {
          try {
            await appendOverrideFile(session.lastStartOptions.cwd, msg.message);
            ctx.output.appendLine(`[${sessionId}] Auto-mode steer persisted to OVERRIDES.md`);
            ctx.postToWebview(webview, { type: "steer_persisted" } as ExtensionToWebviewMessage);
          } catch (overrideErr: unknown) {
            ctx.output.appendLine(`[${sessionId}] Failed to persist override: ${toErrorMessage(overrideErr)}`);
          }
        }

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
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: `Steer failed: ${toErrorMessage(err)}` });
    }
  } else {
    ctx.postToWebview(webview, { type: "error", message: "Could not deliver message — no active GSD session. Send it again to start a new session." });
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
      const sess = ctx.getSession(sessionId);
      if (sess.promptWatchdog) { clearTimeout(sess.promptWatchdog.timer); sess.promptWatchdog = null; }
      if (sess.slashWatchdog) { clearTimeout(sess.slashWatchdog); sess.slashWatchdog = null; }
      if (sess.gsdFallbackTimer) { clearTimeout(sess.gsdFallbackTimer); sess.gsdFallbackTimer = null; }
    } catch (err: unknown) {
      ctx.output.appendLine(`[${sessionId}] Interrupt/abort failed: ${toErrorMessage(err)}`);
      ctx.getSession(sessionId).isStreaming = false;
      stopActivityMonitor(ctx.watchdogCtx, sessionId);
      ctx.emitStatus({ isStreaming: false });
      const wv = ctx.getSession(sessionId).webview;
      if (wv) {
        ctx.postToWebview(wv, { type: "agent_end", messages: [] } as ExtensionToWebviewMessage);
      }
    }
  }
}
