// ============================================================
// Workflow Visualizer — full-page overlay showing project progress
//
// Opens via `/gsd visualize` or a dedicated trigger. Shows
// milestone progress, slice/task breakdown, completed units,
// and cost/usage metrics from dashboard data.
// ============================================================

import type { DashboardData, DashboardSlice } from "../shared/types";
import { escapeHtml, formatTokens } from "./helpers";
import { state } from "./state";

// ============================================================
// Module state
// ============================================================

let overlayEl: HTMLElement | null = null;
let visible = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let currentData: DashboardData | null = null;
let vscode: { postMessage(msg: unknown): void };
let activeTab: "progress" | "metrics" = "progress";

/** Refresh interval — 5 seconds when visible */
const REFRESH_INTERVAL_MS = 5_000;

// ============================================================
// Public API
// ============================================================

export interface VisualizerDeps {
  vscode: { postMessage(msg: unknown): void };
}

export function init(deps: VisualizerDeps): void {
  vscode = deps.vscode;
}

export function isVisible(): boolean {
  return visible;
}

export function show(): void {
  if (visible) return;
  visible = true;
  activeTab = "progress";
  ensureOverlayElement();
  renderLoading();
  // Request fresh data
  vscode.postMessage({ type: "get_dashboard" });
  // Start polling for live updates
  refreshTimer = setInterval(() => {
    if (visible) {
      vscode.postMessage({ type: "get_dashboard" });
    }
  }, REFRESH_INTERVAL_MS);
}

export function hide(): void {
  if (!visible) return;
  visible = false;
  currentData = null;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (overlayEl) {
    overlayEl.style.display = "none";
    overlayEl.innerHTML = "";
  }
}

/**
 * Handle incoming dashboard data — re-render if visible.
 */
export function updateData(data: DashboardData | null): void {
  if (!visible) return;
  currentData = data;
  render();
}

/**
 * Handle keyboard events when the panel is visible.
 * Returns true if the event was consumed.
 */
export function handleKeyDown(e: KeyboardEvent): boolean {
  if (!visible) return false;
  if (e.key === "Escape") {
    e.preventDefault();
    hide();
    return true;
  }
  return false;
}

// ============================================================
// DOM
// ============================================================

function ensureOverlayElement(): void {
  overlayEl = document.getElementById("workflowVisualizer");
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.id = "workflowVisualizer";
    overlayEl.className = "gsd-visualizer-overlay";
    overlayEl.setAttribute("role", "dialog");
    overlayEl.setAttribute("aria-label", "Workflow Visualizer");
    const messagesContainer = document.getElementById("messagesContainer");
    if (messagesContainer?.parentElement) {
      messagesContainer.parentElement.insertBefore(overlayEl, messagesContainer);
    }
  }
  overlayEl.style.display = "flex";
}

// ============================================================
// Render
// ============================================================

function renderLoading(): void {
  if (!overlayEl) return;
  overlayEl.innerHTML = `
    <div class="gsd-visualizer-header">
      <span class="gsd-visualizer-title">📊 Workflow Visualizer</span>
      <button class="gsd-visualizer-close" id="vizClose" aria-label="Close visualizer">✕</button>
    </div>
    <div class="gsd-visualizer-body">
      <div class="gsd-visualizer-loading">
        <span class="gsd-tool-spinner"></span> Loading workflow data…
      </div>
    </div>
  `;
  wireClose();
}

