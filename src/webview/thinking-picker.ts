// ============================================================
// Thinking Picker — dropdown for selecting thinking/reasoning level
// ============================================================

import { state } from "./state";
import { escapeHtml } from "./helpers";
import type { ThinkingLevel } from "../shared/types";

// ============================================================
// Constants
// ============================================================

interface ThinkingOption {
  level: ThinkingLevel;
  label: string;
  description: string;
}

const THINKING_OPTIONS: ThinkingOption[] = [
  { level: "off",     label: "Off",     description: "No extended thinking" },
  { level: "minimal", label: "Minimal", description: "Brief internal reasoning" },
  { level: "low",     label: "Low",     description: "Light reasoning steps" },
  { level: "medium",  label: "Medium",  description: "Moderate depth" },
  { level: "high",    label: "High",    description: "Deep reasoning" },
  { level: "xhigh",   label: "Max",     description: "Maximum depth (Opus)" },
];

// ============================================================
// Module state
// ============================================================

let visible = false;

// ============================================================
// Dependencies injected via init()
// ============================================================

let pickerEl: HTMLElement;
let thinkingBadgeEl: HTMLElement;
let vscode: { postMessage(msg: unknown): void };
let onThinkingChanged: () => void;

// ============================================================
// Public API
// ============================================================

export function isVisible(): boolean {
  return visible;
}

export function toggle(): void {
  if (visible) {
    hide();
  } else {
    show();
  }
}

export function show(): void {
  // Don't show if model doesn't support reasoning
  if (!currentModelSupportsReasoning()) {
    return;
  }
  visible = true;
  render();
}

export function hide(): void {
  visible = false;
  pickerEl.style.display = "none";
  pickerEl.innerHTML = "";
}

/** Re-render if visible (called when thinking level changes externally) */
export function refresh(): void {
  if (visible) render();
}

// ============================================================
// Model capability detection
// ============================================================

function currentModelSupportsReasoning(): boolean {
  if (!state.model) return false;

  // If models list is loaded, use the authoritative reasoning flag
  if (state.modelsLoaded) {
    const modelInfo = state.availableModels.find(
      (m) => m.id === state.model!.id && m.provider === state.model!.provider
    );
    return modelInfo?.reasoning === true;
  }

  // Models not loaded yet — default to showing the dropdown.
  // The backend's setThinkingLevel will clamp to valid levels anyway.
  return true;
}

function currentModelSupportsXhigh(): boolean {
  if (!state.model) return false;
  const id = state.model.id.toLowerCase();
  // Matches supportsXhigh() in pi-ai — Opus 4.6
  return id.includes("opus-4-6") || id.includes("opus-4.6");
}

function getAvailableLevels(): ThinkingOption[] {
  if (!currentModelSupportsReasoning()) {
    return [THINKING_OPTIONS[0]]; // only "off"
  }
  if (currentModelSupportsXhigh()) {
    return THINKING_OPTIONS; // all including xhigh
  }
  return THINKING_OPTIONS.filter((o) => o.level !== "xhigh"); // standard 5
}

// ============================================================
// Rendering
// ============================================================

function render(): void {
  if (!visible) return;

  const levels = getAvailableLevels();
  const currentLevel = state.thinkingLevel || "off";

  let html = `<div class="gsd-thinking-picker-header">
    <span class="gsd-thinking-picker-title">Thinking Level</span>
    <button class="gsd-thinking-picker-close" id="thinkingPickerClose">✕</button>
  </div>`;

  html += `<div class="gsd-thinking-picker-list">`;

  for (const opt of levels) {
    const isActive = opt.level === currentLevel;
    const classes = [
      "gsd-thinking-picker-item",
      isActive ? "active" : "",
    ].filter(Boolean).join(" ");

    html += `<div class="${classes}" data-level="${opt.level}">
      <div class="gsd-thinking-picker-item-main">
        ${isActive ? '<span class="gsd-thinking-picker-dot">●</span>' : '<span class="gsd-thinking-picker-dot-spacer"></span>'}
        <span class="gsd-thinking-picker-label">${escapeHtml(opt.label)}</span>
      </div>
      <span class="gsd-thinking-picker-desc">${escapeHtml(opt.description)}</span>
    </div>`;
  }

  html += `</div>`;

  pickerEl.style.display = "block";
  pickerEl.innerHTML = html;

  // Position relative to the thinking badge
  const badgeRect = thinkingBadgeEl.getBoundingClientRect();
  const appEl = pickerEl.offsetParent as HTMLElement | null;
  const appRect = appEl?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth };
  let left = badgeRect.left - appRect.left;
  // Clamp so the picker doesn't overflow the right edge
  const maxLeft = appRect.width - 248; // 240px picker + 8px margin
  if (left > maxLeft) left = maxLeft;
  if (left < 4) left = 4;
  pickerEl.style.left = `${left}px`;
  pickerEl.style.top = `${badgeRect.bottom - appRect.top + 4}px`;

  // Wire close button
  pickerEl.querySelector("#thinkingPickerClose")?.addEventListener("click", hide);

  // Wire level selection
  pickerEl.querySelectorAll(".gsd-thinking-picker-item").forEach((el) => {
    el.addEventListener("click", () => {
      const level = (el as HTMLElement).dataset.level as ThinkingLevel;
      if (level === currentLevel) {
        hide();
        return;
      }
      vscode.postMessage({ type: "set_thinking_level", level });
      state.thinkingLevel = level;
      onThinkingChanged();
      hide();
    });
  });
}

// ============================================================
// Init
// ============================================================

export interface ThinkingPickerDeps {
  pickerEl: HTMLElement;
  thinkingBadge: HTMLElement;
  vscode: { postMessage(msg: unknown): void };
  onThinkingChanged: () => void;
}

export function init(deps: ThinkingPickerDeps): void {
  pickerEl = deps.pickerEl;
  thinkingBadgeEl = deps.thinkingBadge;
  vscode = deps.vscode;
  onThinkingChanged = deps.onThinkingChanged;

  // Wire up click handler on the badge
  deps.thinkingBadge.addEventListener("click", toggle);

  // Click-outside to close
  document.addEventListener("click", (e: Event) => {
    if (visible) {
      const target = e.target as HTMLElement;
      if (
        !pickerEl.contains(target) &&
        target !== deps.thinkingBadge &&
        !deps.thinkingBadge.contains(target)
      ) {
        hide();
      }
    }
  });
}
