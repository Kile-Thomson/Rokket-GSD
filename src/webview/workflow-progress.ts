// ============================================================
// Workflow Progress — shared card HTML + diagnostics overlay
//
// Claude Code's `Workflow` tool fans out sub-agents in the background. Two facts
// shape how we surface them:
//
//   • The RPC channel only carries the Workflow tool's start/end, batched at turn
//     end — no live per-agent progress crosses the wire. So the `workflow_progress`
//     message (this module's `update`) cannot drive a live in-conversation panel;
//     it only ever arrives after the turn, and the tool segment it would anchor to
//     doesn't exist until then. That approach is retired: `update` now feeds the
//     diagnostics overlay only.
//   • The live rendering flows through the disk watcher instead — see
//     `workflow-live.ts`, which polls the run's journal on disk and renders an
//     inline card the moment a run starts writing, independent of the turn.
//
// This module keeps the two pieces both paths share: `buildPanelHtml` (the card
// body) and the opt-in diagnostics overlay (gsd.workflowDiagnostics).
// ============================================================

import type { WorkflowProgressData, WorkflowAgentProgress } from "../shared/types";
import { escapeHtml, escapeAttr, formatTokens, formatDuration } from "./helpers";

// --- Diagnostics overlay -----------------------------------------------------
//
// An opt-in heads-up panel (gsd.workflowDiagnostics) that answers the question
// static analysis can't: are workflow progress messages actually reaching the
// webview, and is the conversation root present to render into? It renders fixed
// to document.body — deliberately independent of the messages DOM — so it stays
// visible regardless of conversation rebuilds. Off by default; zero effect when
// disabled. Fed by both the disk-watcher path (workflow-live) and the RPC path.

const DIAG_ID = "gsd-wf-diag";

interface DiagState {
  enabled: boolean;
  /** Count of progress messages received, by status. */
  counts: Record<WorkflowProgressData["status"], number>;
  total: number;
  lastName?: string;
  lastStatus?: WorkflowProgressData["status"];
  lastDone?: number;
  lastPlanned?: number;
  /** Date.now() of the last received message — drives the "Ns ago" freshness line. */
  lastMessageAt?: number;
}

function readDiagDefault(): boolean {
  try {
    return (window as unknown as { GSD_WORKFLOW_DIAGNOSTICS?: boolean }).GSD_WORKFLOW_DIAGNOSTICS === true;
  } catch {
    return false;
  }
}

const diag: DiagState = {
  enabled: readDiagDefault(),
  counts: { launching: 0, running: 0, completed: 0, error: 0, stalled: 0 },
  total: 0,
};

/**
 * Keeps the overlay's "updated Ns ago" line honest between messages — without it,
 * the freshness counter would freeze at whatever it read on the last snapshot.
 */
let diagRefreshTimer: ReturnType<typeof setInterval> | null = null;

function startDiagRefresh(): void {
  if (diagRefreshTimer) return;
  diagRefreshTimer = setInterval(() => {
    if (!diag.enabled || !document.getElementById(DIAG_ID)) {
      stopDiagRefresh();
      return;
    }
    renderDiag();
  }, 1000);
}

function stopDiagRefresh(): void {
  if (diagRefreshTimer) {
    clearInterval(diagRefreshTimer);
    diagRefreshTimer = null;
  }
}

/** Toggle the diagnostics overlay (driven by the gsd.workflowDiagnostics setting). */
export function setDiagnostics(enabled: boolean): void {
  diag.enabled = enabled;
  if (enabled) {
    renderDiag();
    startDiagRefresh();
  } else {
    stopDiagRefresh();
    removeDiag();
  }
}

/**
 * Record a received progress snapshot for the diagnostics overlay.
 *
 * Called by both progress sources: the disk watcher (workflow-live, the live
 * in-conversation renderer) and the RPC `workflow_progress` path (turn-end only).
 * Tracking both lets the overlay show whether either feed is delivering.
 */
export function noteMessage(data: WorkflowProgressData): void {
  diag.counts[data.status] = (diag.counts[data.status] ?? 0) + 1;
  diag.total++;
  diag.lastName = data.name;
  diag.lastStatus = data.status;
  diag.lastDone = data.doneAgentCount;
  diag.lastPlanned = Math.max(data.plannedAgentCount, data.agents.length);
  diag.lastMessageAt = Date.now();
  if (diag.enabled) renderDiag();
}

/**
 * RPC `workflow_progress` entry point. The in-conversation rendering now flows
 * through the disk watcher (workflow-live), so this only feeds diagnostics —
 * kept so the overlay still reflects the RPC feed and so the message route in the
 * handler stays stable.
 */
export function update(data: WorkflowProgressData): void {
  noteMessage(data);
}

/** Clear diagnostics state (new conversation / reset). */
export function reset(): void {
  diag.counts = { launching: 0, running: 0, completed: 0, error: 0, stalled: 0 };
  diag.total = 0;
  diag.lastName = undefined;
  diag.lastStatus = undefined;
  diag.lastDone = undefined;
  diag.lastPlanned = undefined;
  diag.lastMessageAt = undefined;
  if (diag.enabled) renderDiag();
}

// --- Card HTML (shared with workflow-live) -----------------------------------

