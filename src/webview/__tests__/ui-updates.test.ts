// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  init,
  updateHeaderUI,
  updateFooterUI,
  updateInputUI,
  updateOverlayIndicators,
  updateWorkflowBadge,
  handleModelRouted,
  updateAllUI,
} from "../ui-updates";
import { state } from "../state";
import type { UIUpdatesDeps } from "../ui-updates";

// Mock dashboard — updateAllUI calls dashboard.updateWelcomeScreen
vi.mock("../dashboard", () => ({
  updateWelcomeScreen: vi.fn(),
}));

// Mock helpers — return predictable strings
vi.mock("../helpers", () => ({
  escapeHtml: (s: string) => s,
  formatCost: (c: number) => `$${c.toFixed(2)}`,
  formatTokens: (n: number) => `${n}`,
  formatContextUsage: (stats: any, model: any) => {
    if (stats.contextPercent != null && stats.contextPercent > 0) {
      return `${stats.contextPercent}%`;
    }
    return "";
  },
}));

// ============================================================
// Helpers
// ============================================================

let deps: UIUpdatesDeps;
let mockVscode: { postMessage: ReturnType<typeof vi.fn> };

function createDeps(): UIUpdatesDeps {
  mockVscode = { postMessage: vi.fn() };
  return {
    vscode: mockVscode,
    modelBadge: document.createElement("span"),
    thinkingBadge: document.createElement("span"),
    headerSep1: document.createElement("span"),
    costBadge: document.createElement("span"),
    contextBadge: document.createElement("span"),
    contextBarContainer: document.createElement("div"),
    contextBar: document.createElement("div"),
    footerCwd: document.createElement("span"),
    footerStats: document.createElement("span"),
    footerRight: document.createElement("span"),
    sendBtn: document.createElement("button"),
    sendIcon: document.createElement("span"),
    promptInput: document.createElement("textarea") as HTMLTextAreaElement,
    inputHint: document.createElement("span"),
    overlayIndicators: document.createElement("div"),
  };
}

function resetState(): void {
  state.model = null;
  state.thinkingLevel = "off";
  state.isStreaming = false;
  state.isCompacting = false;
  state.isRetrying = false;
  state.retryInfo = undefined;
  state.processStatus = "stopped";
  state.processHealth = "responsive";
  state.sessionStats = {};
  state.cwd = "";
  state.useCtrlEnterToSend = false;
  state.availableModels = [];
  state.modelsLoaded = false;
}

// ============================================================
// Tests
// ============================================================

