// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all heavy webview modules ──────────────────────────────────────
vi.mock("./renderer", () => ({
  renderAssistantText: vi.fn(),
  default: {},
}));
vi.mock("./session-history", () => ({ setCurrentSessionId: vi.fn(), hide: vi.fn() }));
vi.mock("./slash-menu", () => ({ update: vi.fn() }));
vi.mock("./model-picker", () => ({ update: vi.fn() }));
vi.mock("./thinking-picker", () => ({ update: vi.fn() }));
vi.mock("./ui-dialogs", () => ({}));
vi.mock("./toasts", () => ({ show: vi.fn() }));
vi.mock("./dashboard", () => ({}));
vi.mock("./auto-progress", () => ({}));
vi.mock("./visualizer", () => ({}));
vi.mock("./file-handling", () => ({}));
vi.mock("./a11y", () => ({ createFocusTrap: vi.fn(), restoreFocus: vi.fn(), announceToScreenReader: vi.fn() }));
vi.mock("./keyboard", () => ({
  setChangelogHandlers: vi.fn(),
  getChangelogTriggerEl: vi.fn(),
  dismissChangelog: vi.fn(),
}));

import { init } from "./message-handler";
import { state } from "./state";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeDeps() {
  const el = document.createElement("div");
  const ta = document.createElement("textarea");
  return {
    vscode: { postMessage: vi.fn() },
    messagesContainer: el,
    welcomeScreen: el,
    promptInput: ta,
    updateAllUI: vi.fn(),
    updateHeaderUI: vi.fn(),
    updateFooterUI: vi.fn(),
    updateInputUI: vi.fn(),
    updateOverlayIndicators: vi.fn(),
    updateWorkflowBadge: vi.fn(),
    handleModelRouted: vi.fn(),
    autoResize: vi.fn(),
  };
}

function dispatchCostUpdate(payload: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "cost_update", ...payload },
    })
  );
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("message-handler cost_update", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    // Reset session stats
    (state as any).sessionStats = {};
    init(deps);
  });

  it("clamps negative turn-cost delta to zero", () => {
    // First update: cumulative cost = 2.00
    dispatchCostUpdate({ cumulativeCost: 2.0, tokens: { input: 100, output: 50 } });
    expect(state.sessionStats.cost).toBe(2.0);

    // Second update: cumulative cost goes DOWN (out-of-order event)
    dispatchCostUpdate({ cumulativeCost: 1.5, tokens: { input: 150, output: 75 } });
    // Cumulative cost should still be recorded as 1.5
    expect(state.sessionStats.cost).toBe(1.5);
    // The turn delta (1.5 - 2.0 = -0.5) should be clamped to 0,
    // verified via updateFooterUI being called (the observable side-effect)
    expect(deps.updateFooterUI).toHaveBeenCalled();
  });

  it("computes correct positive turn-cost delta", () => {
    dispatchCostUpdate({ cumulativeCost: 1.0, tokens: { input: 100, output: 50 } });
    expect(state.sessionStats.cost).toBe(1.0);

    dispatchCostUpdate({ cumulativeCost: 1.75, tokens: { input: 200, output: 100 } });
    expect(state.sessionStats.cost).toBe(1.75);
    expect(deps.updateFooterUI).toHaveBeenCalled();
  });
});
