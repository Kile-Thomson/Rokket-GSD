// ============================================================
// Dashboard Panel — renders GSD project status dashboard
// ============================================================

import type { DashboardData, DashboardSlice, DashboardMetrics } from "../shared/types";
import { escapeHtml, scrollToBottom } from "./helpers";
import { state } from "./state";

// ============================================================
// Element refs — set via init()
// ============================================================

let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;
let welcomeProcess: HTMLElement;
let welcomeVersion: HTMLElement;
let welcomeModel: HTMLElement;
let welcomeHints: HTMLElement;

export interface DashboardDeps {
  messagesContainer: HTMLElement;
  welcomeScreen: HTMLElement;
  welcomeProcess: HTMLElement;
  welcomeVersion: HTMLElement;
  welcomeModel: HTMLElement;
  welcomeHints: HTMLElement;
}

export function init(deps: DashboardDeps): void {
  messagesContainer = deps.messagesContainer;
  welcomeScreen = deps.welcomeScreen;
  welcomeProcess = deps.welcomeProcess;
  welcomeVersion = deps.welcomeVersion;
  welcomeModel = deps.welcomeModel;
  welcomeHints = deps.welcomeHints;
}

// ============================================================
// Dashboard rendering
// ============================================================

export function renderDashboard(data: DashboardData | null): void {
  welcomeScreen.classList.add('gsd-hidden');

  // Remove any existing dashboard
  const existing = document.querySelector(".gsd-dashboard");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = "gsd-dashboard";

  if (!data || (!data.hasProject && !data.hasMilestone)) {
    el.innerHTML = `
      <div class="gsd-dashboard-empty">
        <div class="gsd-dashboard-empty-icon">📊</div>
        <div class="gsd-dashboard-empty-text">No active GSD project</div>
        <div class="gsd-dashboard-empty-hint">Run <code>/gsd</code> to start a project in this workspace</div>
      </div>
    `;
    messagesContainer.appendChild(el);
    scrollToBottom(messagesContainer, true);
    return;
  }

  // data is non-null after the guard above — alias for closure type narrowing
  const _d: NonNullable<DashboardData> = data;
  const phaseLabels: Record<string, string> = {
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
    "unknown": "",
  };

  const phaseText = phaseLabels[data.phase] || data.phase;
  const phaseClass = data.phase === "complete" ? "complete"
    : data.phase === "blocked" ? "blocked"
    : data.phase === "executing" ? "executing" : "";

  // Build current action breadcrumb
  const breadcrumb: string[] = [];
  if (data.milestone) breadcrumb.push(data.milestone.id);
  if (data.slice) breadcrumb.push(data.slice.id);
  if (data.task) breadcrumb.push(data.task.id);

  // Progress bar helper
  function progressBar(done: number, total: number, label: string): string {
    if (total === 0) return "";
    const pct = Math.round((done / total) * 100);
    const fillPct = (done / total) * 100;
    return `
      <div class="gsd-dash-progress-row">
        <span class="gsd-dash-progress-label">${escapeHtml(label)}</span>
        <div class="gsd-dash-progress-track">
          <div class="gsd-dash-progress-fill" data-fill-pct="${fillPct}"></div>
        </div>
        <span class="gsd-dash-progress-pct">${pct}%</span>
        <span class="gsd-dash-progress-ratio">${done}/${total}</span>
      </div>
    `;
  }

  // Slice list with nested tasks
  function sliceList(slices: DashboardSlice[]): string {
    if (slices.length === 0) return "";
    return `<div class="gsd-dash-slices">` + slices.map(s => {
      const icon = s.done ? "✓" : s.active ? "▸" : "○";
      const cls = s.done ? "done" : s.active ? "active" : "pending";
      const riskCls = `risk-${s.risk}`;

      let tasksHtml = "";
      if (s.active && s.tasks.length > 0) {
        tasksHtml = `<div class="gsd-dash-tasks">` +
          s.tasks.map(t => {
            const tIcon = t.done ? "✓" : t.active ? "▸" : "·";
            const tCls = t.done ? "done" : t.active ? "active" : "pending";
            return `<div class="gsd-dash-task ${tCls}"><span class="gsd-dash-icon">${tIcon}</span> ${escapeHtml(t.id)}: ${escapeHtml(t.title)}</div>`;
          }).join("") +
          `</div>`;
      }

      return `
        <div class="gsd-dash-slice ${cls}">
          <div class="gsd-dash-slice-row">
            <span class="gsd-dash-icon">${icon}</span>
            <span class="gsd-dash-slice-title">${escapeHtml(s.id)}: ${escapeHtml(s.title)}</span>
            <span class="gsd-dash-risk ${riskCls}">${escapeHtml(s.risk)}</span>
          </div>
          ${tasksHtml}
        </div>
      `;
    }).join("") + `</div>`;
  }

  // Milestone registry
  function milestoneList(entries: typeof d.milestoneRegistry): string {
    if (entries.length === 0) return "";
    return `
      <div class="gsd-dash-section">
        <div class="gsd-dash-section-title">Milestones</div>
        <div class="gsd-dash-milestones">
          ${entries.map(m => {
            const icon = m.done ? "✓" : m.active ? "▸" : "○";
            const cls = m.done ? "done" : m.active ? "active" : "pending";
            return `<div class="gsd-dash-milestone ${cls}"><span class="gsd-dash-icon">${icon}</span> ${escapeHtml(m.id)}: ${escapeHtml(m.title)}</div>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  // Cost & usage section
  function costSection(stats: typeof _d.stats): string {
    if (!stats) return "";
    const parts: string[] = [];

    if (stats.cost != null) {
      parts.push(`<span class="gsd-dash-cost-value">$${stats.cost.toFixed(4)}</span> total`);
    }
    if (stats.tokens?.total) {
      parts.push(`${formatTokenCount(stats.tokens.total)} tokens`);
    }
    if (stats.toolCalls) {
      parts.push(`${stats.toolCalls} tools`);
    }
    if (stats.userMessages) {
      parts.push(`${stats.userMessages} turns`);
    }

    if (parts.length === 0) return "";

    let tokenDetail = "";
    if (stats.tokens) {
      const t = stats.tokens;
      tokenDetail = `<div class="gsd-dash-cost-detail">in: ${formatTokenCount(t.input)}  out: ${formatTokenCount(t.output)}  cache-r: ${formatTokenCount(t.cacheRead)}  cache-w: ${formatTokenCount(t.cacheWrite)}</div>`;
    }

    return `
      <div class="gsd-dash-section">
        <div class="gsd-dash-section-title">Cost & Usage</div>
        <div class="gsd-dash-cost-summary">${parts.join("  ·  ")}</div>
        ${tokenDetail}
      </div>
    `;
  }

  // Blockers section
  function blockersSection(blockers: string[]): string {
    if (blockers.length === 0) return "";
    return `
      <div class="gsd-dash-section">
        <div class="gsd-dash-section-title gsd-dash-blockers-title">⚠ Blockers</div>
        ${blockers.map(b => `<div class="gsd-dash-blocker">${escapeHtml(b)}</div>`).join("")}
      </div>
    `;
  }

  // Next action
  function nextActionSection(next: string | null): string {
    if (!next) return "";
    return `
      <div class="gsd-dash-section">
        <div class="gsd-dash-section-title">Next</div>
        <div class="gsd-dash-next">${escapeHtml(next)}</div>
      </div>
    `;
  }

  // Build the full dashboard
  const hasActiveWork = data.hasMilestone && data.milestone;

  el.innerHTML = `
    <div class="gsd-dashboard-header">
      <div class="gsd-dashboard-title">📊 GSD Dashboard</div>
      <span class="gsd-dashboard-phase ${phaseClass}">${escapeHtml(phaseText)}</span>
    </div>

    ${(data.task || data.slice) ? `
    <div class="gsd-dash-current">
      <span class="gsd-dash-current-label">Now:</span>
      <span class="gsd-dash-current-action">${escapeHtml(phaseText)} ${escapeHtml(breadcrumb.join("/"))}</span>
    </div>
    ` : ""}

    ${hasActiveWork ? `
      <div class="gsd-dash-milestone-title">${escapeHtml(data.milestone!.id)}: ${escapeHtml(data.milestone!.title)}</div>

      <div class="gsd-dash-progress">
        ${progressBar(data.progress.tasks.done, data.progress.tasks.total, "Tasks")}
        ${progressBar(data.progress.slices.done, data.progress.slices.total, "Slices")}
        ${progressBar(data.progress.milestones.done, data.progress.milestones.total, "Milestones")}
      </div>

      ${sliceList(data.slices)}
    ` : `
      <div class="gsd-dash-progress">
        ${progressBar(data.progress.milestones.done, data.progress.milestones.total, "Milestones")}
      </div>
    `}

    ${milestoneList(data.milestoneRegistry)}
    ${blockersSection(data.blockers)}
    ${data.metrics ? metricsSection(data.metrics) : costSection(data.stats)}
    ${nextActionSection(data.nextAction)}

    <div class="gsd-dashboard-footer">
      <span class="gsd-dash-hint">${hasActiveWork ? `Run <code>/gsd auto</code> to start executing` : `Run <code>/gsd</code> to start a new milestone`}</span>
    </div>
  `;

  messagesContainer.appendChild(el);

  // Set progress bar fill widths via JS (CSP-safe — no inline styles in HTML)
  el.querySelectorAll<HTMLElement>(".gsd-dash-progress-fill[data-fill-pct]").forEach((fill) => {
    fill.style.width = `${fill.dataset.fillPct}%`;
  });

  scrollToBottom(messagesContainer, true);
}

// ============================================================
// Metrics rendering (from .gsd/metrics.json)
// ============================================================

function metricsSection(m: DashboardMetrics): string {
  const parts: string[] = [];

  // Totals summary
  const summaryItems: string[] = [];
  if (m.totals.cost > 0) summaryItems.push(`<span class="gsd-dash-cost-value">${fmtCost(m.totals.cost)}</span> total`);
  if (m.totals.tokens.total > 0) summaryItems.push(`${formatTokenCount(m.totals.tokens.total)} tokens`);
  if (m.totals.toolCalls > 0) summaryItems.push(`${m.totals.toolCalls} tools`);
  if (m.totals.units > 0) summaryItems.push(`${m.totals.units} units`);
  if (m.elapsedMs > 0) summaryItems.push(`${fmtDuration(m.elapsedMs)} elapsed`);

  parts.push(`
    <div class="gsd-dash-section">
      <div class="gsd-dash-section-title">Cost & Usage</div>
      <div class="gsd-dash-cost-summary">${summaryItems.join("  ·  ")}</div>
    </div>
  `);

  // Projection
  if (m.projection) {
    parts.push(`
      <div class="gsd-dash-section gsd-dash-projection">
        <div class="gsd-dash-projection-line">Projected remaining: <strong>${fmtCost(m.projection.projectedRemaining)}</strong> (${fmtCost(m.projection.avgCostPerSlice)}/slice avg × ${m.projection.remainingSlices} remaining)</div>
      </div>
    `);
  }

  // Phase breakdown
  if (m.byPhase.length > 0) {
    parts.push(breakdownTable("By Phase", m.byPhase.map(p => ({
      label: p.phase.charAt(0).toUpperCase() + p.phase.slice(1),
      cost: p.cost,
      tokens: p.tokens.total,
      units: p.units,
      duration: p.duration,
    }))));
  }

  // Slice breakdown
  if (m.bySlice.length > 0) {
    parts.push(breakdownTable("By Slice", m.bySlice.map(s => ({
      label: s.sliceId,
      cost: s.cost,
      tokens: s.tokens.total,
      units: s.units,
      duration: s.duration,
    }))));
  }

  // Model breakdown
  if (m.byModel.length > 0) {
    parts.push(breakdownTable("By Model", m.byModel.map(mo => ({
      label: mo.model.replace(/^.*\//, ""), // strip provider prefix
      cost: mo.cost,
      tokens: mo.tokens.total,
      units: mo.units,
    }))));
  }

  // Activity log
  if (m.recentUnits.length > 0) {
    const rows = m.recentUnits.map(u => {
      const dur = u.finishedAt - u.startedAt;
      return `<div class="gsd-dash-activity-row">
        <span class="gsd-dash-activity-type">${escapeHtml(u.type.replace(/-/g, " "))}</span>
        <span class="gsd-dash-activity-id">${escapeHtml(u.id)}</span>
        <span class="gsd-dash-activity-cost">${fmtCost(u.cost)}</span>
        <span class="gsd-dash-activity-dur">${fmtDuration(dur)}</span>
      </div>`;
    }).join("");

    parts.push(`
      <div class="gsd-dash-section">
        <div class="gsd-dash-section-title">Activity Log</div>
        <div class="gsd-dash-activity${m.recentUnits.length > 10 ? " gsd-dash-activity-scroll" : ""}">${rows}</div>
      </div>
    `);
  }

  return parts.join("");
}

interface BreakdownRow {
  label: string;
  cost: number;
  tokens: number;
  units: number;
  duration?: number;
}

function breakdownTable(title: string, rows: BreakdownRow[]): string {
  // Compact mode: ≤2 rows collapse to inline
  if (rows.length <= 2) {
    const inline = rows.map(r =>
      `<span class="gsd-dash-inline-breakdown">${escapeHtml(r.label)}: ${fmtCost(r.cost)}</span>`
    ).join("  ·  ");
    return `
      <div class="gsd-dash-section">
        <div class="gsd-dash-section-title">${escapeHtml(title)}</div>
        <div class="gsd-dash-cost-summary">${inline}</div>
      </div>
    `;
  }

  const tableRows = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td class="gsd-dash-num">${fmtCost(r.cost)}</td>
      <td class="gsd-dash-num">${formatTokenCount(r.tokens)}</td>
      <td class="gsd-dash-num">${r.units}</td>
      ${r.duration != null ? `<td class="gsd-dash-num">${fmtDuration(r.duration)}</td>` : ""}
    </tr>
  `).join("");

  const hasDuration = rows.some(r => r.duration != null);
  return `
    <div class="gsd-dash-section">
      <div class="gsd-dash-section-title">${escapeHtml(title)}</div>
      <table class="gsd-dash-table">
        <thead><tr>
          <th></th><th>Cost</th><th>Tokens</th><th>Units</th>
          ${hasDuration ? "<th>Time</th>" : ""}
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;
}

function fmtCost(cost: number): string {
  const n = Number(cost) || 0;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function updateWelcomeScreen(): void {
  // Only hide welcome for real conversation entries (user messages, assistant turns)
  // System info/warning entries alone shouldn't dismiss it
  const hasConversation = state.currentTurn || state.entries.some(
    e => e.type === "user" || e.type === "assistant"
  );
  if (hasConversation) {
    welcomeScreen.classList.add('gsd-hidden');
    return;
  }
  welcomeScreen.classList.remove('gsd-hidden');

  welcomeVersion.textContent = state.version ? `v${state.version}` : "";

  switch (state.processStatus) {
    case "starting":
      welcomeProcess.textContent = "Starting GSD…";
      break;
    case "running":
      welcomeProcess.textContent = "Type a message to start";
      break;
    case "crashed":
      welcomeProcess.textContent = "GSD failed to start — check the error below";
      break;
    case "restarting":
      welcomeProcess.textContent = "Restarting…";
      break;
    default:
      welcomeProcess.textContent = "Initializing…";
  }

  if (state.model && state.processStatus === "running") {
    let modelStr = state.model.id || state.model.name || "";
    if (state.model.provider) modelStr = `${state.model.provider}/${modelStr}`;
    if (state.thinkingLevel && state.thinkingLevel !== "off") {
      modelStr += ` • 🧠 ${state.thinkingLevel}`;
    }
    welcomeModel.textContent = modelStr;
    welcomeModel.classList.remove('gsd-hidden');
  } else {
    welcomeModel.classList.add('gsd-hidden');
  }

  if (state.processStatus === "running") {
    const sendKey = state.useCtrlEnterToSend ? "Ctrl+Enter" : "Enter";
    welcomeHints.innerHTML = [
      `<span>${sendKey} to send</span>`,
      `<span>Shift+Enter for newline</span>`,
      `<span>Esc to interrupt</span>`,
      `<span>/ for commands</span>`,
    ].join('<span class="gsd-hint-sep">•</span>');
    welcomeHints.classList.remove('gsd-hidden');

    // Show resume button when process is ready
    const resumeChip = document.querySelector(".gsd-resume-chip") as HTMLElement | null;
    if (resumeChip) {
      resumeChip.classList.remove('gsd-hidden');
    }
  } else {
    welcomeHints.classList.add('gsd-hidden');
    const resumeChip = document.querySelector(".gsd-resume-chip") as HTMLElement | null;
    if (resumeChip) {
      resumeChip.classList.add('gsd-hidden');
    }
  }
}