function render(): void {
  if (!overlayEl) return;

  if (!currentData || (!currentData.hasProject && !currentData.hasMilestone)) {
    overlayEl.innerHTML = `
      <div class="gsd-visualizer-header">
        <span class="gsd-visualizer-title">📊 Workflow Visualizer</span>
        <button class="gsd-visualizer-close" id="vizClose" aria-label="Close visualizer">✕</button>
      </div>
      <div class="gsd-visualizer-body">
        <div class="gsd-visualizer-empty">
          <div class="gsd-visualizer-empty-icon">📊</div>
          <div class="gsd-visualizer-empty-text">No active GSD project</div>
          <div class="gsd-visualizer-empty-hint">Run <code>/gsd</code> to start a project</div>
        </div>
      </div>
    `;
    wireClose();
    return;
  }

  const data = currentData;
  const phaseLabel = formatPhaseLabel(data.phase);
  const phaseClass = getPhaseClass(data.phase);

  // Auto-mode indicator
  const autoData = state.autoProgress;
  const autoLabel = autoData
    ? `<span class="gsd-visualizer-auto-badge">${autoData.autoState === "auto" ? "⚡ AUTO" : autoData.autoState === "next" ? "▸ NEXT" : "⏸ PAUSED"}</span>`
    : "";

  overlayEl.innerHTML = `
    <div class="gsd-visualizer-header">
      <span class="gsd-visualizer-title">📊 Workflow Visualizer</span>
      ${autoLabel}
      <span class="gsd-visualizer-phase ${phaseClass}">${escapeHtml(phaseLabel)}</span>
      <button class="gsd-visualizer-close" id="vizClose" aria-label="Close visualizer">✕</button>
    </div>
    <div class="gsd-visualizer-tabs">
      <button class="gsd-visualizer-tab${activeTab === "progress" ? " active" : ""}" data-tab="progress">Progress</button>
      <button class="gsd-visualizer-tab${activeTab === "metrics" ? " active" : ""}" data-tab="metrics">Metrics</button>
    </div>
    <div class="gsd-visualizer-body">
      ${activeTab === "progress" ? renderProgressTab(data) : renderMetricsTab(data)}
    </div>
  `;

  wireClose();
  wireTabs();
}

// ============================================================
// Progress Tab
// ============================================================

