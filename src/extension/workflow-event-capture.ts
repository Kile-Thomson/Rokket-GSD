// ============================================================
// Workflow Event Capture — diagnostic instrumentation
// ============================================================
//
// The workflow engine (Claude Code, wrapped by gsd-pi) fans out sub-agents and
// streams per-agent progress. Those updates ride the JSON-RPC channel as events
// the extension has no handler for, so today they fall through handleRpcEvent's
// forward-all (rpc-events.ts) and are dropped by the webview's default case.
//
// We cannot read the runtime's event shape statically — the installed gsd-pi
// bundle is pruned and persists no workflow state to disk. So this captures the
// shape live: one full JSON sample per distinct event type, plus running counts,
// appended to .gsd/runtime/workflow-events-debug.jsonl during a session.
//
// Bounded by design: at most one disk write per distinct event type (capped at
// MAX_DISTINCT_TYPES), so file size tracks the number of distinct types (dozens),
// never the event volume (thousands/sec). Counts are kept in memory and flushed
// as a summary on turn/run boundaries.
//
// This is the verification step for whether workflow progress can be rendered
// in-repo at all. Once the real event names/shapes are known, the renderer is
// keyed to them and this capture is gated behind a debug flag.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

const MAX_SAMPLE_BYTES = 8000;
const MAX_DISTINCT_TYPES = 200;

// In-memory state, module-scoped (one capture session per extension host).
const sampledTypes = new Set<string>();
const typeCounts = new Map<string, number>();

function resolveDebugFile(cwd?: string): string | null {
  const root = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return null;
  return path.join(root, ".gsd", "runtime", "workflow-events-debug.jsonl");
}

function appendLine(file: string, obj: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
  } catch {
    // Diagnostic-only — never let capture failures affect event handling.
  }
}

/** Truncate a sample's JSON so a single pathological event can't bloat the file. */
function truncateSample(event: Record<string, unknown>): unknown {
  const json = JSON.stringify(event);
  if (json.length <= MAX_SAMPLE_BYTES) return event;
  return { __truncated: true, __originalBytes: json.length, preview: json.slice(0, MAX_SAMPLE_BYTES) };
}

/**
 * Record one RPC event. The first sighting of each distinct `type` writes a full
 * sample to disk; every sighting increments that type's count. Safe to call on
 * every event — it self-bounds.
 */
export function captureRpcEvent(
  event: Record<string, unknown>,
  output?: { appendLine(line: string): void },
  cwd?: string
): void {
  const type = typeof event?.type === "string" ? event.type : "<no-type>";
  typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

  if (sampledTypes.has(type)) return;
  if (sampledTypes.size >= MAX_DISTINCT_TYPES) return;
  sampledTypes.add(type);

  output?.appendLine(`[workflow-capture] new RPC event type: "${type}"`);

  const file = resolveDebugFile(cwd);
  if (file) {
    appendLine(file, {
      capturedAt: new Date().toISOString(),
      kind: "sample",
      type,
      sample: truncateSample(event),
    });
  }
}

/**
 * Append a counts summary of everything seen so far. Call on turn/run boundaries
 * (agent_end, execution_complete) so a completed run leaves a frequency profile —
 * a 60/sec stream vs a handful of discrete events read very differently.
 */
export function flushWorkflowEventCapture(
  output?: { appendLine(line: string): void },
  cwd?: string
): void {
  if (typeCounts.size === 0) return;
  const counts = Object.fromEntries([...typeCounts.entries()].sort((a, b) => b[1] - a[1]));
  output?.appendLine(`[workflow-capture] event counts: ${JSON.stringify(counts)}`);
  const file = resolveDebugFile(cwd);
  if (file) {
    appendLine(file, { capturedAt: new Date().toISOString(), kind: "summary", counts });
  }
}

/** Test-only: reset in-memory capture state. */
export function __resetWorkflowEventCaptureForTests(): void {
  sampledTypes.clear();
  typeCounts.clear();
}

/** Test-only: inspect in-memory capture state. */
export function __getWorkflowEventCaptureState(): { sampledTypes: string[]; counts: Record<string, number> } {
  return {
    sampledTypes: [...sampledTypes],
    counts: Object.fromEntries(typeCounts.entries()),
  };
}
