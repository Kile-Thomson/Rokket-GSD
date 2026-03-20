// ============================================================
// Model Picker — overlay for switching AI models
// ============================================================

import { state, type AvailableModel } from "./state";
import { escapeHtml, escapeAttr, formatTokens } from "./helpers";
import { createFocusTrap, saveFocus, restoreFocus } from "./a11y";

// ============================================================
// Module state
// ============================================================

let visible = false;
let triggerEl: HTMLElement | null = null;
let activeIndex = -1;
let focusTrapHandler: ((e: KeyboardEvent) => void) | null = null;

// ============================================================
// Dependencies injected via init()
// ============================================================

let pickerEl: HTMLElement;
let vscode: { postMessage(msg: unknown): void };
let onUpdateHeaderUI: () => void;
let onUpdateFooterUI: () => void;

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
  if (!state.modelsLoaded) {
    vscode.postMessage({ type: "get_available_models" });
  }
  triggerEl = saveFocus();
  visible = true;
  activeIndex = -1;
  render();
}

export function hide(): void {
  visible = false;
  if (focusTrapHandler) {
    pickerEl.removeEventListener("keydown", focusTrapHandler);
    focusTrapHandler = null;
  }
  pickerEl.classList.add("gsd-hidden");
  pickerEl.innerHTML = "";
  restoreFocus(triggerEl);
  triggerEl = null;
}

export function render(): void {
  if (!visible) return;

  const models = state.availableModels;
  const currentId = state.model?.id;
  const currentProvider = state.model?.provider;

  if (models.length === 0) {
    pickerEl.classList.remove("gsd-hidden");
    pickerEl.innerHTML = `<div class="gsd-model-picker-loading">
      <span class="gsd-tool-spinner"></span> Loading models…
    </div>`;
    return;
  }

  const byProvider = new Map<string, AvailableModel[]>();
  for (const m of models) {
    const list = byProvider.get(m.provider) || [];
    list.push(m);
    byProvider.set(m.provider, list);
  }

  let html = `<div class="gsd-model-picker-header">
    <span class="gsd-model-picker-title" id="modelPickerTitle">Select Model</span>
    <button class="gsd-model-picker-close" id="modelPickerClose" aria-label="Close model picker">✕</button>
  </div>`;

  // Flatten models for arrow key indexing
  const allModels: AvailableModel[] = [];
  for (const [, providerModels] of byProvider) {
    allModels.push(...providerModels);
  }
  // Set initial activeIndex to current model if not yet set
  if (activeIndex < 0) {
    activeIndex = allModels.findIndex(m => m.id === currentId && m.provider === currentProvider);
    if (activeIndex < 0) activeIndex = 0;
  }
  let flatIdx = 0;

  for (const [provider, providerModels] of byProvider) {
    html += `<div class="gsd-model-picker-group" role="group" aria-label="${escapeAttr(provider)}">
      <div class="gsd-model-picker-provider">${escapeHtml(provider)}</div>
      <div role="listbox" aria-labelledby="modelPickerTitle">`;
    for (const m of providerModels) {
      const isCurrent = m.id === currentId && m.provider === currentProvider;
      const isActive = flatIdx === activeIndex;
      const ctxStr = m.contextWindow ? formatTokens(m.contextWindow) : "";
      const reasoningTag = m.reasoning ? `<span class="gsd-model-tag reasoning">reasoning</span>` : "";
      html += `<div class="gsd-model-picker-item ${isCurrent ? "current" : ""} ${isActive ? "active" : ""}" 
                    role="option"
                    aria-selected="${isCurrent}"
                    tabindex="${isActive ? "0" : "-1"}"
                    data-flat-idx="${flatIdx}"
                    data-provider="${escapeAttr(m.provider)}" 
                    data-model-id="${escapeAttr(m.id)}">
        <div class="gsd-model-picker-name">
          ${isCurrent ? '<span class="gsd-model-current-dot">●</span>' : ""}
          ${escapeHtml(m.name || m.id)}
        </div>
        <div class="gsd-model-picker-meta">
          ${ctxStr ? `<span class="gsd-model-ctx">${ctxStr} ctx</span>` : ""}
          ${reasoningTag}
        </div>
      </div>`;
      flatIdx++;
    }
    html += `</div></div>`;
  }

  pickerEl.classList.remove("gsd-hidden");
  pickerEl.innerHTML = html;

  // Attach focus trap (remove old one first to avoid duplicates on re-render)
  if (focusTrapHandler) {
    pickerEl.removeEventListener("keydown", focusTrapHandler);
  }
  focusTrapHandler = createFocusTrap(pickerEl);
  pickerEl.addEventListener("keydown", focusTrapHandler);

  pickerEl.querySelector("#modelPickerClose")?.addEventListener("click", hide);

  const items = pickerEl.querySelectorAll(".gsd-model-picker-item");
  const totalItems = items.length;

  function selectItem(el: HTMLElement): void {
    const provider = el.dataset.provider!;
    const modelId = el.dataset.modelId!;
    vscode.postMessage({ type: "set_model", provider, modelId });
    hide();
    if (state.model) {
      state.model.id = modelId;
      state.model.provider = provider;
      const m = state.availableModels.find((m) => m.id === modelId && m.provider === provider);
      if (m) {
        state.model.name = m.name || m.id;
        state.model.contextWindow = m.contextWindow;
      }
    }
    onUpdateHeaderUI();
    onUpdateFooterUI();
    setTimeout(() => vscode.postMessage({ type: "get_state" }), 500);
  }

  items.forEach((el) => {
    el.addEventListener("click", () => selectItem(el as HTMLElement));
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
      const active = pickerEl.querySelector(`.gsd-model-picker-item[data-flat-idx="${activeIndex}"]`) as HTMLElement | null;
      if (active) selectItem(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
  });

  function focusActiveItem(): void {
    items.forEach((el, i) => {
      (el as HTMLElement).tabIndex = i === activeIndex ? 0 : -1;
      if (i === activeIndex) {
        (el as HTMLElement).classList.add("active");
        (el as HTMLElement).focus();
        (el as HTMLElement).scrollIntoView({ block: "nearest" });
      } else {
        (el as HTMLElement).classList.remove("active");
      }
    });
  }

  // Focus first active item on show
  const initialActive = pickerEl.querySelector(`.gsd-model-picker-item[data-flat-idx="${activeIndex}"]`) as HTMLElement | null;
  if (initialActive) initialActive.focus();
}

// ============================================================
// Init
// ============================================================

export interface ModelPickerDeps {
  pickerEl: HTMLElement;
  modelPickerBtn: HTMLElement;
  modelBadge: HTMLElement;
  vscode: { postMessage(msg: unknown): void };
  onUpdateHeaderUI: () => void;
  onUpdateFooterUI: () => void;
}

export function init(deps: ModelPickerDeps): void {
  pickerEl = deps.pickerEl;
  vscode = deps.vscode;
  onUpdateHeaderUI = deps.onUpdateHeaderUI;
  onUpdateFooterUI = deps.onUpdateFooterUI;

  // Wire up click handlers
  deps.modelPickerBtn.addEventListener("click", toggle);
  deps.modelBadge.addEventListener("click", toggle);
  deps.modelBadge.style.cursor = "pointer";

  // Click-outside to close
  document.addEventListener("click", (e: Event) => {
    if (visible) {
      const target = e.target as HTMLElement;
      if (!pickerEl.contains(target) && target !== deps.modelPickerBtn && !deps.modelPickerBtn.contains(target) && target !== deps.modelBadge) {
        hide();
      }
    }
  });
}
