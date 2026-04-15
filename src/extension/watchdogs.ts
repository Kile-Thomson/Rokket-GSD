/**
 * Watchdog mechanisms extracted from GsdWebviewProvider.
 *
 * Three watchdogs monitor prompt/command delivery and process health:
 * - Prompt watchdog: detects when agent_start never arrives after a prompt
 * - Slash command watchdog: detects when no events arrive after a slash command
 * - Activity monitor: ping-based detection of truly stuck processes during streaming
 *
 * Plus the `abortAndPrompt` helper for aborting and re-sending a command.
 */

import * as vscode from "vscode";
import { toErrorMessage } from "../shared/errors";
import type { SessionState } from "./session-state";
import type { GsdRpcClient } from "./rpc-client";
import type { ExtensionToWebviewMessage } from "../shared/types";
import type { StatusBarUpdate } from "./webview-provider";
import {
  PROMPT_WATCHDOG_TIMEOUT_MS,
  SLASH_WATCHDOG_TIMEOUT_MS,
  ACTIVITY_CHECK_INTERVAL_MS,
  ACTIVITY_PING_TIMEOUT_MS,
  ABORT_SETTLE_DELAY_MS,
  ABORT_RETRY_DELAY_MS,
  ABORT_MAX_ATTEMPTS,
} from "../shared/constants";

// ============================================================
// WatchdogContext — dependency injection for standalone functions
// ============================================================

export interface WatchdogContext {
  getSession: (sessionId: string) => SessionState;
  postToWebview: (webview: vscode.Webview, message: ExtensionToWebviewMessage | Record<string, unknown>) => void;
  output: vscode.OutputChannel;
  emitStatus: (update: Partial<StatusBarUpdate>) => void;
  /** Mutable counter for prompt watchdog nonce — caller owns the state */
  nextPromptWatchdogNonce: () => number;
}

// ============================================================
// Prompt Watchdog
// ============================================================

/**
 * Start a watchdog timer after a prompt is acked by pi.
 * If no agent_start event arrives within the timeout, retry once then error.
 */
export function startPromptWatchdog(
  ctx: WatchdogContext,
  webview: vscode.Webview,
  sessionId: string,
  message: string,
  images?: Array<{ type: "image"; data: string; mimeType: string }>
): void {
  clearPromptWatchdog(ctx, sessionId);

  const nonce = ctx.nextPromptWatchdogNonce();

  const timer = setTimeout(async () => {
    const watchdog = ctx.getSession(sessionId).promptWatchdog;
    // Stale callback — a newer watchdog has replaced this one
    if (!watchdog || watchdog.nonce !== nonce) return;

    const client = ctx.getSession(sessionId).client;
    if (!client?.isRunning) {
      clearPromptWatchdog(ctx, sessionId);
      return;
    }

    if (!watchdog.retried) {
      // First timeout — retry the prompt once
      ctx.output.appendLine(`[${sessionId}] Prompt watchdog: no agent_start after ${PROMPT_WATCHDOG_TIMEOUT_MS / 1000}s — retrying prompt`);
      watchdog.retried = true;

      try {
        // Start the final-chance watchdog BEFORE awaiting — if prompt()
        // hangs, we still need the timer to fire.
        watchdog.timer = setTimeout(() => {
          const finalCheck = ctx.getSession(sessionId).promptWatchdog;
          if (!finalCheck || finalCheck.nonce !== nonce) return;

          ctx.output.appendLine(`[${sessionId}] Prompt watchdog: retry also got no response — notifying user`);
          clearPromptWatchdog(ctx, sessionId);
          ctx.postToWebview(webview, {
            type: "error",
            message: "GSD accepted the command but didn't start processing. Try sending it again.",
          } as ExtensionToWebviewMessage);
        }, PROMPT_WATCHDOG_TIMEOUT_MS);

        await client.prompt(message, images);
        // Re-check nonce after await — a new prompt may have started during the retry
        const current = ctx.getSession(sessionId).promptWatchdog;
        if (!current || current.nonce !== nonce) return;
      } catch (err: unknown) {
        ctx.output.appendLine(`[${sessionId}] Prompt watchdog: retry failed — ${toErrorMessage(err)}`);
        // Only clear if this watchdog is still current
        const current = ctx.getSession(sessionId).promptWatchdog;
        if (current?.nonce === nonce) {
          clearPromptWatchdog(ctx, sessionId);
        }
        // Don't show error — the prompt() catch block already handles this
      }
    }
  }, PROMPT_WATCHDOG_TIMEOUT_MS);

  ctx.getSession(sessionId).promptWatchdog = { timer, retried: false, nonce, message, images };
}

