// ============================================================
// Auto-Progress Widget
//
// Sticky bar above the input area showing auto-mode progress.
// Visible only when auto-mode is active. Shows current task,
// phase, progress bar, elapsed time, and cost.
// ============================================================

import { state } from "./state";
import { escapeHtml } from "./helpers";
import type { AutoProgressData } from "../shared/types";

// ============================================================
// Module state
// ============================================================

let widgetEl: HTMLElement | null = null;
let staleGuardTimer: ReturnType<typeof setInterval> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

/** Stable start time for elapsed counter — set once when auto-mode starts */
let autoStartTime: number = 0;

/** Stale data threshold — hide widget if no update for 30 seconds */
const STALE_THRESHOLD_MS = 30_000;

/** Elapsed time update interval */
const ELAPSED_UPDATE_MS = 1_000;

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the widget — find or create the DOM element.
 * Must be called after the DOM is ready.
 */
export function init(): void {
  widgetEl = document.getElementById("autoProgressWidget");
  if (!widgetEl) {
    // Create and insert before input area
    widgetEl = document.createElement("div");
    widgetEl.id = "autoProgressWidget";
    widgetEl.className = "gsd-auto-progress";
    widgetEl.style.display = "none";
    widgetEl.setAttribute("role", "status");
    widgetEl.setAttribute("aria-live", "polite");
    widgetEl.setAttribute("aria-label", "Auto-mode progress");

    const inputArea = document.querySelector(".gsd-input-area");
    if (inputArea?.parentElement) {
      inputArea.parentElement.insertBefore(widgetEl, inputArea);
    }
  }

  // Clear any prior stale-data guard to prevent duplicate timers
  if (staleGuardTimer) {
    clearInterval(staleGuardTimer);
    staleGuardTimer = null;
  }

  // Start stale-data guard
  staleGuardTimer = setInterval(() => {
    if (state.autoProgress && state.autoProgressLastUpdate > 0) {
      const elapsed = Date.now() - state.autoProgressLastUpdate;
      if (elapsed > STALE_THRESHOLD_MS) {
        // Data is stale — hide widget
        state.autoProgress = null;
        render();
      }
    }
  }, 5_000);
}

/**
 * Handle an auto_progress message from the extension host.
 */
export function update(data: AutoProgressData | null): void {
  const wasNull = state.autoProgress === null;
  state.autoProgress = data;
  if (data) {
    state.autoProgressLastUpdate = Date.now();
    // Set start time when auto-mode first activates (or re-activates after stop)
    if (wasNull || autoStartTime === 0) {
      autoStartTime = data.timestamp || Date.now();
    }
  } else {
    // Reset start time when auto-mode stops
    autoStartTime = 0;
  }
  render();
}

/**
 * Clean up timers.
 */
