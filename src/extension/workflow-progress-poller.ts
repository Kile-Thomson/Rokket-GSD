import * as vscode from "vscode";
import type { ExtensionToWebviewMessage, WorkflowProgressData } from "../shared/types";
import {
  WORKFLOW_PROGRESS_POLL_INTERVAL_MS,
  STALE_WORKFLOW_THRESHOLD_MS,
  WORKFLOW_POLL_MAX_RUNTIME_MS,
} from "../shared/constants";
import {
  parseWorkflowScript,
  parseWorkflowLaunch,
  deriveWorkflowPaths,
  buildAgentRows,
  readJournal,
  readEndFile,
  type ParsedWorkflowPlan,
} from "./workflow-progress";

// ============================================================
// Workflow Progress Manager
//
// One per session. Tracks every Claude Code `Workflow` run launched in the
// session and polls its on-disk artifacts so the webview can render live
// per-agent progress inside the originating tool block.
//
// Lifecycle of a single run:
//   tool_execution_start(Workflow) → onWorkflowStart: parse script, show the plan
//   tool_execution_end(Workflow)   → onWorkflowEnd: learn the run dir, start polling
//   poll journal.jsonl every 2s    → live agent states + "stalled" hang badge
//   <runId>.json appears           → final exact table, stop polling
//
// A run outlives the agent turn that launched it (workflows run in the
// background), so polling is decoupled from turn/streaming state. Each run
// self-terminates on completion, on a max-runtime cap, or on manager teardown.
// ============================================================

interface RunTracker {
  toolCallId: string;
  plan: ParsedWorkflowPlan;
  startedAt: number;
  journalPath?: string;
  endFilePath?: string;
  timer: ReturnType<typeof setInterval> | null;
  /** Last journal mtime/size we observed — used to detect a quiet (stalled) run. */
  lastJournalMtime: number;
  lastLineCount: number;
  /** When the journal last grew. Staleness is measured from here. */
  lastGrowthAt: number;
  finished: boolean;
  /** True while a poll() is awaiting disk I/O — prevents overlapping ticks. */
  inFlight: boolean;
}

export class WorkflowProgressManager {
  private runs = new Map<string, RunTracker>();
  private disposed = false;

