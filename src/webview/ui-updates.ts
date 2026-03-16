// ============================================================
// UI Updates — header, footer, input, overlays, workflow badge
// ============================================================

import type { WorkflowState } from "../shared/types";
import {
  escapeHtml,
  formatCost,
  formatTokens,
  formatContextUsage,
} from "./helpers";
import { state } from "./state";
import * as dashboard from "./dashboard";

// ============================================================
// Dependencies — set via init()
// ============================================================

let vscode: { postMessage(msg: unknown): void };
let modelBadge: HTMLElement;
let thinkingBadge: HTMLElement;
let headerSep1: HTMLElement;
let costBadge: HTMLElement;
let contextBadge: HTMLElement;
let contextBarContainer: HTMLElement;
let contextBar: HTMLElement;
let footerCwd: HTMLElement;
let footerStats: HTMLElement;
let footerRight: HTMLElement;
let sendBtn: HTMLElement;
let sendIcon: HTMLElement;
let promptInput: HTMLTextAreaElement;
let inputHint: HTMLElement;
let overlayIndicators: HTMLElement;

export interface UIUpdatesDeps {
  vscode: { postMessage(msg: unknown): void };
  modelBadge: HTMLElement;
  thinkingBadge: HTMLElement;
  headerSep1: HTMLElement;
  costBadge: HTMLElement;
  contextBadge: HTMLElement;
  contextBarContainer: HTMLElement;
  contextBar: HTMLElement;
  footerCwd: HTMLElement;
  footerStats: HTMLElement;
  footerRight: HTMLElement;
  sendBtn: HTMLElement;
  sendIcon: HTMLElement;
  promptInput: HTMLTextAreaElement;
  inputHint: HTMLElement;
  overlayIndicators: HTMLElement;
}

export function init(deps: UIUpdatesDeps): void {
  vscode = deps.vscode;
  modelBadge = deps.modelBadge;
  thinkingBadge = deps.thinkingBadge;
  headerSep1 = deps.headerSep1;
  costBadge = deps.costBadge;
  contextBadge = deps.contextBadge;
  contextBarContainer = deps.contextBarContainer;
  contextBar = deps.contextBar;
  footerCwd = deps.footerCwd;
  footerStats = deps.footerStats;
  footerRight = deps.footerRight;
  sendBtn = deps.sendBtn;
  sendIcon = deps.sendIcon;
  promptInput = deps.promptInput;
  inputHint = deps.inputHint;
  overlayIndicators = deps.overlayIndicators;
}

// ============================================================
// Update functions
// ============================================================

export function updateAllUI(): void {
  updateHeaderUI();
  updateFooterUI();
  updateInputUI();
  updateOverlayIndicators();
  dashboard.updateWelcomeScreen();
}

export function updateHeaderUI(): void {
  if (state.model) {
    modelBadge.textContent = state.model.name || state.model.id;
    modelBadge.title = `${state.model.provider} / ${state.model.id}`;
    modelBadge.style.display = "inline-flex";
  } else {
    modelBadge.style.display = "none";
  }

  // Thinking badge — model-aware
  const modelSupportsReasoning = state.model
    ? state.availableModels.some(
        (m) => m.id === state.model!.id && m.provider === state.model!.provider && m.reasoning
      )
    : false;

  if (state.model && !modelSupportsReasoning && state.modelsLoaded) {
    // Non-reasoning model — show disabled badge
    thinkingBadge.textContent = "🧠 N/A";
    thinkingBadge.title = "Current model does not support extended thinking";
    thinkingBadge.style.display = "inline-flex";
    thinkingBadge.classList.add("disabled");
  } else {
    const thinkingLabel = state.thinkingLevel && state.thinkingLevel !== "off" ? state.thinkingLevel : "off";
    thinkingBadge.textContent = `🧠 ${thinkingLabel}`;
    thinkingBadge.title = "Click to select thinking level";
    thinkingBadge.style.display = "inline-flex";
    thinkingBadge.classList.remove("disabled");
  }

  const stats = state.sessionStats;
  const hasCost = stats.cost != null && stats.cost > 0;
  if (hasCost) {
    costBadge.textContent = formatCost(stats.cost);
    costBadge.style.display = "inline-flex";
  } else {
    costBadge.style.display = "none";
  }

  const ctx = formatContextUsage(stats, state.model);
  if (ctx) {
    contextBadge.textContent = `◐ ${ctx}`;
    contextBadge.style.display = "inline-flex";
    const pct = stats.contextPercent ?? 0;
    contextBadge.classList.remove("warn", "crit");
    if (pct > 90) contextBadge.classList.add("crit");
    else if (pct > 70) contextBadge.classList.add("warn");
  } else {
    contextBadge.style.display = "none";
  }

  // Show separator between model/thinking and cost/context groups
  const hasLeftBadges = modelBadge.style.display !== "none" || thinkingBadge.style.display !== "none";
  const hasRightBadges = costBadge.style.display !== "none" || contextBadge.style.display !== "none";
  headerSep1.style.display = hasLeftBadges && hasRightBadges ? "block" : "none";

  // Context usage bar
  updateContextBar();
}

