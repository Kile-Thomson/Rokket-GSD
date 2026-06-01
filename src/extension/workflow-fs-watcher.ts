import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ExtensionToWebviewMessage, WorkflowProgressData } from "../shared/types";
import {
  WORKFLOW_FS_WATCH_INTERVAL_MS,
  WORKFLOW_LIVE_DISMISS_MS,
  WORKFLOW_FS_STARTUP_GRACE_MS,
  STALE_WORKFLOW_THRESHOLD_MS,
} from "../shared/constants";
import {
  parseWorkflowScript,
  buildAgentRows,
  decideLiveWorkflowStatus,
  readJournal,
  readEndFile,
  type ParsedWorkflowPlan,
} from "./workflow-progress";

// ============================================================
// Workflow Filesystem Watcher
//
// The problem this solves: when the agent calls `Workflow`, the runtime returns
// "launched in background" instantly and runs the fan-out *after* the turn. But
// gsd-pi buffers tool events and only serializes `tool_execution_start/end` to
// the RPC stream in one batch at turn end (verified end-to-end). So the
// RPC-driven WorkflowProgressManager literally cannot learn a workflow launched
// until the turn is over — there is no live window through the wire.
//
// The escape hatch: the workflow writes its journal to disk LIVE, independent of
// RPC. This watcher polls that journal directly and renders into a
// turn-independent floating panel (the conversation tool block doesn't exist
// until turn end, so there's nothing to attach to mid-run).
//
// On-disk layout (Claude Code):
//   ~/.claude/projects/<slug>/<conversation>/subagents/workflows/<runId>/journal.jsonl
//   ~/.claude/projects/<slug>/<conversation>/workflows/<runId>.json          (end-file)
//   ~/.claude/projects/<slug>/<conversation>/workflows/scripts/*<runId>.js   (the script)
//
// <slug> is the cwd with every non-alphanumeric char replaced by '-' (the
// encoding Claude Code uses for its per-project transcript dir). The
// conversation uuid is chosen by the runtime, so we glob '*' and scan all of
// them — the active one surfaces by virtue of having a live journal.
// ============================================================

interface RunTracker {
  runId: string;
  journalPath: string;
  endFilePath: string;
  scriptsDir: string;
  /** Plan parsed from the script (labels/phases), loaded once. */
  plan: ParsedWorkflowPlan | null;
  /** When this run was first surfaced (drives the panel's elapsed clock). */
  startedAt: number;
  lastMtime: number;
  lastLineCount: number;
  /** When the journal last grew — staleness is measured from here. */
  lastGrowthAt: number;
  shown: boolean;
  /** A terminal snapshot has been posted; awaiting dismissal. */
  finished: boolean;
  dismissAt?: number;
  /** The remove message has been sent — stop touching this run. */
  dismissed: boolean;
}

interface DiscoveredRun {
  runId: string;
  journalPath: string;
  endFilePath: string;
  scriptsDir: string;
}

export class WorkflowFsWatcher {
  private readonly slug: string;
  private readonly runs = new Map<string, RunTracker>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private inFlight = false;
  private startedAt = 0;
  /** Logged once so a wrong slug / missing dir is diagnosable without spam. */
  private loggedMissingRoot = false;

  constructor(
    private readonly sessionId: string,
    private webview: vscode.Webview,
    private readonly output: vscode.OutputChannel,
    cwd: string,
  ) {
    this.slug = WorkflowFsWatcher.slugFor(cwd);
  }

  /**
   * Encode a working directory the way Claude Code names its transcript dir:
   * every run of non-alphanumeric characters becomes '-' (drive colon, path
   * separators, spaces, dots all collapse to dashes).
   */
  static slugFor(cwd: string): string {
    return cwd.replace(/[^a-zA-Z0-9]/g, "-");
  }

