// ============================================================
// Workflow Progress Panel (webview)
//
// Renders live Claude Code Workflow fan-out state inside the originating
// `Workflow` tool block. The extension's workflow poller pushes
// `workflow_progress` messages keyed by the tool call id; this module attaches a
// panel as a sibling immediately after that tool segment so it survives the
// segment's innerHTML rebuild on tool_execution_start/end and persists across
// turns (the workflow runs in the background, outliving the launching turn).
// ============================================================

import type { WorkflowProgressData, WorkflowAgentProgress } from "../shared/types";
import { escapeHtml, escapeAttr, formatTokens, formatDuration } from "./helpers";

/** Latest snapshot per tool call, so a re-render (or late-arriving DOM) can replay it. */
const latest = new Map<string, WorkflowProgressData>();
/** Pending retry timers for snapshots whose tool segment isn't in the DOM yet. */
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

const MAX_RETRIES = 25;
const RETRY_DELAY_MS = 120;
const HEARTBEAT_INTERVAL_MS = 1000;

/** Self-healing re-attach timer — runs only while at least one workflow is live. */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// --- Diagnostics overlay -----------------------------------------------------
//
// An opt-in heads-up panel (gsd.workflowDiagnostics) that answers the two
// questions static analysis can't: are workflow_progress messages actually
// reaching the webview, and can the panel find its anchor (the Workflow tool
// segment) to attach to? It renders fixed to document.body — deliberately
// independent of the messages DOM that gets rebuilt — so it stays visible even
// when the anchor lookup is failing and no panel can attach. Off by default and
// has zero effect on rendering when disabled.

const DIAG_ID = "gsd-wf-diag";

type AnchorOutcome = "found" | "retrying" | "missing";