/**
 * Clear the prompt watchdog for a session.
 */
export function clearPromptWatchdog(ctx: WatchdogContext, sessionId: string): void {
  const watchdog = ctx.getSession(sessionId).promptWatchdog;
  if (watchdog) {
    clearTimeout(watchdog.timer);
    ctx.getSession(sessionId).promptWatchdog = null;
  }
}

// ============================================================
// Slash Command Watchdog
// ============================================================

/**
 * Slash command watchdog — slash commands don't emit agent_start, so the
 * regular watchdog can't be used. Instead, watch for ANY event arriving
 * within the timeout. If nothing comes, retry once then notify the user.
 */
export function startSlashCommandWatchdog(
  ctx: WatchdogContext,
  webview: vscode.Webview,
  sessionId: string,
  message: string,
  images?: Array<{ type: "image"; data: string; mimeType: string }>
): void {
  // Clear any existing slash watchdog
  const existing = ctx.getSession(sessionId).slashWatchdog;
  if (existing) clearTimeout(existing);

  const sentAt = Date.now();

  const timer = setTimeout(async () => {
    ctx.getSession(sessionId).slashWatchdog = null;

    // Check if any event arrived since we sent the command
    const lastEvent = ctx.getSession(sessionId).lastEventTime || 0;
    if (lastEvent > sentAt) {
      // Events are flowing — command is alive, no action needed
      return;
    }

    const client = ctx.getSession(sessionId).client;
    if (!client?.isRunning) return;

    // Retry once
    ctx.output.appendLine(`[${sessionId}] Slash watchdog: no events after ${SLASH_WATCHDOG_TIMEOUT_MS / 1000}s for "${message}" — retrying`);
    try {
      const retrySentAt = Date.now();
      // Start the final-chance watchdog BEFORE awaiting — if prompt()
      // hangs, we still need the timer to fire.
      const retryTimer = setTimeout(() => {
        ctx.getSession(sessionId).slashWatchdog = null;
        const lastRetryEvent = ctx.getSession(sessionId).lastEventTime || 0;
        if (lastRetryEvent > retrySentAt) return; // events flowing since retry

        ctx.output.appendLine(`[${sessionId}] Slash watchdog: retry also got no response for "${message}"`);
        ctx.postToWebview(webview, {
          type: "error",
          message: `Command "${message}" was sent but got no response. Try sending it again.`,
        } as ExtensionToWebviewMessage);
      }, SLASH_WATCHDOG_TIMEOUT_MS);
      ctx.getSession(sessionId).slashWatchdog = retryTimer;

      await client.prompt(message, images);
    } catch (err: unknown) {
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
    }
  }, SLASH_WATCHDOG_TIMEOUT_MS);

  ctx.getSession(sessionId).slashWatchdog = timer;
}

// ============================================================
// Activity Monitor
// ============================================================

/**
 * Streaming activity monitor — uses health pings to detect truly stuck
 * processes during an active agent turn.
 *
 * Why ping-based, not event-based: Long-running tools (subagent, bg_shell)
 * may not emit ANY intermediate events through RPC for 5+ minutes while
 * doing real work. Event-based monitoring would abort healthy work.
 * Ping-based monitoring only fires when the GSD process itself is
 * unresponsive — meaning it can't even answer a get_state request.
 *
 * Escalation:
 *  1. First unresponsive ping → log, notify webview, keep monitoring
 *  2. Two consecutive unresponsive pings → abort
 *  3. Abort fails → force-kill
 */