  start(): void {
    if (this.timer || this.disposed) return;
    this.startedAt = Date.now();
    this.output.appendLine(`[${this.sessionId}] Workflow live watcher: ${this.projectRoot()}`);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), WORKFLOW_FS_WATCH_INTERVAL_MS);
  }

  rebindWebview(webview: vscode.Webview): void {
    this.webview = webview;
  }

  onProcessExit(): void {
    this.stop();
  }

  /** New conversation — clear any visible cards and forget tracked runs. */
  onNewConversation(): void {
    for (const run of this.runs.values()) {
      if (run.shown && !run.dismissed) this.postRemove(run.runId);
    }
    this.runs.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.runs.clear();
  }

  // --- Internal ---

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private enabled(): boolean {
    try {
      return vscode.workspace.getConfiguration("gsd").get<boolean>("workflowLivePanel", true);
    } catch {
      return true;
    }
  }

  private claudeDir(): string {
    const env = process.env.CLAUDE_CONFIG_DIR;
    if (env && env.trim()) return env.trim();
    return path.join(os.homedir(), ".claude");
  }

  private projectRoot(): string {
    return path.join(this.claudeDir(), "projects", this.slug);
  }

  private async tick(): Promise<void> {
    if (this.inFlight || this.disposed) return;
    this.inFlight = true;
    try {
      const now = Date.now();

      // Disabled mid-session — retract anything we're showing and idle.
      if (!this.enabled()) {
        for (const run of this.runs.values()) {
          if (run.shown && !run.dismissed) {
            this.postRemove(run.runId);
            run.dismissed = true;
          }
        }
        return;
      }

      const found = await this.discover();
      for (const d of found) {
        await this.process(d, now);
      }

      // Dismiss settled cards after their grace period — runs no longer
      // discovered still get retracted because we iterate tracked runs, not
      // just freshly-found ones.
      for (const run of this.runs.values()) {
        if (run.finished && !run.dismissed && run.dismissAt !== undefined && now >= run.dismissAt) {
          this.postRemove(run.runId);
          run.dismissed = true;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[${this.sessionId}] Workflow live watcher tick error: ${msg}`);
    } finally {
      this.inFlight = false;
    }
  }

  /** Enumerate every wf_* run dir under every conversation in this project. */
  private async discover(): Promise<DiscoveredRun[]> {
    const out: DiscoveredRun[] = [];
    const root = this.projectRoot();
    let convs: fs.Dirent[];
    try {
      convs = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      if (!this.loggedMissingRoot) {
        this.output.appendLine(`[${this.sessionId}] Workflow live watcher: project dir not found yet (${root})`);
        this.loggedMissingRoot = true;
      }
      return out;
    }
    for (const conv of convs) {
      if (!conv.isDirectory()) continue;
      const convDir = path.join(root, conv.name);
      const wfRoot = path.join(convDir, "subagents", "workflows");
      let runDirs: fs.Dirent[];
      try {
        runDirs = await fs.promises.readdir(wfRoot, { withFileTypes: true });
      } catch {
        continue; // this conversation never ran a workflow
      }
      for (const r of runDirs) {
        if (!r.isDirectory() || !r.name.startsWith("wf_")) continue;
        out.push({
          runId: r.name,
          journalPath: path.join(wfRoot, r.name, "journal.jsonl"),
          endFilePath: path.join(convDir, "workflows", `${r.name}.json`),
          scriptsDir: path.join(convDir, "workflows", "scripts"),
        });
      }
    }
    return out;
  }

  private async process(d: DiscoveredRun, now: number): Promise<void> {
    let run = this.runs.get(d.runId);
    if (run?.dismissed) return;

    const journal = await readJournal(d.journalPath);
    if (!journal) return; // not started writing yet — nothing to show

    const endFile = await readEndFile(d.endFilePath);

    if (!run) {
      // Only surface runs that were active at/after the watcher started.
      // Everything older is a completed run from a prior turn/conversation.
      const recent = journal.mtimeMs >= this.startedAt - WORKFLOW_FS_STARTUP_GRACE_MS;
      if (!recent) return;
      run = {
        runId: d.runId,
        journalPath: d.journalPath,
        endFilePath: d.endFilePath,
        scriptsDir: d.scriptsDir,
        plan: null,
        startedAt: now,
        lastMtime: 0,
        lastLineCount: -1,
        lastGrowthAt: now,
        shown: false,
        finished: false,
        dismissed: false,
      };
      this.runs.set(d.runId, run);
    }

    if (run.finished) return; // terminal snapshot already posted; awaiting dismissal

    if (!run.plan) run.plan = await this.loadPlan(run);

    if (journal.mtimeMs > run.lastMtime || journal.result.lineCount > run.lastLineCount) {
      run.lastMtime = journal.mtimeMs;
      run.lastLineCount = journal.result.lineCount;
      run.lastGrowthAt = now;
    }

    const rows = buildAgentRows(run.plan, journal.result, endFile);

    let status: WorkflowProgressData["status"];
    let stale = false;
    let finished: boolean;
    if (endFile) {
      status = endFile.agents.some((a) => a.state === "error") ? "error" : "completed";
      finished = true;
    } else {
      const decision = decideLiveWorkflowStatus({
        sawActivity: run.lastLineCount > 0,
        quietForMs: now - run.lastGrowthAt,
        runningAgentCount: rows.runningAgentCount,
        doneAgentCount: rows.doneAgentCount,
        staleThresholdMs: STALE_WORKFLOW_THRESHOLD_MS,
      });
      status = decision.status;
      stale = decision.stale;
      finished = decision.settled;
    }

    this.post({
      toolCallId: run.runId,
      name: run.plan.name,
      description: run.plan.description,
      phases: run.plan.phases,
      status,
      agents: rows.agents,
      plannedAgentCount: run.plan.agents.length,
      doneAgentCount: rows.doneAgentCount,
      runningAgentCount: rows.runningAgentCount,
      logs: journal.result.logs?.length ? journal.result.logs.slice(-6) : undefined,
      startedAt: run.startedAt,
      updatedAt: now,
      stale,
    });

    if (!run.shown) {
      run.shown = true;
      this.output.appendLine(`[${this.sessionId}] Workflow live: ${run.plan.name} (${run.runId}) surfaced`);
    }
    if (finished) {
      run.finished = true;
      run.dismissAt = now + WORKFLOW_LIVE_DISMISS_MS;
      this.output.appendLine(`[${this.sessionId}] Workflow live: ${run.runId} ${status} (${rows.doneAgentCount} agents)`);
    }
  }

  /** Read + parse the script that named this run's agents/phases. */
  private async loadPlan(run: RunTracker): Promise<ParsedWorkflowPlan> {
    try {
      const files = await fs.promises.readdir(run.scriptsDir);
      const match = files.find((f) => f.endsWith(`${run.runId}.js`)) ?? files.find((f) => f.includes(run.runId));
      if (match) {
        const content = await fs.promises.readFile(path.join(run.scriptsDir, match), "utf-8");
        return parseWorkflowScript(content);
      }
    } catch {
      // scripts dir missing or unreadable — fall through to a minimal plan
    }
    return { name: "workflow", phases: [], agents: [] };
  }

  private post(data: WorkflowProgressData): void {
    try {
      this.webview.postMessage({ type: "workflow_live", data } as ExtensionToWebviewMessage);
    } catch {
      // Webview may be disposed mid-tick — non-fatal.
    }
  }

  private postRemove(runId: string): void {
    try {
      this.webview.postMessage({ type: "workflow_live_remove", runId } as ExtensionToWebviewMessage);
    } catch {
      // non-fatal
    }
  }
}
