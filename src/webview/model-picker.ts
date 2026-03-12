// ============================================================
// Model Picker — overlay for switching AI models
// ============================================================

import { state, type AvailableModel } from "./state";
import { escapeHtml, escapeAttr, formatTokens } from "./helpers";

// ============================================================
// Module state
// ============================================================

let visible = false;

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
  visible = true;
  render();
}

export function hide(): void {
  visible = false;
  pickerEl.style.display = "none";
  pickerEl.innerHTML = "";
}

export function render(): void {
  if (!visible) return;

  const models = state.availableModels;
  const currentId = state.model?.id;
  const currentProvider = state.model?.provider;

  if (models.length === 0) {
    pickerEl.style.display = "block";
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
    <span class="gsd-model-picker-title">Select Model</span>
    <button class="gsd-model-picker-close" id="modelPickerClose">✕</button>
  </div>`;

  for (const [provider, providerModels] of byProvider) {
    html += `<div class="gsd-model-picker-group">
      <div class="gsd-model-picker-provider">${escapeHtml(provider)}</div>`;
    for (const m of providerModels) {
      const isCurrent = m.id === currentId && m.provider === currentProvider;
      const ctxStr = m.contextWindow ? formatTokens(m.contextWindow) : "";
      const reasoningTag = m.reasoning ? `<span class="gsd-model-tag reasoning">reasoning</span>` : "";
      html += `<div class="gsd-model-picker-item ${isCurrent ? "current" : ""}" 
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
    }
    html += `</div>`;
  }

  pickerEl.style.display = "block";
  pickerEl.innerHTML = html;

  pickerEl.querySelector("#modelPickerClose")?.addEventListener("click", hide);
  pickerEl.querySelectorAll(".gsd-model-picker-item").forEach((el) => {
    el.addEventListener("click", () => {
      const provider = (el as HTMLElement).dataset.provider!;
      const modelId = (el as HTMLElement).dataset.modelId!;
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
    });
  });
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