export function dispose(): void {
  if (staleGuardTimer) {
    clearInterval(staleGuardTimer);
    staleGuardTimer = null;
  }
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

// ============================================================
// Render
// ============================================================

function render(): void {
  if (!widgetEl) return;

  const data = state.autoProgress;

  if (!data) {
    widgetEl.style.display = "none";
    widgetEl.innerHTML = "";
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    return;
  }

  widgetEl.style.display = "flex";

  // Detect discussion-pause state
  const isDiscussionPause = data.autoState === "paused" && data.phase === "needs-discussion";

  // When in discussion-pause, stop the elapsed timer — time is not progressing
  if (isDiscussionPause) {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  } else if (!elapsedTimer) {
    // Start elapsed timer if not running (normal mode)
    elapsedTimer = setInterval(() => {
      updateElapsedDisplay();
    }, ELAPSED_UPDATE_MS);
  }

  const phase = formatPhase(data.phase);
  const phaseIcon = data.phase === "validate-milestone" ? "✓ " : "";
  const modeIcon = isDiscussionPause ? "💬" : data.autoState === "auto" ? "⚡" : data.autoState === "next" ? "▸" : "⏸";

  // Toggle discussion-pause class on widget
  widgetEl.classList.toggle("gsd-auto-progress-discussion", isDiscussionPause);

  // Build current target line
  let targetLine = "";
  if (data.task) {
    targetLine = `${escapeHtml(data.task.id)}: ${escapeHtml(data.task.title)}`;
  } else if (data.slice) {
    targetLine = `${escapeHtml(data.slice.id)}: ${escapeHtml(data.slice.title)}`;
  } else if (data.milestone) {
    targetLine = escapeHtml(data.milestone.title);
  }

  // Build progress bar
  const progressHtml = buildProgressBar(data);

  // Build stats line
  const statsHtml = buildStats(data);

  // Build hint line for discussion-pause state
  const hintHtml = isDiscussionPause
    ? `<div class="gsd-auto-progress-hint">Use /gsd discuss to continue</div>`
    : "";

  // Hide pulse dot during discussion pause
  const pulseHtml = isDiscussionPause
    ? ""
    : `<span class="gsd-auto-progress-pulse"></span>`;

  widgetEl.innerHTML = `
    <div class="gsd-auto-progress-inner">
      <div class="gsd-auto-progress-row gsd-auto-progress-main">
        ${pulseHtml}
        <span class="gsd-auto-progress-mode">${modeIcon}</span>
        <span class="gsd-auto-progress-phase">${phaseIcon}${escapeHtml(phase)}</span>
        <span class="gsd-auto-progress-target">${targetLine}</span>
        <span class="gsd-auto-progress-elapsed" data-timestamp="${autoStartTime}"></span>
      </div>
      ${hintHtml}
      <div class="gsd-auto-progress-row gsd-auto-progress-detail">
        ${progressHtml}
        ${statsHtml}
      </div>
    </div>
  `;

  updateElapsedDisplay();
}

function buildProgressBar(data: AutoProgressData): string {
  const parts: string[] = [];

  // Tasks progress (if available)
  if (data.tasks.total > 0) {
    const pct = Math.round((data.tasks.done / data.tasks.total) * 100);
    parts.push(`
      <span class="gsd-auto-progress-bar-group">
        <span class="gsd-auto-progress-bar-label">Tasks</span>
        <span class="gsd-auto-progress-bar-track">
          <span class="gsd-auto-progress-bar-fill" style="width: ${pct}%"></span>
        </span>
        <span class="gsd-auto-progress-bar-value">${data.tasks.done}/${data.tasks.total}</span>
      </span>
    `);
  }

  // Slices progress
  if (data.slices.total > 0) {
    const pct = Math.round((data.slices.done / data.slices.total) * 100);
    parts.push(`
      <span class="gsd-auto-progress-bar-group">
        <span class="gsd-auto-progress-bar-label">Slices</span>
        <span class="gsd-auto-progress-bar-track">
          <span class="gsd-auto-progress-bar-fill gsd-auto-progress-bar-fill--slices" style="width: ${pct}%"></span>
        </span>
        <span class="gsd-auto-progress-bar-value">${data.slices.done}/${data.slices.total}</span>
      </span>
    `);
  }

  return parts.join("");
}

function buildStats(data: AutoProgressData): string {
  const parts: string[] = [];

  // Pending captures badge
  if (data.pendingCaptures && data.pendingCaptures > 0) {
    parts.push(`<span class="gsd-auto-progress-stat gsd-auto-progress-captures">📌 ${data.pendingCaptures}</span>`);
  }

  if (data.cost !== undefined && data.cost > 0) {
    parts.push(`<span class="gsd-auto-progress-stat">$${data.cost.toFixed(2)}</span>`);
  }

  if (data.model) {
    const modelDisplay = data.model.id.length > 20
      ? data.model.id.slice(0, 18) + "…"
      : data.model.id;
    parts.push(`<span class="gsd-auto-progress-stat gsd-auto-progress-model">${escapeHtml(modelDisplay)}</span>`);
  }

  if (parts.length === 0) return "";
  return `<span class="gsd-auto-progress-stats">${parts.join("")}</span>`;
}

function formatPhase(phase: string): string {
  switch (phase) {
    case "pre-planning": return "PLANNING";
    case "planning": return "PLANNING";
    case "executing": return "EXECUTING";
    case "summarizing": return "COMPLETING";
    case "complete": return "COMPLETE";
    case "blocked": return "BLOCKED";
    case "replanning-slice": return "REPLANNING";
    case "needs-discussion": return "AWAITING DISCUSSION";
    case "validate-milestone": return "VALIDATING";
    default: return phase.toUpperCase();
  }
}

function updateElapsedDisplay(): void {
  const el = widgetEl?.querySelector(".gsd-auto-progress-elapsed") as HTMLElement | null;
  if (!el) return;

  const timestamp = parseInt(el.dataset.timestamp || "0", 10);
  if (!timestamp) return;

  const elapsed = Date.now() - timestamp;
  el.textContent = formatElapsed(elapsed);
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}
