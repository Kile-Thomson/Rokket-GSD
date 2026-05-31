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

export function update(data: WorkflowProgressData): void {
  latest.set(data.toolCallId, data);
  render(data.toolCallId, 0);
}

/** Clear all panels' cached state (new conversation / reset). DOM is cleared on re-render. */
export function reset(): void {
  latest.clear();
  for (const t of retryTimers.values()) clearTimeout(t);
  retryTimers.clear();
}

function render(toolCallId: string, attempt: number): void {
  const data = latest.get(toolCallId);
  if (!data) return;

  const segment = findSegment(toolCallId);
  if (!segment) {
    // The Workflow tool segment may not be in the DOM yet (workflow_progress can
    // arrive just before tool_execution_start). Retry a bounded number of times.
    if (attempt < MAX_RETRIES) {
      const existing = retryTimers.get(toolCallId);
      if (existing) clearTimeout(existing);
      retryTimers.set(toolCallId, setTimeout(() => render(toolCallId, attempt + 1), RETRY_DELAY_MS));
    }
    return;
  }
  const pending = retryTimers.get(toolCallId);
  if (pending) { clearTimeout(pending); retryTimers.delete(toolCallId); }

  const panel = ensurePanel(segment, toolCallId);
  panel.className = `gsd-workflow-panel status-${data.status}`;
  panel.innerHTML = buildPanelHtml(data);
}

function findSegment(toolCallId: string): HTMLElement | null {
  const messages = document.getElementById("messages");
  const scope: ParentNode = messages ?? document;
  const found = scope.querySelector<HTMLElement>(`[data-tool-id="${cssEscape(toolCallId)}"]`);
  return found?.closest<HTMLElement>(".gsd-tool-segment") ?? found ?? null;
}

function ensurePanel(segment: HTMLElement, toolCallId: string): HTMLElement {
  const messages = document.getElementById("messages");
  const scope: ParentNode = messages ?? document;
  let panel = scope.querySelector<HTMLElement>(`.gsd-workflow-panel[data-workflow-tool-id="${cssEscape(toolCallId)}"]`);
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

/** Minimal CSS.escape fallback for attribute-selector safety. */
function cssEscape(value: string): string {
  if (typeof (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS?.escape === "function") {
    return (window as unknown as { CSS: { escape: (s: string) => string } }).CSS.escape(value);
  }
  return value.replace(/["\\\]]/g, "\\$&");
}