function updateContextBar(): void {
  const pct = state.sessionStats.contextPercent ?? 0;
  if (pct <= 0) {
    contextBarContainer.style.display = "none";
    return;
  }

  contextBarContainer.style.display = "block";
  contextBar.style.width = `${Math.min(pct, 100)}%`;

  contextBar.classList.remove("ok", "warn", "crit");
  if (pct > 90) {
    contextBar.classList.add("crit");
  } else if (pct > 70) {
    contextBar.classList.add("warn");
  } else {
    contextBar.classList.add("ok");
  }
}

export function updateFooterUI(): void {
  footerCwd.textContent = state.cwd || "";
  footerCwd.title = state.cwd;

  const stats = state.sessionStats;
  const tokens = stats.tokens;
  const parts: string[] = [];

  if (tokens) {
    const tokenParts: string[] = [];
    if (tokens.input) tokenParts.push(`in:${formatTokens(tokens.input)}`);
    if (tokens.output) tokenParts.push(`out:${formatTokens(tokens.output)}`);
    if (tokens.cacheRead) tokenParts.push(`cache:${formatTokens(tokens.cacheRead)}`);
    if (tokenParts.length > 0) parts.push(tokenParts.join(" "));
  }

  if (stats.cost != null && stats.cost > 0) {
    parts.push(formatCost(stats.cost));
  }

  const ctx = formatContextUsage(stats, state.model);
  if (ctx) parts.push(ctx);

  footerStats.textContent = parts.join(" · ");

  let right = "";
  if (state.model) {
    right = state.model.id || state.model.name || "";
    if (state.thinkingLevel && state.thinkingLevel !== "off") {
      right += ` • ${state.thinkingLevel}`;
    } else {
      right += " • thinking off";
    }
  }
  footerRight.textContent = right;
}

export function updateInputUI(): void {
  // Toggle rocket glow based on streaming state
  const logo = document.querySelector(".gsd-logo");
  if (logo) {
    logo.classList.toggle("working", state.isStreaming);
  }

  if (state.isStreaming) {
    sendIcon.textContent = "■";
    sendBtn.classList.add("gsd-stop-btn");
    sendBtn.title = "Stop (Esc)";
    promptInput.placeholder = "Interrupt or steer GSD...";
  } else {
    sendIcon.textContent = "↑";
    sendBtn.classList.remove("gsd-stop-btn");
    sendBtn.title = "Send";
    promptInput.placeholder = "Message GSD...";
  }

  const sendKey = state.useCtrlEnterToSend ? "Ctrl+Enter" : "Enter";
  if (state.isStreaming) {
    inputHint.textContent = `${sendKey} to steer • Esc to stop`;
  } else {
    inputHint.textContent = `${sendKey} to send • !cmd for bash • / for commands`;
  }
}

