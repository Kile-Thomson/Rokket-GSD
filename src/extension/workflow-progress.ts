// ============================================================
// Workflow Progress — pure parsers + filesystem readers
// ============================================================
//
// Claude Code's `Workflow` tool fans out sub-agents in the background. The RPC
// channel only carries `tool_execution_start` (with the script) and
// `tool_execution_end` ("launched in background, use /workflows to watch") —
// no live per-agent progress crosses the wire. But the runtime persists the run
// to disk, and that IS pollable:
//
//   <projectDir>/
//     workflows/<runId>.json                       ← rich end-table (written at completion)
//     subagents/workflows/<runId>/journal.jsonl     ← appended live as agents start/finish
//
// So visibility is built from three signals:
//   1. The script (in tool_execution_start args) names the agents up front.    [verified]
//   2. journal.jsonl is the live heartbeat — started/result events per agent.  [best-effort schema]
//   3. <runId>.json is the exact per-agent table at completion.                [verified shape]
//
// (1) and (3) are parsed from data shapes captured from real runs. (2)'s exact
// line schema was not captured, so parseJournalLines is deliberately defensive:
// it extracts what it recognizes and, failing that, still yields a line count +
// file mtime that drive coarse progress and the "stalled" hang badge. A wrong
// schema guess degrades the live view; it never throws.

import * as fs from "fs";
import * as path from "path";
import type { WorkflowAgentProgress } from "../shared/types";

// --- Parsed plan (from the Workflow script in tool_execution_start args) ---

export interface ParsedWorkflowPlan {
  name: string;
  description?: string;
  phases: string[];
  /** Agents declared with an inline `{ label, phase }` options object, in source (dispatch) order. */
  agents: Array<{ label: string; phase?: string }>;
}

/** Pull the `name:` from the meta block. */
function matchMetaString(script: string, key: string): string | undefined {
  const re = new RegExp(`\\b${key}\\s*:\\s*['"\\\`]([^'"\\\`]+)['"\\\`]`);
  const m = script.match(re);
  return m ? m[1] : undefined;
}

/**
 * Parse a Workflow script's `meta` block + `agent(...)` calls.
 *
 * Resilient by construction: a script that doesn't match (minified, unusual
 * quoting, computed labels in a map/loop) yields whatever fields parsed plus an
 * empty agent list. Dynamically-generated agents (e.g. `items.map(...)`) have no
 * literal label and are intentionally not counted here — the live journal fills
 * that gap.
 */