export function startActivityMonitor(
  ctx: WatchdogContext,
  webview: vscode.Webview,
  sessionId: string,
  client: GsdRpcClient
): void {
  stopActivityMonitor(ctx, sessionId);

  let consecutiveFailures = 0;

  const timer = setInterval(async () => {
    // Only act while streaming
    if (!ctx.getSession(sessionId).isStreaming) {
      stopActivityMonitor(ctx, sessionId);
      return;
    }

    if (!client.isRunning) {
      stopActivityMonitor(ctx, sessionId);
      return;
    }

    const isAlive = await client.ping(ACTIVITY_PING_TIMEOUT_MS);

    if (isAlive) {
      // Process is responsive — reset failure count
      if (consecutiveFailures > 0) {
        ctx.output.appendLine(`[${sessionId}] Activity monitor: process recovered after ${consecutiveFailures} failed ping(s)`);
        consecutiveFailures = 0;
      }
      return;
    }

    consecutiveFailures++;
    ctx.output.appendLine(`[${sessionId}] Activity monitor: ping failed (${consecutiveFailures} consecutive)`);

    if (consecutiveFailures === 1) {
      // First failure — warn but don't act yet (could be transient)
      ctx.postToWebview(webview, {
        type: "error",
        message: "GSD process is not responding — monitoring...",
      } as ExtensionToWebviewMessage);
      return;
    }

    // Two or more consecutive failures — process is truly stuck
    ctx.output.appendLine(`[${sessionId}] Activity monitor: ${consecutiveFailures} consecutive ping failures — aborting`);
    stopActivityMonitor(ctx, sessionId);

    ctx.postToWebview(webview, {
      type: "error",
      message: `GSD process unresponsive for ${consecutiveFailures * ACTIVITY_CHECK_INTERVAL_MS / 1000}s — aborting to recover.`,
    } as ExtensionToWebviewMessage);

    // Try graceful abort first
    try {
      await client.abort();
      // Wait a moment for agent_end to arrive naturally
      await new Promise(r => setTimeout(r, ABORT_SETTLE_DELAY_MS));
      // If still streaming, force-push agent_end to unblock the webview
      if (ctx.getSession(sessionId).isStreaming) {
        ctx.output.appendLine(`[${sessionId}] Activity monitor: abort succeeded but no agent_end — forcing`);
        ctx.getSession(sessionId).isStreaming = false;
        ctx.emitStatus({ isStreaming: false });
        ctx.postToWebview(webview, { type: "agent_end", messages: [] } as ExtensionToWebviewMessage);
      }
    } catch {
      // If abort fails, the process may be truly hung — force kill
      ctx.output.appendLine(`[${sessionId}] Activity monitor: abort failed, force-killing`);
      ctx.getSession(sessionId).isStreaming = false;
      ctx.emitStatus({ isStreaming: false });
      ctx.postToWebview(webview, { type: "agent_end", messages: [] } as ExtensionToWebviewMessage);
      client.forceKill();
    }
  }, ACTIVITY_CHECK_INTERVAL_MS);

  ctx.getSession(sessionId).activityTimer = timer;
}

/**
 * Stop the activity monitor for a session.
 */
export function stopActivityMonitor(ctx: WatchdogContext, sessionId: string): void {
  const timer = ctx.getSession(sessionId).activityTimer;
  if (timer) {
    clearInterval(timer);
    ctx.getSession(sessionId).activityTimer = null;
  }
}

// ============================================================
// Abort and Prompt
// ============================================================

/**
 * Abort the current stream and re-send a slash command as a prompt.
 * Uses bounded retry to wait for the abort to settle before prompting.
 */
export async function abortAndPrompt(
  ctx: WatchdogContext,
  client: GsdRpcClient,
  webview: vscode.Webview,
  message: string,
  images?: Array<{ data: string; mimeType: string }>,
): Promise<void> {
  try { await client.abort(); } catch { /* may not be streaming */ }

  const imgs = images?.map((img) => ({
    type: "image" as const,
    data: img.data,
    mimeType: img.mimeType,
  }));

  // Bounded retry — wait for stream teardown before sending the command
  for (let attempt = 0; attempt < ABORT_MAX_ATTEMPTS; attempt++) {
    try {
      await client.prompt(message, imgs);
      return;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("streaming") && attempt < ABORT_MAX_ATTEMPTS - 1) {
        ctx.output.appendLine(`[abortAndPrompt] Retry ${attempt + 1}/${ABORT_MAX_ATTEMPTS - 1}: stream not yet settled`);
        await new Promise((r) => setTimeout(r, ABORT_RETRY_DELAY_MS));
        continue;
      }
      ctx.postToWebview(webview, { type: "error", message: toErrorMessage(err) });
      return;
    }
  }
}
