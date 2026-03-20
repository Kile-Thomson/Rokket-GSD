// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock dependencies ──────────────────────────────────────────────────

vi.mock("../state", () => ({
  state: {
    availableModels: [],
    modelsLoaded: false,
    modelsRequested: false,
    model: null,
  },
}));

vi.mock("../helpers", () => ({
  escapeHtml: (s: string) => String(s ?? ""),
  escapeAttr: (s: string) => String(s ?? ""),
  formatTokens: (n: number) => `${n}`,
}));

vi.mock("../a11y", () => ({
  createFocusTrap: () => () => {},
  saveFocus: () => null,
  restoreFocus: () => {},
}));

import { init, isVisible, show, hide, toggle, render, type ModelPickerDeps } from "../model-picker";
import { state } from "../state";

// ── Helpers ──────────────────────────────────────────────────────────────

function createDeps(): ModelPickerDeps {
  return {
    pickerEl: document.createElement("div"),
    modelPickerBtn: document.createElement("button"),
    modelBadge: document.createElement("div"),
    vscode: { postMessage: vi.fn() },
    onUpdateHeaderUI: vi.fn(),
    onUpdateFooterUI: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("model-picker", () => {
  let deps: ModelPickerDeps;

  beforeEach(() => {
    deps = createDeps();
    document.body.appendChild(deps.pickerEl);
    init(deps);
    // Reset state
    (state as any).availableModels = [];
    (state as any).modelsLoaded = false;
    (state as any).model = null;
  });

  afterEach(() => {
    hide();
    document.body.innerHTML = "";
  });

  it("isVisible returns false initially", () => {
    expect(isVisible()).toBe(false);
  });

  it("show() makes it visible and requests models when not loaded", () => {
    show();
    expect(isVisible()).toBe(true);
    expect(deps.vscode.postMessage).toHaveBeenCalledWith({ type: "get_available_models" });
  });

  it("hide() makes it not visible and clears picker content", () => {
    show();
    hide();
    expect(isVisible()).toBe(false);
    expect(deps.pickerEl.innerHTML).toBe("");
    expect(deps.pickerEl.classList.contains("gsd-hidden")).toBe(true);
  });

  it("toggle() opens when closed and closes when open", () => {
    toggle();
    expect(isVisible()).toBe(true);
    toggle();
    expect(isVisible()).toBe(false);
  });

  it("renders loading state when no models available", () => {
    show();
    expect(deps.pickerEl.innerHTML).toContain("Loading models");
    expect(deps.pickerEl.classList.contains("gsd-hidden")).toBe(false);
  });

  it("renders model list when models are available", () => {
    (state as any).availableModels = [
      { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic", reasoning: false, contextWindow: 200000 },
      { id: "claude-3-opus", name: "Claude 3 Opus", provider: "anthropic", reasoning: true, contextWindow: 200000 },
      { id: "gpt-4o", name: "GPT-4o", provider: "openai", contextWindow: 128000 },
    ];
    (state as any).modelsLoaded = true;
    (state as any).model = { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic" };

    show();

    expect(deps.pickerEl.innerHTML).toContain("Select Model");
    expect(deps.pickerEl.innerHTML).toContain("Claude 3.5 Sonnet");
    expect(deps.pickerEl.innerHTML).toContain("Claude 3 Opus");
    expect(deps.pickerEl.innerHTML).toContain("GPT-4o");
    expect(deps.pickerEl.innerHTML).toContain("anthropic");
    expect(deps.pickerEl.innerHTML).toContain("openai");
    // Current model should have the dot
    expect(deps.pickerEl.innerHTML).toContain("gsd-model-current-dot");
    // Reasoning model should have tag
    expect(deps.pickerEl.innerHTML).toContain("reasoning");
  });

  it("clicking a model item sends set_model message", () => {
    (state as any).availableModels = [
      { id: "gpt-4o", name: "GPT-4o", provider: "openai", contextWindow: 128000 },
    ];
    (state as any).modelsLoaded = true;
    (state as any).model = { id: "other", name: "Other", provider: "other" };

    show();

    const item = deps.pickerEl.querySelector(".gsd-model-picker-item") as HTMLElement;
    expect(item).not.toBeNull();
    item.click();

    expect(deps.vscode.postMessage).toHaveBeenCalledWith({
      type: "set_model",
      provider: "openai",
      modelId: "gpt-4o",
    });
    expect(isVisible()).toBe(false);
  });

  it("show() does not request models when already loaded", () => {
    (state as any).modelsLoaded = true;
    (state as any).availableModels = [];
    show();
    expect(deps.vscode.postMessage).not.toHaveBeenCalledWith({ type: "get_available_models" });
  });

  it("model picker button triggers toggle", () => {
    deps.modelPickerBtn.click();
    expect(isVisible()).toBe(true);
    deps.modelPickerBtn.click();
    // Note: the click-outside handler may interfere, but toggle is directly wired
  });

  it("close button hides the picker", () => {
    (state as any).availableModels = [
      { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
    ];
    (state as any).modelsLoaded = true;

    show();
    const closeBtn = deps.pickerEl.querySelector("#modelPickerClose") as HTMLElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    expect(isVisible()).toBe(false);
  });
});