  constructor(
    private readonly sessionId: string,
    private webview: vscode.Webview,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** Update the webview reference after a sidebar rebind. */
  rebindWebview(webview: vscode.Webview): void {
    this.webview = webview;
  }

  /** A Workflow tool call started — parse the script and show the plan immediately. */
  onWorkflowStart(toolCallId: string, script: string): void {
    if (this.disposed) return;
    const plan = parseWorkflowScript(script);
    const existing = this.runs.get(toolCallId);
    if (existing) {
      existing.plan = plan;
    } else {
      this.runs.set(toolCallId, {
        toolCallId,
        plan,
        startedAt: Date.now(),
        timer: null,
        lastJournalMtime: 0,
        lastLineCount: -1,
        lastGrowthAt: Date.now(),
        finished: false,
        inFlight: false,
      });
    }
    this.output.appendLine(
      `[${this.sessionId}] Workflow "${plan.name}" launching — ${plan.agents.length} declared agent(s), ${plan.phases.length} phase(s)`,
    );
    this.post(this.snapshot(this.runs.get(toolCallId)!, "launching"));
  }

  /** The Workflow tool call returned — extract the run directory and begin polling. */
  onWorkflowEnd(toolCallId: string, resultText: string): void {
    if (this.disposed) return;
    const run = this.runs.get(toolCallId);
    if (!run) return;

    const launch = parseWorkflowLaunch(resultText);
    if (!launch) {
      // Not a recognizable background-launch result (e.g. an error). Leave the
      // plan visible but mark it done — there's nothing to poll. Post a terminal
      // snapshot so the panel drops out of its "launching" state.
      this.output.appendLine(`[${this.sessionId}] Workflow ${toolCallId}: no run dir in result, not polling`);
      run.finished = true;
      this.post(this.snapshot(run, "completed"));
      return;
    }

    const { journalPath, endFilePath } = deriveWorkflowPaths(launch.transcriptDir, launch.runId);
    run.journalPath = journalPath;
    run.endFilePath = endFilePath;
    this.output.appendLine(`[${this.sessionId}] Workflow ${launch.runId} polling: ${journalPath}`);

    this.startPolling(run);
  }

  /** GSD process exited — stop all polling. Rendered panels stay as last seen. */
  onProcessExit(): void {
    this.stopAll();
  }

  /** User started a new conversation — discard all tracked runs. */
  onNewConversation(): void {
    this.stopAll();
    this.runs.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.stopAll();
    this.runs.clear();
  }

  // --- Internal ---

  private startPolling(run: RunTracker): void {
    if (run.timer || run.finished) return;
    // A poll is async disk I/O; on a slow disk it could outlast the interval.
    // Skip a tick if the previous poll is still in flight so they never overlap.
    const tick = async (): Promise<void> => {
      if (run.inFlight || run.finished) return;
      run.inFlight = true;
      try {
        await this.poll(run);
      } finally {
        run.inFlight = false;
      }
    };
    void tick(); // immediate first read
    run.timer = setInterval(() => void tick(), WORKFLOW_PROGRESS_POLL_INTERVAL_MS);
  }

  private stopRun(run: RunTracker): void {
    if (run.timer) {
      clearInterval(run.timer);
      run.timer = null;
    }
  }

  private stopAll(): void {
    for (const run of this.runs.values()) this.stopRun(run);
  }

  private async poll(run: RunTracker): Promise<void> {
    if (this.disposed || run.finished) {
      this.stopRun(run);
      return;
    }

    try {
      // End-file is authoritative — if present, render final and stop.
      const endFile = run.endFilePath ? await readEndFile(run.endFilePath) : null;
      if (endFile) {
        const rows = buildAgentRows(run.plan, null, endFile);
        const status = endFile.agents.some((a) => a.state === "error") ? "error" : "completed";
        run.finished = true;
        this.stopRun(run);
        this.post({
          toolCallId: run.toolCallId,
          name: run.plan.name,
          description: run.plan.description,
          phases: run.plan.phases,
          status,
          agents: rows.agents,
          plannedAgentCount: run.plan.agents.length,
          doneAgentCount: rows.doneAgentCount,
          runningAgentCount: rows.runningAgentCount,
          startedAt: run.startedAt,
          updatedAt: Date.now(),
          stale: false,
        });
        this.output.appendLine(`[${this.sessionId}] Workflow ${run.toolCallId} ${status} (${rows.agents.length} agents)`);
        return;
      }

      // No end-file yet — read the live journal.
      const journal = run.journalPath ? await readJournal(run.journalPath) : null;
      const now = Date.now();

      if (journal) {
        const grew = journal.mtimeMs > run.lastJournalMtime || journal.result.lineCount > run.lastLineCount;
        if (grew) {
          run.lastJournalMtime = journal.mtimeMs;
          run.lastLineCount = journal.result.lineCount;
          run.lastGrowthAt = now;
        }
      }

      // Safety cap — never poll a single run forever.
      if (now - run.startedAt > WORKFLOW_POLL_MAX_RUNTIME_MS) {
        run.finished = true;
        this.stopRun(run);
        this.output.appendLine(`[${this.sessionId}] Workflow ${run.toolCallId} poll cap reached, stopping`);
      }

      const stale = now - run.lastGrowthAt > STALE_WORKFLOW_THRESHOLD_MS;
      const rows = buildAgentRows(run.plan, journal?.result ?? null, null);
      this.post({
        toolCallId: run.toolCallId,
        name: run.plan.name,
        description: run.plan.description,
        phases: run.plan.phases,
        status: stale ? "stalled" : "running",
        agents: rows.agents,
        plannedAgentCount: run.plan.agents.length,
        doneAgentCount: rows.doneAgentCount,
        runningAgentCount: rows.runningAgentCount,
        logs: journal?.result.logs?.length ? journal.result.logs.slice(-8) : undefined,
        startedAt: run.startedAt,
        updatedAt: now,
        stale,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[${this.sessionId}] Workflow poll error (${run.toolCallId}): ${msg}`);
    }
  }

  /** Build a snapshot before polling has any disk data (the launch/plan view). */
  private snapshot(run: RunTracker, status: WorkflowProgressData["status"]): WorkflowProgressData {
    const rows = buildAgentRows(run.plan, null, null);
    return {
      toolCallId: run.toolCallId,
      name: run.plan.name,
      description: run.plan.description,
      phases: run.plan.phases,
      status,
      agents: rows.agents,
      plannedAgentCount: run.plan.agents.length,
      doneAgentCount: rows.doneAgentCount,
      runningAgentCount: rows.runningAgentCount,
      startedAt: run.startedAt,
      updatedAt: Date.now(),
      stale: false,
    };
  }

  private post(data: WorkflowProgressData): void {
    try {
      this.webview.postMessage({ type: "workflow_progress", data } as ExtensionToWebviewMessage);
    } catch {
      // Webview may be disposed mid-poll — non-fatal.
    }
  }
}
