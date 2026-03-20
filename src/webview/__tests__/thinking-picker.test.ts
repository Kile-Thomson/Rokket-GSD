// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock dependencies ──────────────────────────────────────────────────

vi.mock("../state", () => ({
  state: {
    model: null,
    thinkingLevel: "off",
    modelsLoaded: false,
    availableModels: [],
  },
}));

vi.mock("../helpers", () => ({
  escapeHtml: (s: string) => String(s ?? ""),
}));

vi.mock("../a11y", () => ({
  createFocusTrap: () => () => {},
  saveFocus: () => null,
  restoreFocus: () => {},
}));

import { init, isVisible, show, hide, toggle, refresh, type ThinkingPickerDeps } from "../thinking-picker";
import { state } from "../state";

// ── Helpers ──────────────────────────────────────────────────────────────

function createDeps(): ThinkingPickerDeps {
  const pickerEl = document.createElement("div");
  // Need offsetParent for position calculations — attach to body
  document.body.appendChild(pickerEl);
  return {
    pickerEl,
    thinkingBadge: document.createElement("div"),
    vscode: { postMessage: vi.fn() },
    onThinkingChanged: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("thinking-picker", () => {
  let deps: ThinkingPickerDeps;

  beforeEach(() => {
    deps = createDeps();
    init(deps);
    // Reset state
    (state as any).model = { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic" };
    (state as any).thinkingLevel = "off";
    (state as any).modelsLoaded = true;
    (state as any).availableModels = [
      { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic", reasoning: true },
    ];
  });

  afterEach(() => {
    hide();
    document.body.innerHTML = "";
  });

  it("isVisible returns false initially", () => {
    expect(isVisible()).toBe(false);
  });

  it("show() makes it visible when model supports reasoning", () => {
    show();
    expect(isVisible()).toBe(true);
  });

  it("show() does nothing when model is null", () => {
    (state as any).model = null;
    show();
    expect(isVisible()).toBe(false);
  });

  it("show() does nothing when model does not support reasoning", () => {
    (state as any).availableModels = [
      { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic", reasoning: false },
    ];
    show();
    expect(isVisible()).toBe(false);
  });

  it("hide() clears picker content and marks hidden", () => {
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

  it("renders all standard thinking levels (excluding xhigh for non-Opus 4.6)", () => {
    show();

    expect(deps.pickerEl.innerHTML).toContain("Thinking Level");
    expect(deps.pickerEl.innerHTML).toContain("Off");
    expect(deps.pickerEl.innerHTML).toContain("Minimal");
    expect(deps.pickerEl.innerHTML).toContain("Low");
    expect(deps.pickerEl.innerHTML).toContain("Medium");
    expect(deps.pickerEl.innerHTML).toContain("High");
    // xhigh should NOT be shown for non-Opus 4.6
    expect(deps.pickerEl.innerHTML).not.toContain("Max");
  });

  it("renders xhigh option for Opus 4.6 models", () => {
    (state as any).model = { id: "claude-opus-4.6", name: "Opus 4.6", provider: "anthropic" };
    (state as any).availableModels = [
      { id: "claude-opus-4.6", name: "Opus 4.6", provider: "anthropic", reasoning: true },
    ];

    show();
    expect(deps.pickerEl.innerHTML).toContain("Max");
  });

  it("clicking a level sends set_thinking_level message", () => {
    (state as any).thinkingLevel = "off";
    show();

    // Click the "High" option
    const items = deps.pickerEl.querySelectorAll(".gsd-thinking-picker-item");
    const highItem = Array.from(items).find(el => el.getAttribute("data-level") === "high") as HTMLElement;
    expect(highItem).not.toBeNull();
    highItem!.click();

    expect(deps.vscode.postMessage).toHaveBeenCalledWith({
      type: "set_thinking_level",
      level: "high",
    });
    expect(deps.onThinkingChanged).toHaveBeenCalled();
    expect(isVisible()).toBe(false);
  });

  it("clicking the current level just hides without sending message", () => {
    (state as any).thinkingLevel = "medium";
    show();

    const items = deps.pickerEl.querySelectorAll(".gsd-thinking-picker-item");
    const mediumItem = Array.from(items).find(el => el.getAttribute("data-level") === "medium") as HTMLElement;
    mediumItem!.click();

    // Should NOT send set_thinking_level
    expect(deps.vscode.postMessage).not.toHaveBeenCalled();
    expect(isVisible()).toBe(false);
  });

  it("close button hides the picker", () => {
    show();
    const closeBtn = deps.pickerEl.querySelector("#thinkingPickerClose") as HTMLElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    expect(isVisible()).toBe(false);
  });

  it("refresh re-renders when visible", () => {
    show();
    (state as any).thinkingLevel = "high";
    refresh();
    // Should show "high" as the active item
    const items = deps.pickerEl.querySelectorAll(".gsd-thinking-picker-item");
    const highItem = Array.from(items).find(el => el.getAttribute("data-level") === "high") as HTMLElement;
    expect(highItem?.classList.contains("active")).toBe(true);
  });

  it("refresh does nothing when not visible", () => {
    // Not visible, no error
    refresh();
    expect(deps.pickerEl.innerHTML).toBe("");
  });

  it("shows only 'off' when model does not support reasoning (modelsLoaded=true)", () => {
    (state as any).model = { id: "gpt-3.5", name: "GPT-3.5", provider: "openai" };
    (state as any).availableModels = [
      { id: "gpt-3.5", name: "GPT-3.5", provider: "openai", reasoning: false },
    ];
    // show() should bail out because model doesn't support reasoning
    show();
    expect(isVisible()).toBe(false);
  });

  it("defaults to showing dropdown when models not loaded yet", () => {
    (state as any).modelsLoaded = false;
    (state as any).availableModels = [];

    show();
    expect(isVisible()).toBe(true);
    // Should show all standard levels
    expect(deps.pickerEl.innerHTML).toContain("High");
  });

  it("thinking badge click triggers toggle", () => {
    deps.thinkingBadge.click();
    expect(isVisible()).toBe(true);
  });
});