describe("ui-updates", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    deps = createDeps();
    // Append overlayIndicators so getElementById can find rendered buttons
    document.body.appendChild(deps.overlayIndicators);
    init(deps);
  });

  // ----------------------------------------------------------
  // updateHeaderUI
  // ----------------------------------------------------------

  describe("updateHeaderUI", () => {
    it("shows model badge when model is set", () => {
      state.model = { id: "claude-3", name: "Claude 3", provider: "anthropic" };
      updateHeaderUI();
      expect(deps.modelBadge.textContent).toBe("Claude 3");
      expect(deps.modelBadge.style.display).toBe("inline-flex");
    });

    it("hides model badge when model is null", () => {
      state.model = null;
      updateHeaderUI();
      expect(deps.modelBadge.style.display).toBe("none");
    });

    it("uses model id as fallback when name is empty", () => {
      state.model = { id: "gpt-4o", name: "", provider: "openai" };
      updateHeaderUI();
      // || short-circuit: empty string is falsy, falls through to id
      expect(deps.modelBadge.textContent).toBe("gpt-4o");
    });

    it("shows thinking badge with level when set", () => {
      state.model = { id: "claude-3", name: "Claude 3", provider: "anthropic" };
      state.thinkingLevel = "high";
      state.availableModels = [{ id: "claude-3", name: "Claude 3", provider: "anthropic", reasoning: true }];
      state.modelsLoaded = true;
      updateHeaderUI();
      expect(deps.thinkingBadge.textContent).toBe("🧠 high");
      expect(deps.thinkingBadge.classList.contains("disabled")).toBe(false);
    });

    it("shows thinking badge as N/A for non-reasoning model", () => {
      state.model = { id: "gpt-4o", name: "GPT-4o", provider: "openai" };
      state.availableModels = [{ id: "gpt-4o", name: "GPT-4o", provider: "openai", reasoning: false }];
      state.modelsLoaded = true;
      updateHeaderUI();
      expect(deps.thinkingBadge.textContent).toBe("🧠 N/A");
      expect(deps.thinkingBadge.classList.contains("disabled")).toBe(true);
    });

    it("shows cost badge when session has cost", () => {
      state.model = { id: "x", name: "X", provider: "p" };
      state.sessionStats = { cost: 1.5 };
      updateHeaderUI();
      expect(deps.costBadge.textContent).toBe("$1.50");
      expect(deps.costBadge.style.display).toBe("inline-flex");
    });

    it("hides cost badge when cost is zero", () => {
      state.model = { id: "x", name: "X", provider: "p" };
      state.sessionStats = { cost: 0 };
      updateHeaderUI();
      expect(deps.costBadge.style.display).toBe("none");
    });

    it("shows context badge with warn class above 70%", () => {
      state.model = { id: "x", name: "X", provider: "p" };
      state.sessionStats = { contextPercent: 75 };
      updateHeaderUI();
      expect(deps.contextBadge.style.display).toBe("inline-flex");
      expect(deps.contextBadge.classList.contains("warn")).toBe(true);
      expect(deps.contextBadge.classList.contains("crit")).toBe(false);
    });

    it("shows context badge with crit class above 90%", () => {
      state.model = { id: "x", name: "X", provider: "p" };
      state.sessionStats = { contextPercent: 95 };
      updateHeaderUI();
      expect(deps.contextBadge.classList.contains("crit")).toBe(true);
    });

    it("shows separator only when both left and right badge groups visible", () => {
      state.model = { id: "x", name: "X", provider: "p" };
      state.sessionStats = { cost: 2 };
      updateHeaderUI();
      // model badge visible (left), cost badge visible (right) → sep visible
      expect(deps.headerSep1.style.display).toBe("block");
    });
  });

  // ----------------------------------------------------------
  // updateFooterUI
  // ----------------------------------------------------------

  describe("updateFooterUI", () => {
    it("sets cwd text", () => {
      state.cwd = "/home/user/project";
      updateFooterUI();
      expect(deps.footerCwd.textContent).toBe("/home/user/project");
    });

    it("shows token stats in footer", () => {
      state.sessionStats = { tokens: { input: 1000, output: 500 } } as any;
      updateFooterUI();
      expect(deps.footerStats.textContent).toContain("in:1000");
      expect(deps.footerStats.textContent).toContain("out:500");
    });

    it("shows model and thinking level in footer right", () => {
      state.model = { id: "claude-3", name: "Claude 3", provider: "anthropic" };
      state.thinkingLevel = "medium";
      updateFooterUI();
      expect(deps.footerRight.textContent).toContain("claude-3");
      expect(deps.footerRight.textContent).toContain("medium");
    });

    it("shows 'thinking off' when thinking level is off", () => {
      state.model = { id: "gpt-4o", name: "GPT-4o", provider: "openai" };
      state.thinkingLevel = "off";
      updateFooterUI();
      expect(deps.footerRight.textContent).toContain("thinking off");
    });
  });

  // ----------------------------------------------------------
  // updateInputUI
  // ----------------------------------------------------------

  describe("updateInputUI", () => {
    it("shows stop icon when streaming", () => {
      state.isStreaming = true;
      updateInputUI();
      expect(deps.sendIcon.textContent).toBe("■");
      expect(deps.sendBtn.classList.contains("gsd-stop-btn")).toBe(true);
      expect(deps.promptInput.placeholder).toContain("Interrupt");
    });

    it("shows send icon when not streaming", () => {
      state.isStreaming = false;
      updateInputUI();
      expect(deps.sendIcon.textContent).toBe("↑");
      expect(deps.sendBtn.classList.contains("gsd-stop-btn")).toBe(false);
      expect(deps.promptInput.placeholder).toBe("Message GSD...");
    });

    it("shows Ctrl+Enter hint when useCtrlEnterToSend is true", () => {
      state.useCtrlEnterToSend = true;
      state.isStreaming = false;
      updateInputUI();
      expect(deps.inputHint.textContent).toContain("Ctrl+Enter");
    });
  });

  // ----------------------------------------------------------
  // updateOverlayIndicators
  // ----------------------------------------------------------

  describe("updateOverlayIndicators", () => {
    it("shows compacting indicator", () => {
      state.isCompacting = true;
      updateOverlayIndicators();
      expect(deps.overlayIndicators.innerHTML).toContain("Compacting context");
      expect(deps.overlayIndicators.style.display).toBe("flex");
    });

    it("shows retry indicator with attempt info", () => {
      state.isRetrying = true;
      state.retryInfo = { attempt: 2, maxAttempts: 3, errorMessage: "rate limited" };
      updateOverlayIndicators();
      expect(deps.overlayIndicators.innerHTML).toContain("2/3");
      expect(deps.overlayIndicators.innerHTML).toContain("rate limited");
    });

    it("shows crashed indicator with restart button", () => {
      state.processStatus = "crashed";
      updateOverlayIndicators();
      expect(deps.overlayIndicators.innerHTML).toContain("not running");
      expect(deps.overlayIndicators.querySelector("#restartBtn")).toBeTruthy();
    });

    it("shows unresponsive indicator with force buttons", () => {
      state.processHealth = "unresponsive";
      updateOverlayIndicators();
      expect(deps.overlayIndicators.innerHTML).toContain("unresponsive");
      const forceRestart = deps.overlayIndicators.querySelector("#forceRestartBtn");
      expect(forceRestart).toBeTruthy();
    });

    it("hides indicators when nothing active", () => {
      updateOverlayIndicators();
      expect(deps.overlayIndicators.style.display).toBe("none");
    });

    it("force restart button sends message and updates state", () => {
      state.processHealth = "unresponsive";
      updateOverlayIndicators();
      const btn = document.getElementById("forceRestartBtn") as HTMLElement;
      btn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "force_restart" });
      expect(state.processHealth).toBe("responsive");
      expect(state.processStatus).toBe("restarting");
    });
  });

  // ----------------------------------------------------------
  // updateWorkflowBadge
  // ----------------------------------------------------------

  describe("updateWorkflowBadge", () => {
    let badge: HTMLElement;

    beforeEach(() => {
      badge = document.createElement("span");
      badge.id = "workflowBadge";
      document.body.appendChild(badge);
    });

    it("shows 'Self-directed' when workflow is null", () => {
      updateWorkflowBadge(null);
      expect(badge.textContent).toBe("Self-directed");
    });

    it("shows milestone/slice/task breadcrumb", () => {
      updateWorkflowBadge({
        phase: "executing",
        milestone: { id: "M001" },
        slice: { id: "S02" },
        task: { id: "T03" },
      } as any);
      expect(badge.textContent).toContain("M001 › S02 › T03");
      expect(badge.textContent).toContain("Executing");
    });

    it("adds auto-mode prefix", () => {
      updateWorkflowBadge({
        phase: "executing",
        autoMode: "auto",
        milestone: { id: "M001" },
      } as any);
      expect(badge.textContent).toContain("⚡");
    });

    it("adds complete checkmark", () => {
      updateWorkflowBadge({
        phase: "complete",
        milestone: { id: "M001" },
      } as any);
      expect(badge.textContent).toContain("✓");
      expect(badge.className).toContain("complete");
    });
  });

  // ----------------------------------------------------------
  // handleModelRouted
  // ----------------------------------------------------------

  describe("handleModelRouted", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("updates state.model and header on routing", () => {
      state.availableModels = [
        { id: "claude-3-5", name: "Claude 3.5 Sonnet", provider: "anthropic", reasoning: true },
      ];
      handleModelRouted(null, { id: "claude-3-5", provider: "anthropic" });
      expect(state.model?.id).toBe("claude-3-5");
      expect(state.model?.name).toBe("Claude 3.5 Sonnet");
      expect(deps.modelBadge.textContent).toBe("Claude 3.5 Sonnet");
    });

    it("flashes model badge on routing and removes after timeout", () => {
      state.availableModels = [];
      handleModelRouted(null, { id: "gpt-4o", provider: "openai" });
      expect(deps.modelBadge.classList.contains("gsd-model-badge-flash")).toBe(true);
      vi.advanceTimersByTime(1500);
      expect(deps.modelBadge.classList.contains("gsd-model-badge-flash")).toBe(false);
    });

    it("falls back to id when model not in availableModels", () => {
      state.availableModels = [];
      handleModelRouted(null, { id: "unknown-model", provider: "test" });
      expect(state.model?.name).toBe("unknown-model");
    });
  });
});
