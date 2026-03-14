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
let triggerEl: HTMLElement | null = null;
let activeIndex = -1;

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
  triggerEl = document.activeElement as HTMLElement | null;
  visible = true;
  activeIndex = -1;
  render();
}

export function hide(): void {
  visible = false;
  pickerEl.style.display = "none";
  pickerEl.innerHTML = "";
  if (triggerEl && typeof triggerEl.focus === "function") {
    triggerEl.focus();
    triggerEl = null;
  }
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
    <span class="gsd-thinking-picker-title" id="thinkingPickerTitle">Thinking Level</span>
    <button class="gsd-thinking-picker-close" id="thinkingPickerClose" aria-label="Close thinking picker">✕</button>
  </div>`;

  // Set initial activeIndex to current level
  if (activeIndex < 0) {
    activeIndex = levels.findIndex(o => o.level === currentLevel);
    if (activeIndex < 0) activeIndex = 0;
  }

  html += `<div class="gsd-thinking-picker-list" role="listbox" aria-labelledby="thinkingPickerTitle">`;

  for (let i = 0; i < levels.length; i++) {
    const opt = levels[i];
    const isCurrent = opt.level === currentLevel;
    const isFocused = i === activeIndex;
    const classes = [
      "gsd-thinking-picker-item",
      isCurrent ? "active" : "",
      isFocused ? "focused" : "",
    ].filter(Boolean).join(" ");

    html += `<div class="${classes}" role="option" aria-selected="${isCurrent}" tabindex="${isFocused ? "0" : "-1"}" data-level="${opt.level}" data-idx="${i}">
      <div class="gsd-thinking-picker-item-main">
        ${isCurrent ? '<span class="gsd-thinking-picker-dot">●</span>' : '<span class="gsd-thinking-picker-dot-spacer"></span>'}
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

  const items = pickerEl.querySelectorAll(".gsd-thinking-picker-item");
  const totalItems = items.length;

  function selectLevel(el: HTMLElement): void {
    const level = el.dataset.level as ThinkingLevel;
    if (level === currentLevel) {
      hide();
      return;
    }
    vscode.postMessage({ type: "set_thinking_level", level });
    state.thinkingLevel = level;
    onThinkingChanged();
    hide();
  }

  // Wire level selection
  items.forEach((el) => {
    el.addEventListener("click", () => selectLevel(el as HTMLElement));
  });

  // Arrow key navigation
  pickerEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, totalItems - 1);
      focusActiveItem();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      focusActiveItem();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = pickerEl.querySelector(`.gsd-thinking-picker-item[data-idx="${activeIndex}"]`) as HTMLElement | null;
      if (active) selectLevel(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  });

  function focusActiveItem(): void {
    items.forEach((el, i) => {
      (el as HTMLElement).tabIndex = i === activeIndex ? 0 : -1;
      if (i === activeIndex) {
        (el as HTMLElement).classList.add("focused");
        (el as HTMLElement).focus();
        (el as HTMLElement).scrollIntoView({ block: "nearest" });
      } else {
        (el as HTMLElement).classList.remove("focused");
      }
    });
  }

  // Focus initial active item
  const initialActive = pickerEl.querySelector(`.gsd-thinking-picker-item[data-idx="${activeIndex}"]`) as HTMLElement | null;
  if (initialActive) initialActive.focus();
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
