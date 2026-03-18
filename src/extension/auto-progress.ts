import * as vscode from "vscode";
import type { GsdRpcClient } from "./rpc-client";
import { buildDashboardData } from "./dashboard-parser";
import { countPendingCaptures } from "./captures-parser";
import type { AutoProgressData, ExtensionToWebviewMessage } from "../shared/types";

// ============================================================
// Auto-Progress Poller
//
// When auto-mode is active, polls .gsd/ files and RPC state
// every 3 seconds and pushes progress data to the webview.
// Bulletproof lifecycle: starts on setStatus "gsd-auto" = "auto"|"next",
// stops on undefined/paused, process exit, new conversation, or self-detection.
// ============================================================

const POLL_INTERVAL_MS = 3000;

export class AutoProgressPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private autoState: string | null = null;
  private autoStartTime: number = 0;
  private lastModel: { id: string; provider: string } | null = null;
  private disposed = false;

  constructor(
    private readonly sessionId: string,
    private readonly client: GsdRpcClient,
    private readonly webview: vscode.Webview,
    private readonly getCwd: () => string,
    private readonly output: vscode.OutputChannel,
    private readonly onModelChanged?: (oldModel: { id: string; provider: string } | null, newModel: { id: string; provider: string } | null) => void,
  ) {}

  /**
   * Called when a setStatus event arrives with statusKey "gsd-auto".
   * Values: "auto" | "next" | "paused" | undefined (stopped).
   */
  onAutoModeChanged(state: string | undefined): void {
    if (this.disposed) return;

    const prevState = this.autoState;
    this.autoState = state || null;

    if (state === "auto" || state === "next") {
      if (!prevState || prevState === "paused") {
        // Starting or resuming — begin polling
        if (!this.autoStartTime) {
          this.autoStartTime = Date.now();
        }
        this.startPolling();
      }
      // If already polling and state changed (auto↔next), just update — poll will pick up the new state
    } else {
      // Stopped or paused — stop polling but do a final poll to check for discussion pause
      this.stopPolling();
      this.finalPollAndMaybeClear();
    }
  }

  /**
   * Called when the GSD process exits. Unconditional cleanup.
   */
  onProcessExit(): void {
    this.stopPolling();
    this.autoState = null;
    this.autoStartTime = 0;
    this.lastModel = null;
    this.sendClear();
  }

  /**
   * Called when user starts a new conversation. Unconditional cleanup.
   */
  onNewConversation(): void {
    this.stopPolling();
    this.autoState = null;
    this.autoStartTime = 0;
    this.lastModel = null;
    this.sendClear();
  }

  /**
   * Permanently shut down this poller. Called when session is destroyed.
   */
  dispose(): void {
    this.disposed = true;
    this.stopPolling();
  }

  /** Whether the poller thinks auto-mode is active */
  get isActive(): boolean {
    return this.autoState === "auto" || this.autoState === "next";
  }

  // --- Internal ---

  /**
   * On pause/stop, do one final read of dashboard data to detect discussion pause.
   * If the phase is `needs-discussion`, keep the widget visible with paused state.
   * Otherwise, clear the widget as usual.
   */
  private async finalPollAndMaybeClear(): Promise<void> {
    try {
      const cwd = this.getCwd();
      const dashData = await buildDashboardData(cwd);
      const phase = dashData?.phase || "unknown";

      if (phase === "needs-discussion") {
        this.output.appendLine(`[${this.sessionId}] Auto-progress: discussion pause detected, keeping widget visible`);

        // Build a final progress snapshot with paused state
        let model: { id: string; provider: string } | null = this.lastModel;
        let cost: number | undefined;

        if (this.client.isRunning) {
          try {
            const stats = await this.client.getSessionStats() as Record<string, unknown> | null;
            if (stats?.cost !== undefined) {
              cost = stats.cost as number;
            }
          } catch {
            // Non-fatal
          }
        }

        const pendingCaptures = countPendingCaptures(cwd);

        const progress: AutoProgressData = {
          autoState: "paused",
          phase: "needs-discussion",
          milestone: dashData?.milestone || null,
          slice: dashData?.slice || null,
          task: dashData?.task || null,
          slices: dashData?.progress?.slices || { done: 0, total: 0 },
          tasks: dashData?.progress?.tasks || { done: 0, total: 0 },
          milestones: dashData?.progress?.milestones || { done: 0, total: 0 },
          timestamp: Date.now(),
          cost,
          model,
          pendingCaptures,
        };

        this.postToWebview({ type: "auto_progress", data: progress });
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[${this.sessionId}] Auto-progress final poll error: ${msg}`);
    }

    // Not a discussion pause (or error reading data) — clear as normal
    this.sendClear();
  }

  private startPolling(): void {
    if (this.timer) return; // Already polling

    this.output.appendLine(`[${this.sessionId}] Auto-progress poller started (state: ${this.autoState})`);

    // Do an immediate poll, then schedule interval
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.output.appendLine(`[${this.sessionId}] Auto-progress poller stopped`);
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed) {
      this.stopPolling();
      return;
    }

    // Self-check: if autoState somehow got cleared without stopPolling, bail
    if (!this.isActive) {
      this.stopPolling();
      this.sendClear();
      return;
    }

    try {
      // 1. Get RPC state for model info
      let model: { id: string; provider: string } | null = null;
      let cost: number | undefined;

      if (this.client.isRunning) {
        try {
          const rpcState = await this.client.getState() as Record<string, unknown> | null;
          if (rpcState?.model) {
            const m = rpcState.model as { id?: string; provider?: string };
            if (m.id && m.provider) {
              model = { id: m.id, provider: m.provider };
            }
          }
        } catch {
          // RPC timeout/error during poll — non-fatal, use stale data
        }

        // Get session stats for cost
        try {
          const stats = await this.client.getSessionStats() as Record<string, unknown> | null;
          if (stats?.cost !== undefined) {
            cost = stats.cost as number;
          }
        } catch {
          // Non-fatal
        }
      }

      // 2. Detect model changes
      if (model && this.lastModel) {
        if (model.id !== this.lastModel.id || model.provider !== this.lastModel.provider) {
          this.onModelChanged?.(this.lastModel, model);
        }
      }
      this.lastModel = model;

      // 3. Get dashboard data from .gsd/ files
      const cwd = this.getCwd();
      const dashData = await buildDashboardData(cwd);

      // 4. Count pending captures
      const pendingCaptures = countPendingCaptures(cwd);

      // 5. Build progress message
      const progress: AutoProgressData = {
        autoState: this.autoState!,
        phase: dashData?.phase || "unknown",
        milestone: dashData?.milestone || null,
        slice: dashData?.slice || null,
        task: dashData?.task || null,
        slices: dashData?.progress?.slices || { done: 0, total: 0 },
        tasks: dashData?.progress?.tasks || { done: 0, total: 0 },
        milestones: dashData?.progress?.milestones || { done: 0, total: 0 },
        timestamp: Date.now(),
        cost,
        model,
        pendingCaptures,
      };

      this.postToWebview({ type: "auto_progress", data: progress });
    } catch (err) {
      // Poll failure is non-fatal — log and continue
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[${this.sessionId}] Auto-progress poll error: ${msg}`);
    }
  }

  private sendClear(): void {
    this.postToWebview({ type: "auto_progress", data: null });
  }

  private postToWebview(message: ExtensionToWebviewMessage): void {
    try {
      this.webview.postMessage(message);
    } catch {
      // Webview may be disposed — non-fatal
    }
  }
}