interface DiagState {
  enabled: boolean;
  /** Count of workflow_progress messages received, by status. */
  counts: Record<WorkflowProgressData["status"], number>;
  total: number;
  lastName?: string;
  lastStatus?: WorkflowProgressData["status"];
  lastDone?: number;
  lastPlanned?: number;
  lastAnchor?: AnchorOutcome;
  lastPanelAttached?: boolean;
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

/** Toggle the diagnostics overlay (driven by the gsd.workflowDiagnostics setting). */
export function setDiagnostics(enabled: boolean): void {
  diag.enabled = enabled;
  if (enabled) renderDiag();
  else removeDiag();
}

/** Live = still producing progress; terminal states don't need re-attaching. */
function isLive(status: WorkflowProgressData["status"]): boolean {
  return status === "running" || status === "launching" || status === "stalled";
}

export function update(data: WorkflowProgressData): void {
  latest.set(data.toolCallId, data);
  noteMessage(data);
  render(data.toolCallId, 0);
  if (isLive(data.status)) startHeartbeat();
}

/** Clear all panels' cached state (new conversation / reset). DOM is cleared on re-render. */
export function reset(): void {
  latest.clear();
  for (const t of retryTimers.values()) clearTimeout(t);
  retryTimers.clear();
  stopHeartbeat();
  diag.counts = { launching: 0, running: 0, completed: 0, error: 0, stalled: 0 };
  diag.total = 0;
  diag.lastName = undefined;
  diag.lastStatus = undefined;
  diag.lastDone = undefined;
  diag.lastPlanned = undefined;
  diag.lastAnchor = undefined;
  diag.lastPanelAttached = undefined;
  diag.lastMessageAt = undefined;
  if (diag.enabled) renderDiag();
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

/**
 * Re-attach any live panel that has gone missing from the DOM.
 *
 * A workflow runs in the background and outlives the turn that launched it, but
 * the surrounding turn DOM is rebuilt by streaming, finalization, and history
 * refreshes. The panel is a sibling injected after the tool segment — it is not
 * part of the reconstructable message history, so those rebuilds silently drop
 * it. That is why progress could go unseen until the turn settled. Each tick
 * re-renders any live run whose panel is absent (but whose segment exists),
 * keeping it visible during the run without waiting on the next extension poll.
 * Present panels are left untouched (no flicker). The timer stops itself once no
 * run is live.
 */
function heartbeatTick(): void {
  let anyLive = false;
  for (const [id, data] of latest) {
    if (!isLive(data.status)) continue;
    anyLive = true;
    if (!findExistingPanel(id) && findSegment(id)) {
      render(id, 0);
    }
  }
  if (diag.enabled) renderDiag();
  if (!anyLive) stopHeartbeat();
}

function render(toolCallId: string, attempt: number): void {
  const data = latest.get(toolCallId);
  if (!data) return;

  const segment = findSegment(toolCallId);
  if (!segment) {
    // The Workflow tool segment may not be in the DOM yet (workflow_progress can
    // arrive just before tool_execution_start). Retry a bounded number of times.
    if (attempt < MAX_RETRIES) {
      noteAnchor("retrying", false);
      const existing = retryTimers.get(toolCallId);
      if (existing) clearTimeout(existing);
      retryTimers.set(toolCallId, setTimeout(() => render(toolCallId, attempt + 1), RETRY_DELAY_MS));
    } else {
      noteAnchor("missing", false);
    }
    return;
  }
  const pending = retryTimers.get(toolCallId);
  if (pending) { clearTimeout(pending); retryTimers.delete(toolCallId); }

  const panel = ensurePanel(segment, toolCallId);
  panel.className = `gsd-workflow-panel status-${data.status}`;
  panel.innerHTML = buildPanelHtml(data);
  noteAnchor("found", true);
}

function findSegment(toolCallId: string): HTMLElement | null {
  const messages = document.getElementById("messages");
  const scope: ParentNode = messages ?? document;
  const found = scope.querySelector<HTMLElement>(`[data-tool-id="${cssEscape(toolCallId)}"]`);
  return found?.closest<HTMLElement>(".gsd-tool-segment") ?? found ?? null;
}

function findExistingPanel(toolCallId: string): HTMLElement | null {
  const messages = document.getElementById("messages");
  const scope: ParentNode = messages ?? document;
  return scope.querySelector<HTMLElement>(`.gsd-workflow-panel[data-workflow-tool-id="${cssEscape(toolCallId)}"]`);
}

function ensurePanel(segment: HTMLElement, toolCallId: string): HTMLElement {
  let panel = findExistingPanel(toolCallId);
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "gsd-workflow-panel";
    panel.dataset.workflowToolId = toolCallId;
    segment.insertAdjacentElement("afterend", panel);
  }
  return panel;
}

// --- HTML ---

function buildPanelHtml(data: WorkflowProgressData): string {
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

function buildAgentRow(a: WorkflowAgentProgress): string {
  const dot = a.state === "running"
    ? `<span class="gsd-wf-spinner"></span>`
    : `<span class="gsd-wf-dot gsd-wf-dot-${a.state}">${a.state === "done" ? "✓" : a.state === "error" ? "✗" : "○"}</span>`;

  const meta: string[] = [];
  if (a.phase) meta.push(`<span class="gsd-wf-agent-phase">${escapeHtml(a.phase)}</span>`);
  const stats: string[] = [];
  if (a.tokens !== undefined) stats.push(`${formatTokens(a.tokens)} tok`);
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

/** Record a received workflow_progress message for the diagnostics overlay. */
function noteMessage(data: WorkflowProgressData): void {
  diag.counts[data.status] = (diag.counts[data.status] ?? 0) + 1;
  diag.total++;
  diag.lastName = data.name;
  diag.lastStatus = data.status;
  diag.lastDone = data.doneAgentCount;
  diag.lastPlanned = Math.max(data.plannedAgentCount, data.agents.length);
  diag.lastMessageAt = Date.now();
  if (diag.enabled) renderDiag();
}

/** Record the outcome of the most recent attach attempt (the anchor lookup). */
function noteAnchor(outcome: AnchorOutcome, panelAttached: boolean): void {
  diag.lastAnchor = outcome;
  diag.lastPanelAttached = panelAttached;
  if (diag.enabled) renderDiag();
}

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
}

function buildDiagHtml(): string {
  const c = diag.counts;
  const anchorText = diag.lastAnchor ? diag.lastAnchor.toUpperCase() : "—";
  const anchorClass = diag.lastAnchor === "found" ? "ok" : diag.lastAnchor === "missing" ? "bad" : "warn";
  const messagesPresent = !!document.getElementById("messages");
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
    `<div class="gsd-wf-diag-row">anchor: <b class="gsd-wf-diag-${anchorClass}">${anchorText}</b> · panel: ${diag.lastPanelAttached ? "attached" : "—"} · #messages: ${messagesPresent ? "yes" : "no"}</div>`,
    `<div class="gsd-wf-diag-row gsd-wf-diag-dim">updated ${ago}</div>`,
  ].join("");
}

/** Minimal CSS.escape fallback for attribute-selector safety. */
function cssEscape(value: string): string {
  if (typeof (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS?.escape === "function") {
    return (window as unknown as { CSS: { escape: (s: string) => string } }).CSS.escape(value);
  }
  return value.replace(/["\\\]]/g, "\\$&");
}