function renderProgressTab(data: DashboardData): string {
  let html = "";

  // Milestone header
  if (data.milestone) {
    html += `
      <div class="gsd-viz-milestone-header">
        <span class="gsd-viz-milestone-id">${escapeHtml(data.milestone.id)}</span>
        <span class="gsd-viz-milestone-title">${escapeHtml(data.milestone.title)}</span>
      </div>
    `;
  }

  // Progress bars
  html += `<div class="gsd-viz-progress-section">`;
  html += renderProgressBar("Milestones", data.progress.milestones.done, data.progress.milestones.total, "milestone");
  if (data.hasMilestone) {
    html += renderProgressBar("Slices", data.progress.slices.done, data.progress.slices.total, "slice");
    html += renderProgressBar("Tasks", data.progress.tasks.done, data.progress.tasks.total, "task");
  }
  html += `</div>`;

  // Current action breadcrumb
  if (data.task || data.slice) {
    const breadcrumb: string[] = [];
    if (data.milestone) breadcrumb.push(data.milestone.id);
    if (data.slice) breadcrumb.push(data.slice.id);
    if (data.task) breadcrumb.push(data.task.id);
    html += `
      <div class="gsd-viz-current">
        <span class="gsd-viz-current-label">Now:</span>
        <span class="gsd-viz-current-value">${escapeHtml(breadcrumb.join(" / "))}</span>
      </div>
    `;
  }

  // Slice breakdown
  if (data.slices.length > 0) {
    html += `<div class="gsd-viz-slices-section">`;
    html += `<div class="gsd-viz-section-title">Slices</div>`;
    for (const slice of data.slices) {
      html += renderSliceRow(slice);
    }
    html += `</div>`;
  }

  // Milestone registry
  if (data.milestoneRegistry.length > 0) {
    html += `<div class="gsd-viz-registry-section">`;
    html += `<div class="gsd-viz-section-title">Milestone Registry</div>`;
    for (const m of data.milestoneRegistry) {
      const icon = m.done ? "✓" : m.active ? "▸" : "○";
      const cls = m.done ? "done" : m.active ? "active" : "pending";
      html += `<div class="gsd-viz-registry-item ${cls}">
        <span class="gsd-viz-icon">${icon}</span>
        <span>${escapeHtml(m.id)}: ${escapeHtml(m.title)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Blockers
  if (data.blockers.length > 0) {
    html += `<div class="gsd-viz-blockers-section">`;
    html += `<div class="gsd-viz-section-title gsd-viz-blockers-title">⚠ Blockers</div>`;
    for (const b of data.blockers) {
      html += `<div class="gsd-viz-blocker">${escapeHtml(b)}</div>`;
    }
    html += `</div>`;
  }

  // Next action
  if (data.nextAction) {
    html += `
      <div class="gsd-viz-next-section">
        <div class="gsd-viz-section-title">Next Action</div>
        <div class="gsd-viz-next-value">${escapeHtml(data.nextAction)}</div>
      </div>
    `;
  }

  return html;
}

function renderSliceRow(slice: DashboardSlice): string {
  const icon = slice.done ? "✓" : slice.active ? "▸" : "○";
  const cls = slice.done ? "done" : slice.active ? "active" : "pending";
  const riskCls = `risk-${slice.risk}`;

  let tasksHtml = "";
  if (slice.active && slice.tasks.length > 0) {
    tasksHtml = `<div class="gsd-viz-tasks">`;
    for (const t of slice.tasks) {
      const tIcon = t.done ? "✓" : t.active ? "▸" : "·";
      const tCls = t.done ? "done" : t.active ? "active" : "pending";
      tasksHtml += `<div class="gsd-viz-task ${tCls}">
        <span class="gsd-viz-icon">${tIcon}</span>
        ${escapeHtml(t.id)}: ${escapeHtml(t.title)}
      </div>`;
    }
    tasksHtml += `</div>`;
  }

  // Inline progress for slices with task data
  let progressHint = "";
  if (slice.taskProgress && slice.taskProgress.total > 0) {
    progressHint = `<span class="gsd-viz-slice-progress">${slice.taskProgress.done}/${slice.taskProgress.total}</span>`;
  }

  return `
    <div class="gsd-viz-slice ${cls}">
      <div class="gsd-viz-slice-row">
        <span class="gsd-viz-icon">${icon}</span>
        <span class="gsd-viz-slice-title">${escapeHtml(slice.id)}: ${escapeHtml(slice.title)}</span>
        <span class="gsd-viz-risk ${riskCls}">${escapeHtml(slice.risk)}</span>
        ${progressHint}
      </div>
      ${tasksHtml}
    </div>
  `;
}

function renderProgressBar(label: string, done: number, total: number, level: string): string {
  if (total === 0) return "";
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const fillPct = total > 0 ? (done / total) * 100 : 0;
  return `
    <div class="gsd-viz-progress-row">
      <span class="gsd-viz-progress-label">${escapeHtml(label)}</span>
      <div class="gsd-viz-progress-track">
        <div class="gsd-viz-progress-fill gsd-viz-progress-fill--${level}" style="width: ${fillPct}%"></div>
      </div>
      <span class="gsd-viz-progress-pct">${pct}%</span>
      <span class="gsd-viz-progress-ratio">${done}/${total}</span>
    </div>
  `;
}

// ============================================================
// Metrics Tab
// ============================================================

function renderMetricsTab(data: DashboardData): string {
  let html = `<div class="gsd-viz-metrics">`;

  const stats = data.stats;
  const autoData = state.autoProgress;

  // Cost
  const cost = stats?.cost ?? (autoData?.cost ?? null);
  if (cost !== null && cost !== undefined) {
    html += `
      <div class="gsd-viz-metric-card">
        <div class="gsd-viz-metric-value">$${cost.toFixed(4)}</div>
        <div class="gsd-viz-metric-label">Session Cost</div>
      </div>
    `;
  }

  // Tool calls
  if (stats?.toolCalls) {
    html += `
      <div class="gsd-viz-metric-card">
        <div class="gsd-viz-metric-value">${stats.toolCalls}</div>
        <div class="gsd-viz-metric-label">Tool Calls</div>
      </div>
    `;
  }

  // User turns
  if (stats?.userMessages) {
    html += `
      <div class="gsd-viz-metric-card">
        <div class="gsd-viz-metric-value">${stats.userMessages}</div>
        <div class="gsd-viz-metric-label">User Turns</div>
      </div>
    `;
  }

  // Model
  const modelId = state.model?.id || autoData?.model?.id;
  if (modelId) {
    html += `
      <div class="gsd-viz-metric-card">
        <div class="gsd-viz-metric-value gsd-viz-metric-model">${escapeHtml(modelId)}</div>
        <div class="gsd-viz-metric-label">Model</div>
      </div>
    `;
  }

  html += `</div>`; // close .gsd-viz-metrics grid

  // Token breakdown
  if (stats?.tokens) {
    const t = stats.tokens;
    html += `
      <div class="gsd-viz-tokens-section">
        <div class="gsd-viz-section-title">Token Usage</div>
        <div class="gsd-viz-tokens-grid">
          <div class="gsd-viz-token-item">
            <span class="gsd-viz-token-value">${formatTokens(t.input)}</span>
            <span class="gsd-viz-token-label">Input</span>
          </div>
          <div class="gsd-viz-token-item">
            <span class="gsd-viz-token-value">${formatTokens(t.output)}</span>
            <span class="gsd-viz-token-label">Output</span>
          </div>
          <div class="gsd-viz-token-item">
            <span class="gsd-viz-token-value">${formatTokens(t.cacheRead)}</span>
            <span class="gsd-viz-token-label">Cache Read</span>
          </div>
          <div class="gsd-viz-token-item">
            <span class="gsd-viz-token-value">${formatTokens(t.cacheWrite)}</span>
            <span class="gsd-viz-token-label">Cache Write</span>
          </div>
          <div class="gsd-viz-token-item gsd-viz-token-total">
            <span class="gsd-viz-token-value">${formatTokens(t.total)}</span>
            <span class="gsd-viz-token-label">Total</span>
          </div>
        </div>
      </div>
    `;
  }

  // Context usage
  const sessionStats = state.sessionStats;
  if (sessionStats.contextWindow && sessionStats.contextTokens) {
    const pct = ((sessionStats.contextTokens / sessionStats.contextWindow) * 100).toFixed(1);
    html += `
      <div class="gsd-viz-context-section">
        <div class="gsd-viz-section-title">Context Window</div>
        <div class="gsd-viz-progress-row">
          <span class="gsd-viz-progress-label">Usage</span>
          <div class="gsd-viz-progress-track">
            <div class="gsd-viz-progress-fill gsd-viz-progress-fill--context" style="width: ${pct}%"></div>
          </div>
          <span class="gsd-viz-progress-pct">${pct}%</span>
          <span class="gsd-viz-progress-ratio">${formatTokens(sessionStats.contextTokens)}/${formatTokens(sessionStats.contextWindow)}</span>
        </div>
      </div>
    `;
  }

  return html;
}

// ============================================================
// Helpers
// ============================================================

function formatPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    "pre-planning": "Pre-planning",
    "discussing": "Discussing",
    "researching": "Researching",
    "planning": "Planning",
    "executing": "Executing",
    "verifying": "Verifying",
    "summarizing": "Summarizing",
    "advancing": "Advancing",
    "completing-milestone": "Completing",
    "replanning-slice": "Replanning",
    "complete": "Complete",
    "paused": "Paused",
    "blocked": "Blocked",
  };
  return labels[phase] || phase;
}

function getPhaseClass(phase: string): string {
  if (phase === "complete") return "phase-complete";
  if (phase === "blocked") return "phase-blocked";
  if (phase === "executing") return "phase-executing";
  return "";
}

function wireClose(): void {
  overlayEl?.querySelector("#vizClose")?.addEventListener("click", hide);
}

function wireTabs(): void {
  const tabs = overlayEl?.querySelectorAll(".gsd-visualizer-tab");
  tabs?.forEach(tab => {
    tab.addEventListener("click", () => {
      const t = (tab as HTMLElement).dataset.tab as "progress" | "metrics";
      if (t && t !== activeTab) {
        activeTab = t;
        render();
      }
    });
  });
}