export function updateOverlayIndicators(): void {
  const parts: string[] = [];

  if (state.isCompacting) {
    parts.push(`<div class="gsd-overlay-indicator compacting">
      <span class="gsd-overlay-spinner"></span>Compacting context…
    </div>`);
  }

  if (state.isRetrying && state.retryInfo) {
    parts.push(`<div class="gsd-overlay-indicator retrying">
      <span class="gsd-overlay-spinner"></span>Retrying (${state.retryInfo.attempt}/${state.retryInfo.maxAttempts})…
      <span class="gsd-overlay-detail">${escapeHtml(state.retryInfo.errorMessage)}</span>
    </div>`);
  }

  if (state.processStatus === "starting") {
    parts.push(`<div class="gsd-overlay-indicator starting">
      <span class="gsd-overlay-spinner"></span>Starting GSD…
    </div>`);
  }

  if (state.processStatus === "restarting") {
    parts.push(`<div class="gsd-overlay-indicator restarting">
      <span class="gsd-overlay-spinner"></span>Restarting GSD…
    </div>`);
  }

  if (state.processStatus === "crashed") {
    parts.push(`<div class="gsd-overlay-indicator crashed">
      ⚠ GSD process not running
      <button id="restartBtn" class="gsd-overlay-btn">Restart</button>
    </div>`);
  }

  if (state.processHealth === "unresponsive") {
    parts.push(`<div class="gsd-overlay-indicator unresponsive">
      ⚠ GSD is unresponsive
      <button id="forceRestartBtn" class="gsd-overlay-btn danger">Force Restart</button>
      <button id="forceKillBtn" class="gsd-overlay-btn">Kill Process</button>
    </div>`);
  }

  overlayIndicators.innerHTML = parts.join("");
  overlayIndicators.style.display = parts.length > 0 ? "flex" : "none";

  // Wire up force buttons (if rendered)
  const forceRestartBtn = document.getElementById("forceRestartBtn");
  if (forceRestartBtn) {
    forceRestartBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "force_restart" });
      state.processHealth = "responsive";
      state.processStatus = "restarting";
      updateOverlayIndicators();
    });
  }
  const forceKillBtn = document.getElementById("forceKillBtn");
  if (forceKillBtn) {
    forceKillBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "force_kill" });
      state.processHealth = "responsive";
      updateOverlayIndicators();
    });
  }
}

export function updateWorkflowBadge(wf: WorkflowState | null): void {
  const badge = document.getElementById("workflowBadge");
  if (!badge) return;

  if (!wf) {
    badge.textContent = "Self-directed";
    badge.className = "gsd-workflow-badge";
    badge.style.display = "inline-flex";
    return;
  }

  const parts: string[] = [];

  // Build breadcrumb: M004 › S02 › T03
  if (wf.milestone) parts.push(wf.milestone.id);
  if (wf.slice) parts.push(wf.slice.id);
  if (wf.task) parts.push(wf.task.id);

  // Phase label
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
  const phaseText = phaseLabels[wf.phase] || wf.phase;

  // Build display text
  let text: string;
  if (parts.length > 0) {
    text = parts.join(" › ");
    if (phaseText && phaseText !== "Complete") {
      text += ` · ${phaseText}`;
    } else if (phaseText === "Complete") {
      text += " ✓";
    }
  } else if (phaseText) {
    text = phaseText;
  } else {
    text = "Self-directed";
  }

  // Auto-mode prefix
  if (wf.autoMode === "auto") {
    text = `⚡ ${text}`;
  } else if (wf.autoMode === "next") {
    text = `▸ ${text}`;
  } else if (wf.autoMode === "paused") {
    text = `⏸ ${text}`;
  }

  badge.textContent = text;

  // Phase-based styling
  let extraClass = "";
  if (wf.phase === "blocked") extraClass = " blocked";
  else if (wf.phase === "paused") extraClass = " paused";
  else if (wf.phase === "complete") extraClass = " complete";
  else if (wf.autoMode) extraClass = " auto";

  badge.className = `gsd-workflow-badge${extraClass}`;
  badge.style.display = "inline-flex";
}

/**
 * Handle a model routing event — update badge and flash it.
 * Called when dynamic model routing switches models mid-task.
 */
export function handleModelRouted(
  oldModel: { id: string; provider: string } | null,
  newModel: { id: string; provider: string } | null,
): void {
  if (newModel) {
    // Look up the routed model's metadata from available models
    const routed = state.availableModels.find(
      (m) => m.id === newModel.id && m.provider === newModel.provider
    );

    // Update the state model so header reflects new model
    state.model = {
      id: newModel.id,
      name: routed?.name ?? newModel.id,
      provider: newModel.provider,
      contextWindow: routed?.contextWindow,
    };
    updateHeaderUI();

    // Flash the model badge to make the switch visually obvious
    modelBadge.classList.add("gsd-model-badge-flash");
    setTimeout(() => {
      modelBadge.classList.remove("gsd-model-badge-flash");
    }, 1500);
  }
}