export function buildPanelHtml(data: WorkflowProgressData): string {
  const elapsed = formatDuration(Math.max(0, data.updatedAt - data.startedAt));
  const total = Math.max(data.plannedAgentCount, data.agents.length);
  const counts = total > 0 ? `${data.doneAgentCount}/${total} agents` : `${data.doneAgentCount} agents`;

  const statusLabel: Record<WorkflowProgressData["status"], string> = {
    launching: "Launching",
    running: "Running",
    completed: "Done",
    error: "Error",
    stalled: "Stalled",
  };

  const phaseChips = data.phases.length
    ? `<span class="gsd-wf-phases">${data.phases.map((p) => `<span class="gsd-wf-phase-chip">${escapeHtml(p)}</span>`).join("")}</span>`
    : "";

  const header = `<div class="gsd-wf-header">
    <span class="gsd-wf-glyph">⋔</span>
    <span class="gsd-wf-name">${escapeHtml(data.name)}</span>
    <span class="gsd-wf-status gsd-wf-status-${data.status}">${statusLabel[data.status]}</span>
    <span class="gsd-wf-counts">${escapeHtml(counts)}</span>
    <span class="gsd-wf-elapsed">${escapeHtml(elapsed)}</span>
  </div>`;

  const desc = data.description
    ? `<div class="gsd-wf-desc">${escapeHtml(data.description)}</div>`
    : "";

  const phaseRow = data.phases.length
    ? `<div class="gsd-wf-phaserow">${phaseChips}</div>`
    : "";

  const stalledNote = data.status === "stalled"
    ? `<div class="gsd-wf-stalled">⚠ No activity for a while — the workflow may be hung.</div>`
    : "";

  const rows = data.agents.length
    ? `<div class="gsd-wf-agents">${data.agents.map(buildAgentRow).join("")}</div>`
    : `<div class="gsd-wf-empty">No agents declared with explicit labels — progress will appear as they start.</div>`;

  const logs = data.logs?.length
    ? `<div class="gsd-wf-logs">${data.logs.map((l) => `<div class="gsd-wf-log">${escapeHtml(l)}</div>`).join("")}</div>`
    : "";

  return header + desc + phaseRow + stalledNote + rows + logs;
}

/**
 * Per-agent token display. Keeps one decimal through 100k (e.g. "14.6k") rather
 * than the shared formatTokens' whole-k rounding above 10k (which collapses every
 * ~14.6–14.7k agent to an identical, fake-looking "15k"). The underlying counts
 * are real and genuinely near-identical for similar fan-out agents — the decimal
 * just surfaces that they differ. Falls back to formatTokens at six figures+.
 */
function formatAgentTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return formatTokens(n);
}

function buildAgentRow(a: WorkflowAgentProgress): string {
  const dot = a.state === "running"
    ? `<span class="gsd-wf-spinner"></span>`
    : `<span class="gsd-wf-dot gsd-wf-dot-${a.state}">${a.state === "done" ? "✓" : a.state === "error" ? "✗" : "○"}</span>`;

  const meta: string[] = [];
  if (a.phase) meta.push(`<span class="gsd-wf-agent-phase">${escapeHtml(a.phase)}</span>`);
  const stats: string[] = [];
  if (a.tokens !== undefined) stats.push(`${formatAgentTokens(a.tokens)} tok`);
  if (a.toolCalls !== undefined) stats.push(`${a.toolCalls} tool${a.toolCalls === 1 ? "" : "s"}`);
  if (a.durationMs !== undefined) stats.push(formatDuration(a.durationMs));
  const statsHtml = stats.length ? `<span class="gsd-wf-agent-stats">${escapeHtml(stats.join(" · "))}</span>` : "";

  return `<div class="gsd-wf-agent gsd-wf-agent-${a.state}" title="${escapeAttr(a.label)}">
    ${dot}
    <span class="gsd-wf-agent-label">${escapeHtml(a.label)}</span>
    ${meta.join("")}
    ${statsHtml}
  </div>`;
}

// --- Diagnostics rendering ---

function removeDiag(): void {
  const el = document.getElementById(DIAG_ID);
  if (el) el.remove();
}

/** Render (or refresh) the fixed diagnostics overlay. No-op when disabled. */
function renderDiag(): void {
  if (!diag.enabled) return;
  const body = document.body;
  if (!body) return;
  let el = document.getElementById(DIAG_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = DIAG_ID;
    el.setAttribute("aria-hidden", "true");
    body.appendChild(el);
  }
  el.innerHTML = buildDiagHtml();
  startDiagRefresh();
}

function buildDiagHtml(): string {
  const c = diag.counts;
  const messagesPresent =
    !!document.getElementById("messagesContainer") || !!document.getElementById("messages");
  const last = diag.lastName
    ? `${escapeHtml(diag.lastName)} · ${escapeHtml(diag.lastStatus ?? "—")}`
    : "none yet";
  const agents = diag.lastDone !== undefined && diag.lastPlanned !== undefined
    ? ` · ${diag.lastDone}/${diag.lastPlanned} agents`
    : "";
  const ago = diag.lastMessageAt !== undefined
    ? `${Math.max(0, Math.round((Date.now() - diag.lastMessageAt) / 1000))}s ago`
    : "—";

  return [
    `<div class="gsd-wf-diag-title">⋔ workflow diagnostics</div>`,
    `<div class="gsd-wf-diag-row">messages: <b>${diag.total}</b> <span class="gsd-wf-diag-dim">(launch ${c.launching} · run ${c.running} · done ${c.completed} · stall ${c.stalled} · err ${c.error})</span></div>`,
    `<div class="gsd-wf-diag-row">last: ${last}${agents}</div>`,
    `<div class="gsd-wf-diag-row">conversation: ${messagesPresent ? "yes" : "no"} · updated ${ago}</div>`,
  ].join("");
}
