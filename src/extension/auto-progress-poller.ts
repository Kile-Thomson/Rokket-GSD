import * as vscode from "vscode";
import type { GsdRpcClient } from "./rpc-client";
import { buildDashboardData } from "./dashboard-parser";
import { countPendingCaptures } from "./captures-parser";
import { readParallelWorkers, readBudgetCeiling } from "./parallel-status";
import type { AutoProgressData, WorkerProgress, ExtensionToWebviewMessage } from "../shared/types";
import { AUTO_PROGRESS_POLL_INTERVAL_MS, BUDGET_CEILING_TTL_MS, BUDGET_ALERT_PERCENT } from "../shared/constants";

// ============================================================
// Auto-Progress Poller
//
// When auto-mode is active, polls .gsd/ files and RPC state
// every 3 seconds and pushes progress data to the webview.
// Bulletproof lifecycle: starts on setStatus "gsd-auto" = "auto"|"next",
// stops on undefined/paused, process exit, new conversation, or self-detection.
// ============================================================

export class AutoProgressPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private autoState: string | null = null;
  private autoStartTime: number = 0;
  private lastModel: { id: string; provider: string } | null = null;
  private disposed = false;

  /** Budget ceiling cache — avoids re-parsing preferences.md every poll */
  private budgetCeiling: number | null = null;
  private budgetCeilingReadAt = 0;

  /** Budget alert guard — fires once when any worker crosses 80%, resets when all drop below */
  private lastBudgetAlertFired = false;

  constructor(
    private readonly sessionId: string,
    private readonly client: GsdRpcClient,
    private webview: vscode.Webview,
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
   * Update the webview reference after sidebar rebind so polls post to the current webview.
   */
  rebindWebview(webview: vscode.Webview): void {
    this.webview = webview;
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

        // Build a final progress snapshot with paused state — parallel fetches
        const model: { id: string; provider: string } | null = this.lastModel;
        let cost: number | undefined;

        const [stats, pendingCaptures] = await Promise.all([
          this.client.isRunning
            ? this.client.getSessionStats().catch(() => null) as Promise<Record<string, unknown> | null>
            : Promise.resolve(null),
          countPendingCaptures(cwd),
        ]);

        if (stats?.cost !== undefined) {
          cost = stats.cost as number;
        }

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
    this.timer = setInterval(() => this.poll(), AUTO_PROGRESS_POLL_INTERVAL_MS);
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
      const cwd = this.getCwd();
      let model: { id: string; provider: string } | null = null;
      let cost: number | undefined;

      // 1. Run RPC + filesystem reads in a single Promise.all — zero data dependency between them
      const rpcRunning = this.client.isRunning;
      const [rpcState, stats, dashData, pendingCaptures, rawWorkers] = await Promise.all([
        rpcRunning ? this.client.getState().catch(() => null) as Promise<Record<string, unknown> | null> : Promise.resolve(null),
        rpcRunning ? this.client.getSessionStats().catch(() => null) as Promise<Record<string, unknown> | null> : Promise.resolve(null),
        buildDashboardData(cwd),
        countPendingCaptures(cwd),
        readParallelWorkers(cwd),
      ]);

      if (rpcState?.model) {
        const m = rpcState.model as { id?: string; provider?: string };
        if (m.id && m.provider) {
          model = { id: m.id, provider: m.provider };
        }
      }

      if (stats?.cost !== undefined) {
        cost = stats.cost as number;
      }

      // 2. Detect model changes — only update lastModel when RPC succeeded
      if (model) {
        if (this.lastModel && (model.id !== this.lastModel.id || model.provider !== this.lastModel.provider)) {
          this.onModelChanged?.(this.lastModel, model);
        }
        this.lastModel = model;
      }
      let workers: WorkerProgress[] | null = null;
      let budgetAlert = false;

      if (rawWorkers) {
        // Refresh budget ceiling cache if stale
        const now = Date.now();
        if (now - this.budgetCeilingReadAt > BUDGET_CEILING_TTL_MS) {
          this.budgetCeiling = await readBudgetCeiling(cwd);
          this.budgetCeilingReadAt = now;
        }

        // Compute budget percentages
        workers = rawWorkers.map(w => ({
          ...w,
          budgetPercent: this.budgetCeiling
            ? Math.round((w.cost / this.budgetCeiling) * 10000) / 100
            : null,
        }));

        // Check budget alert threshold
        const anyOver80 = workers.some(w => w.budgetPercent !== null && w.budgetPercent >= BUDGET_ALERT_PERCENT);
        budgetAlert = anyOver80;

        if (anyOver80 && !this.lastBudgetAlertFired) {
          this.lastBudgetAlertFired = true;
          const overBudget = workers
            .filter(w => w.budgetPercent !== null && w.budgetPercent >= BUDGET_ALERT_PERCENT)
            .map(w => `${w.id} (${w.budgetPercent!.toFixed(0)}%)`)
            .join(", ");
          this.output.appendLine(`[${this.sessionId}] Budget alert fired for: ${overBudget}`);
          vscode.window.showWarningMessage(`GSD Budget Alert: Workers over 80% — ${overBudget}`);
        } else if (!anyOver80) {
          this.lastBudgetAlertFired = false; // Reset when all drop below
        }

        this.output.appendLine(`[${this.sessionId}] Parallel workers: ${workers.length}`);
      }

      // 6. Build progress message
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
        workers,
        budgetAlert,
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
