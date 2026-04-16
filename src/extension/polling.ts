import * as vscode from "vscode";
import type {
  ExtensionToWebviewMessage,
  SessionStats,
} from "../shared/types";
import type { SessionState } from "./session-state";
import { parseGsdWorkflowState } from "./state-parser";
import type { StatusBarUpdate } from "./webview-provider";
import { STATS_POLL_INTERVAL_MS, HEALTH_CHECK_INTERVAL_MS, HEALTH_PING_TIMEOUT_MS, WORKFLOW_POLL_INTERVAL_MS } from "../shared/constants";

// ============================================================
// Polling — stats, health monitoring, and workflow state
// ============================================================

export interface PollingContext {
  getSession(sessionId: string): SessionState;
  postToWebview(webview: vscode.Webview, message: ExtensionToWebviewMessage | Record<string, unknown>): void;
  readonly output: vscode.OutputChannel;
  emitStatus(update: Partial<StatusBarUpdate>): void;
  applySessionCostFloor(sessionId: string, stats: { cost?: number } | null | undefined): void;
}

/** Poll session stats every 5 seconds */
export function startStatsPolling(ctx: PollingContext, webview: vscode.Webview, sessionId: string): void {
  // Clear any existing timer
  const existing = ctx.getSession(sessionId).statsTimer;
  if (existing) clearInterval(existing);

  const poll = async () => {
    const session = ctx.getSession(sessionId);
    const client = session.client;
    if (!client?.isRunning) return;

    // Skip stats poll when auto-progress poller is active (it already fetches stats)
    // or when the session is idle (nothing is changing)
    if (session.autoProgressPoller?.isActive) return;
    if (!session.isStreaming) return;

    try {
      const stats = await client.getSessionStats() as SessionStats | null;
      if (stats) {
        ctx.applySessionCostFloor(sessionId, stats);
        ctx.postToWebview(webview, { type: "session_stats", data: stats } as ExtensionToWebviewMessage);
      }
    } catch {
      // Silently ignore — stats are best-effort
    }
  };

  // Poll every 5 seconds
  const timer = setInterval(poll, STATS_POLL_INTERVAL_MS);
  ctx.getSession(sessionId).statsTimer = timer;

  // Immediate first poll
  poll();
}

/** Health-check the GSD process every 30 seconds */
export function startHealthMonitoring(ctx: PollingContext, webview: vscode.Webview, sessionId: string): void {
  // Clear any existing timer
  const existing = ctx.getSession(sessionId).healthTimer;
  if (existing) clearInterval(existing);

  ctx.getSession(sessionId).healthState = "responsive";

  const check = async () => {
    const session = ctx.getSession(sessionId);
    const client = session.client;
    if (!client?.isRunning) return;

    // Only health-check while streaming — idle processes are just waiting for input
    if (!session.isStreaming) return;
    const isHealthy = await client.ping(HEALTH_PING_TIMEOUT_MS);
    const previousState = ctx.getSession(sessionId).healthState || "responsive";

    if (!isHealthy && previousState === "responsive") {
      // Process became unresponsive
      ctx.getSession(sessionId).healthState = "unresponsive";
      ctx.output.appendLine(`[${sessionId}] Health check: UNRESPONSIVE (ping timed out)`);
      ctx.postToWebview(webview, { type: "process_health", status: "unresponsive" } as ExtensionToWebviewMessage);
    } else if (isHealthy && previousState === "unresponsive") {
      // Process recovered
      ctx.getSession(sessionId).healthState = "recovered";
      ctx.output.appendLine(`[${sessionId}] Health check: recovered`);
      ctx.postToWebview(webview, { type: "process_health", status: "recovered" } as ExtensionToWebviewMessage);
      // Reset to responsive after emitting recovered
      ctx.getSession(sessionId).healthState = "responsive";
    }
  };

  // Check every 30 seconds
  const timer = setInterval(check, HEALTH_CHECK_INTERVAL_MS);
  ctx.getSession(sessionId).healthTimer = timer;
}

/** Read STATE.md and send current workflow state to the webview */
export async function refreshWorkflowState(ctx: PollingContext, webview: vscode.Webview, sessionId: string): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const state = await parseGsdWorkflowState(cwd);
  if (state) {
    state.autoMode = ctx.getSession(sessionId).autoModeState || null;
  }
  ctx.postToWebview(webview, { type: "workflow_state", state } as ExtensionToWebviewMessage);
}

/** Poll workflow state every 30 seconds */
export function startWorkflowPolling(ctx: PollingContext, webview: vscode.Webview, sessionId: string): void {
  const existing = ctx.getSession(sessionId).workflowTimer;
  if (existing) clearInterval(existing);

  // Initial refresh
  refreshWorkflowState(ctx, webview, sessionId);

  // Poll every 30 seconds
  const timer = setInterval(() => refreshWorkflowState(ctx, webview, sessionId), WORKFLOW_POLL_INTERVAL_MS);
  ctx.getSession(sessionId).workflowTimer = timer;
}

/** Stop all polling timers for a session (stats, health, workflow) */
export function stopAllPolling(ctx: PollingContext, sessionId: string): void {
  const session = ctx.getSession(sessionId);
  if (session.statsTimer) {
    clearInterval(session.statsTimer);
    session.statsTimer = null;
  }
  if (session.healthTimer) {
    clearInterval(session.healthTimer);
    session.healthTimer = null;
  }
  session.healthState = "responsive";
  if (session.workflowTimer) {
    clearInterval(session.workflowTimer);
    session.workflowTimer = null;
  }
}
