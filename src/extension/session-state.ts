import * as vscode from "vscode";
import { GsdRpcClient } from "./rpc-client";
import { AutoProgressPoller } from "./auto-progress";
import type { ProcessHealthStatus } from "../shared/types";

// ============================================================
// SessionState — consolidated per-session state
//
// Replaces 17+ individual Maps in GsdWebviewProvider.
// Each session (sidebar or tab panel) gets one SessionState instance.
// ============================================================

export interface PromptWatchdog {
  timer: ReturnType<typeof setTimeout>;
  retried: boolean;
  nonce: number;
  message: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
}

export interface SessionState {
  /** The RPC client for this session's GSD process */
  client: GsdRpcClient | null;
  /** The webview this session renders into */
  webview: vscode.Webview | null;
  /** WebviewPanel (for tab sessions only — sidebar sessions don't have one) */
  panel: vscode.WebviewPanel | null;

  // --- Timers ---
  statsTimer: ReturnType<typeof setInterval> | null;
  healthTimer: ReturnType<typeof setInterval> | null;
  workflowTimer: ReturnType<typeof setInterval> | null;
  activityTimer: ReturnType<typeof setInterval> | null;

  // --- Watchdogs ---
  promptWatchdog: PromptWatchdog | null;
  slashWatchdog: ReturnType<typeof setTimeout> | null;
  gsdFallbackTimer: ReturnType<typeof setTimeout> | null;

  // --- State flags ---
  healthState: ProcessHealthStatus;
  autoModeState: string | null;
  gsdTurnStarted: boolean;
  lastEventTime: number;
  isStreaming: boolean;
  isRestarting: boolean;

  // --- Turn coalescing ---
  lastAgentEndTime: number;
  lastUserActionTime: number;
  /** Running cost total — independent of pi's message-derived stats */
  accumulatedCost: number;

  // --- Auto-mode progress ---
  autoProgressPoller: AutoProgressPoller | null;

  // --- Lifecycle ---
  launchPromise: Promise<void> | null;
  messageHandlerDisposable: vscode.Disposable | null;
  lastStartOptions: {
    cwd: string;
    gsdPath?: string;
    env?: Record<string, string>;
    sessionDir?: string;
  } | null;
}

/**
 * Create a fresh SessionState with all fields at their defaults.
 */
export function createSessionState(): SessionState {
  return {
    client: null,
    webview: null,
    panel: null,
    statsTimer: null,
    healthTimer: null,
    workflowTimer: null,
    activityTimer: null,
    promptWatchdog: null,
    slashWatchdog: null,
    gsdFallbackTimer: null,
    healthState: "responsive",
    autoModeState: null,
    gsdTurnStarted: false,
    lastEventTime: 0,
    isStreaming: false,
    isRestarting: false,
    lastAgentEndTime: 0,
    lastUserActionTime: 0,
    accumulatedCost: 0,
    autoProgressPoller: null,
    launchPromise: null,
    messageHandlerDisposable: null,
    lastStartOptions: null,
  };
}

/**
 * Clean up all timers, watchdogs, and resources for a session.
 * Stops the RPC client and disposes the message handler.
 */
export function cleanupSessionState(session: SessionState): void {
  // Clear all timers
  if (session.statsTimer) clearInterval(session.statsTimer);
  if (session.healthTimer) clearInterval(session.healthTimer);
  if (session.workflowTimer) clearInterval(session.workflowTimer);
  if (session.activityTimer) clearInterval(session.activityTimer);
  if (session.promptWatchdog) clearTimeout(session.promptWatchdog.timer);
  if (session.slashWatchdog) clearTimeout(session.slashWatchdog);
  if (session.gsdFallbackTimer) clearTimeout(session.gsdFallbackTimer);

  session.statsTimer = null;
  session.healthTimer = null;
  session.workflowTimer = null;
  session.activityTimer = null;
  session.promptWatchdog = null;
  session.slashWatchdog = null;
  session.gsdFallbackTimer = null;

  session.healthState = "responsive";
  session.autoModeState = null;
  session.gsdTurnStarted = false;
  session.lastEventTime = 0;
  session.isStreaming = false;
  session.isRestarting = false;
  session.lastAgentEndTime = 0;
  session.lastUserActionTime = 0;
  session.accumulatedCost = 0;
  session.launchPromise = null;

  // Clean up auto-progress poller
  if (session.autoProgressPoller) {
    session.autoProgressPoller.dispose();
    session.autoProgressPoller = null;
  }

  // Fire-and-forget: stop() is async but callers don't need to wait for
  // graceful shutdown. The process is killed if it doesn't exit promptly.
  try { session.client?.stop(); } catch { /* ignore */ }
  try { session.messageHandlerDisposable?.dispose(); } catch { /* ignore */ }

  session.client = null;
  session.messageHandlerDisposable = null;
  session.webview = null;
  // Note: panel is NOT disposed here — the caller manages panel lifecycle
}