export function parseWorkflowScript(script: string): ParsedWorkflowPlan {
  const name = matchMetaString(script, "name") ?? "workflow";
  const description = matchMetaString(script, "description");

  // Phases: bounded to the `phases: [ ... ]` array so titles elsewhere don't leak in.
  const phases: string[] = [];
  const phasesBlock = script.match(/phases\s*:\s*\[([\s\S]*?)\]/);
  if (phasesBlock) {
    const titleRe = /title\s*:\s*['"`]([^'"`]+)['"`]/g;
    let t: RegExpExecArray | null;
    while ((t = titleRe.exec(phasesBlock[1])) !== null) {
      phases.push(t[1]);
    }
  }

  // Agents: inline option objects that carry a `label`. Matches the common
  // `agent('...', { label: 'x', phase: 'Y', schema })` shape without trying to
  // balance the prompt argument (which may contain commas/parens/quotes).
  //
  // The label literal must be immediately followed by `,` or `}` (a lookahead) so
  // a concatenated/computed label like `{ label: 'review:' + d }` is rejected
  // rather than captured as its literal prefix ('review:'). Computed labels carry
  // no static name; the live journal fills them in at runtime.
  const agents: Array<{ label: string; phase?: string }> = [];
  const optionRe = /\{[^{}]*?\blabel\s*:\s*['"`]([^'"`]+)['"`]\s*(?=[,}])[^{}]*?\}/g;
  let o: RegExpExecArray | null;
  while ((o = optionRe.exec(script)) !== null) {
    const label = o[1];
    const phaseMatch = o[0].match(/\bphase\s*:\s*['"`]([^'"`]+)['"`]/);
    agents.push({ label, phase: phaseMatch ? phaseMatch[1] : undefined });
  }

  return { name, description, phases, agents };
}

// --- Parsed launch info (from the Workflow tool_execution_end result text) ---

export interface WorkflowLaunchInfo {
  runId: string;
  transcriptDir: string;
  scriptPath?: string;
}

/**
 * Extract the run id + on-disk paths from the "launched in background" result text.
 * Returns null if the text isn't a recognizable workflow-launch result.
 *
 * The live runtime emits, e.g.:
 *   Workflow launched in background. Task ID: wdqnq4w7q
 *   Summary: ...
 *   Transcript dir: <projectDir>\subagents\workflows\wf_<id>
 *   Script file: ...
 *
 * Note it carries **no `Run ID:` line** — only `Task ID:` and a transcript dir
 * whose last path segment IS the `wf_<id>` run id. We therefore derive the run id
 * from the transcript dir's basename, preferring an explicit `Run ID:` line when a
 * runtime does emit one. Requiring the `Run ID:` label (as this once did) made the
 * parser return null on every real launch, so the journal poller never started and
 * live progress never rendered — only the terminal completion snapshot did.
 */
export function parseWorkflowLaunch(resultText: string): WorkflowLaunchInfo | null {
  const transcriptDir = resultText.match(/Transcript dir:\s*(.+?)\s*(?:\r?\n|$)/)?.[1]?.trim();
  if (!transcriptDir) return null;
  const explicitRunId = resultText.match(/Run ID:\s*(wf_[A-Za-z0-9_-]+)/)?.[1];
  const dirBasename = transcriptDir.split(/[\\/]/).filter(Boolean).pop();
  const runId = explicitRunId ?? (dirBasename && /^wf_[A-Za-z0-9_-]+$/.test(dirBasename) ? dirBasename : undefined);
  if (!runId) return null;
  const scriptPath = resultText.match(/Script file:\s*(.+?)\s*(?:\r?\n|$)/)?.[1]?.trim();
  return { runId, transcriptDir, scriptPath };
}

/** Derive the journal + end-file paths from the transcript dir and run id. */
export function deriveWorkflowPaths(transcriptDir: string, runId: string): {
  journalPath: string;
  endFilePath: string;
} {
  // transcriptDir = <projectDir>/subagents/workflows/<runId>
  const projectDir = path.dirname(path.dirname(path.dirname(transcriptDir)));
  return {
    journalPath: path.join(transcriptDir, "journal.jsonl"),
    endFilePath: path.join(projectDir, "workflows", `${runId}.json`),
  };
}

// --- Live agent state ---

export type AgentRunState = "pending" | "running" | "done" | "error";

export interface JournalAgentState {
  state: AgentRunState;
  label?: string;
  phase?: string;
  tokens?: number;
  toolCalls?: number;
  /** First-seen ordinal — used to map anonymous agentIds onto planned labels by dispatch order. */
  order: number;
}

export interface JournalParseResult {
  /** Per-agentId state, keyed by the journal's internal agent id. */
  agents: Map<string, JournalAgentState>;
  /** Narrator `log()` lines, in order, if the journal surfaces them. */
  logs: string[];
  /** Total parseable JSON lines — a coarse liveness proxy when agent events aren't recognized. */
  lineCount: number;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Parse journal.jsonl content defensively.
 *
 * The exact line schema is not pinned down, so this recognizes a broad family of
 * shapes rather than one: an agent identifier under any of agentId/id/agent, and
 * a start/finish signal expressed either as the presence of a `started`/`result`
 * key (the shape referenced by the capture instrumentation) or as a
 * type/event/status discriminator. Anything unrecognized is counted toward
 * lineCount (liveness) and otherwise ignored. Never throws on bad input.
 */
export function parseJournalLines(content: string): JournalParseResult {
  const agents = new Map<string, JournalAgentState>();
  const logs: string[] = [];
  let lineCount = 0;
  let order = 0;

  const ensure = (id: string): JournalAgentState => {
    let a = agents.get(id);
    if (!a) {
      a = { state: "pending", order: order++ };
      agents.set(id, a);
    }
    return a;
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // partially-flushed or non-JSON line — skip
    }
    if (!obj || typeof obj !== "object") continue;
    lineCount++;

    // Narrator log lines (workflow log()).
    const logText = obj.log ?? obj.narration ?? (obj.type === "log" ? obj.message : undefined);
    if (typeof logText === "string" && logText) {
      logs.push(logText);
      continue;
    }

    const agentId = pickString(obj, "agentId", "agent", "id", "label");
    if (!agentId) continue;

    const a = ensure(agentId);

    const label = pickString(obj, "label");
    if (label) a.label = label;
    const phase = pickString(obj, "phase");
    if (phase) a.phase = phase;
    const tokens = pickNumber(obj, "tokens", "totalTokens");
    if (tokens !== undefined) a.tokens = tokens;
    const toolCalls = pickNumber(obj, "toolCalls", "toolCallCount");
    if (toolCalls !== undefined) a.toolCalls = toolCalls;

    // Determine start/finish. Prefer explicit keys, fall back to a discriminator.
    const disc = pickString(obj, "type", "event", "status", "kind")?.toLowerCase();
    const hasStarted = "started" in obj || disc === "started" || disc === "start" || disc === "agent_start" || disc === "running";
    const isError = obj.error != null || disc === "error" || disc === "failed";
    const hasResult = "result" in obj || disc === "result" || disc === "done" || disc === "completed" || disc === "complete" || disc === "agent_end";

    if (isError) {
      a.state = "error";
    } else if (hasResult) {
      a.state = "done";
    } else if (hasStarted && a.state === "pending") {
      a.state = "running";
    }
  }

  return { agents, logs, lineCount };
}

// --- Live status decision (quiet-journal → completed vs stalled) ---

export type LiveWorkflowStatus = "running" | "stalled" | "completed";

export interface LiveStatusInput {
  /** True once the journal has grown at least once — we've seen real activity. */
  sawActivity: boolean;
  /** Milliseconds since the journal last grew. */
  quietForMs: number;
  /** Agents currently mid-flight (started, no result yet). */
  runningAgentCount: number;
  /** Agents that reached a terminal state (done or error). */
  doneAgentCount: number;
  /** Quiet-period threshold; beyond it a still-growing journal counts as quiet. */
  staleThresholdMs: number;
}

export interface LiveStatusDecision {
  status: LiveWorkflowStatus;
  /** Drives the "may be hung" warning — true only for a genuine stall. */
  stale: boolean;
  /** The run has demonstrably finished; the caller may stop polling. */
  settled: boolean;
}

/**
 * Decide a running workflow's status from journal liveness — the fix for a
 * finished run being mislabelled "hung".
 *
 * A workflow's journal naturally goes quiet the moment its last agent finishes,
 * so "journal stopped growing" alone cannot mean "hung". We only cry stall when
 * there is positive evidence an agent is still mid-flight while the journal has
 * gone silent. A quiet journal with nothing in flight is a finished run, not a
 * hung one. Before any activity is seen we hold at "running" rather than faking
 * either completion or a hang.
 */
export function decideLiveWorkflowStatus(i: LiveStatusInput): LiveStatusDecision {
  const quiet = i.quietForMs > i.staleThresholdMs;
  if (!quiet) {
    return { status: "running", stale: false, settled: false };
  }
  if (!i.sawActivity) {
    // Journal hasn't started moving yet — the run is still spinning up. Don't
    // declare it hung, and don't fake completion.
    return { status: "running", stale: false, settled: false };
  }
  if (i.runningAgentCount > 0) {
    // An agent is mid-flight but the journal has stopped — a genuine stall.
    return { status: "stalled", stale: true, settled: false };
  }
  // Quiet, activity seen, nothing in flight → the run has settled. Mark it
  // settled (stop polling) only with positive terminal evidence, so an
  // unrecognized-schema journal we can't read agent states from keeps polling
  // for the authoritative end-file rather than stopping early.
  return { status: "completed", stale: false, settled: i.doneAgentCount > 0 };
}

// --- End-file (rich per-agent table at completion) ---

export interface WorkflowEndFile {
  status: string;
  agents: Array<{ label: string; phase?: string; state: AgentRunState; tokens?: number; toolCalls?: number; durationMs?: number }>;
}

/**
 * Parse the `<runId>.json` end-file. Returns null if absent/corrupt.
 *
 * The runtime writes the per-agent table under `workflowProgress` — verified
 * against a real end-file: each entry carries label, phaseTitle, state, tokens,
 * toolCalls, durationMs. The legacy `agents` key is accepted as a fallback so a
 * future shape change doesn't silently blank the completion table.
 */
export function parseWorkflowEndFile(content: string): WorkflowEndFile | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rawAgents = Array.isArray(obj?.workflowProgress)
    ? (obj.workflowProgress as Array<Record<string, unknown>>)
    : Array.isArray(obj?.agents)
      ? (obj.agents as Array<Record<string, unknown>>)
      : null;
  if (!rawAgents) return null;

  // `workflowProgress` interleaves phase markers ({type:"workflow_phase"}) with
  // agent rows ({type:"workflow_agent"}). Keep only agent rows; a row with no
  // type discriminator (legacy `agents` shape) is treated as an agent.
  const agents = rawAgents
    .filter((raw) => {
      const t = pickString(raw, "type");
      return t === undefined || t === "workflow_agent";
    })
    .map((raw) => {
    const stateRaw = pickString(raw, "state", "status") ?? "done";
    const state: AgentRunState =
      stateRaw === "error" || stateRaw === "failed" ? "error"
      : stateRaw === "running" || stateRaw === "started" ? "running"
      : stateRaw === "pending" || stateRaw === "queued" ? "pending"
      : "done";
    return {
      label: pickString(raw, "label", "agentId", "id") ?? "agent",
      phase: pickString(raw, "phaseTitle", "phase"),
      state,
      tokens: pickNumber(raw, "tokens", "totalTokens"),
      toolCalls: pickNumber(raw, "toolCalls", "toolCallCount"),
      durationMs: pickNumber(raw, "durationMs", "duration"),
    };
  });

  return { status: pickString(obj, "status") ?? "completed", agents };
}

// --- Filesystem readers (null-return semantics, never throw) ---

export async function readJournal(journalPath: string): Promise<{ result: JournalParseResult; mtimeMs: number } | null> {
  try {
    const [content, stat] = await Promise.all([
      fs.promises.readFile(journalPath, "utf-8"),
      fs.promises.stat(journalPath),
    ]);
    return { result: parseJournalLines(content), mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

export async function readEndFile(endFilePath: string): Promise<WorkflowEndFile | null> {
  try {
    const content = await fs.promises.readFile(endFilePath, "utf-8");
    return parseWorkflowEndFile(content);
  } catch {
    return null;
  }
}

// --- Reconcile plan + live journal + end-file into renderable agent rows ---

function withCounts(agents: WorkflowAgentProgress[]): {
  agents: WorkflowAgentProgress[];
  doneAgentCount: number;
  runningAgentCount: number;
} {
  let doneAgentCount = 0;
  let runningAgentCount = 0;
  for (const a of agents) {
    if (a.state === "done" || a.state === "error") doneAgentCount++;
    else if (a.state === "running") runningAgentCount++;
  }
  return { agents, doneAgentCount, runningAgentCount };
}

function applyJournalState(row: WorkflowAgentProgress, j: JournalAgentState): void {
  row.state = j.state;
  if (j.phase) row.phase = j.phase;
  if (j.tokens !== undefined) row.tokens = j.tokens;
  if (j.toolCalls !== undefined) row.toolCalls = j.toolCalls;
}

/**
 * Build the agent rows for a snapshot.
 *
 * Precedence: the end-file is authoritative (exact labels + final stats). Before
 * completion, rows start from the planned agents (so labels show immediately) and
 * are overlaid with live journal state — matched by label when the journal carries
 * one, otherwise bound to planned rows by dispatch order. Journal agents beyond
 * the planned set (e.g. agents created in a loop) are appended.
 */
export function buildAgentRows(
  plan: ParsedWorkflowPlan,
  journal: JournalParseResult | null,
  endFile: WorkflowEndFile | null,
): { agents: WorkflowAgentProgress[]; doneAgentCount: number; runningAgentCount: number } {
  if (endFile) {
    // End-file is authoritative for phase too — fall back to the plan's phase
    // only when the end-file agent doesn't carry one.
    const phaseByLabel = new Map(plan.agents.map((a) => [a.label, a.phase]));
    const agents: WorkflowAgentProgress[] = endFile.agents.map((a) => ({
      label: a.label,
      phase: a.phase ?? phaseByLabel.get(a.label),
      state: a.state,
      tokens: a.tokens,
      toolCalls: a.toolCalls,
      durationMs: a.durationMs,
    }));
    return withCounts(agents);
  }

  const rows: WorkflowAgentProgress[] = plan.agents.map((a) => ({
    label: a.label,
    phase: a.phase,
    state: "pending" as const,
  }));

  if (journal) {
    const jAgents = [...journal.agents.values()].sort((x, y) => x.order - y.order);
    jAgents.forEach((j, i) => {
      let idx = -1;
      if (j.label) idx = rows.findIndex((r) => r.label === j.label);
      // Fall back to dispatch-order binding only for unlabeled entries — a labeled
      // entry whose label isn't in the plan must not overwrite an already-matched row.
      if (idx === -1 && !j.label && i < plan.agents.length) idx = i;
      if (idx >= 0) {
        applyJournalState(rows[idx], j);
      } else {
        rows.push({
          label: j.label ?? `agent ${i + 1}`,
          phase: j.phase,
          state: j.state,
          tokens: j.tokens,
          toolCalls: j.toolCalls,
        });
      }
    });
  }

  return withCounts(rows);
}
