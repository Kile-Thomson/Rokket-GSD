// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { state } from "../../state";

vi.mock("../../renderer", () => ({
  resetStreamingState: vi.fn(),
  ensureCurrentTurnElement: vi.fn(() => document.createElement("div")),
  appendToTextSegment: vi.fn(),
  appendToolSegmentElement: vi.fn(),
  updateToolSegmentElement: vi.fn(),
  finalizeCurrentTurn: vi.fn(),
  clearMessages: vi.fn(),
  renderNewEntry: vi.fn(),
  createParallelBatch: vi.fn(),
  expandParallelBatch: vi.fn(),
  syncBatchState: vi.fn(),
  updateParallelBatchStatus: vi.fn(),
  finalizeParallelBatch: vi.fn(),
  clearActiveBatch: vi.fn(),
  getActiveBatchElement: vi.fn(() => null),
  sealActiveBatch: vi.fn(() => null),
  tickSealedBatches: vi.fn(),
  isInSealedBatch: vi.fn(() => false),
  isInCompletedBatch: vi.fn(() => false),
  finalizeAllSealedBatches: vi.fn(),
  clearFinalizedBatch: vi.fn(),
  disbandActiveBatch: vi.fn(),
  unsealBatchesOverlapping: vi.fn(),
  disbandOrphanedBatches: vi.fn(),
  getSealedBatchCount: vi.fn(() => 0),
  reopenParallelBatch: vi.fn(),
  appendServerToolSegment: vi.fn(),
  completeServerToolSegment: vi.fn(),
  reattachTurnElement: vi.fn(),
  patchToolBlock: vi.fn(),
  init: vi.fn(),
}));

vi.mock("../../session-history", () => ({
  setCurrentSessionId: vi.fn(),
  updateSessions: vi.fn(),
  showError: vi.fn(),
  hide: vi.fn(),
}));

vi.mock("../../slash-menu", () => ({
  isVisible: vi.fn(() => false),
  show: vi.fn(),
}));

vi.mock("../../model-picker", () => ({
  isVisible: vi.fn(() => false),
  render: vi.fn(),
}));

vi.mock("../../thinking-picker", () => ({
  refresh: vi.fn(),
}));

vi.mock("../../ui-dialogs", () => ({
  hasPending: vi.fn(() => false),
  expireAllPending: vi.fn(),
  handleRequest: vi.fn(),
}));

vi.mock("../../toasts", () => ({
  show: vi.fn(),
}));

vi.mock("../../dashboard", () => ({
  renderDashboard: vi.fn(),
  updateWelcomeScreen: vi.fn(),
}));

vi.mock("../../auto-progress", () => ({
  update: vi.fn(),
}));

vi.mock("../../visualizer", () => ({
  isVisible: vi.fn(() => false),
  updateData: vi.fn(),
}));

vi.mock("../../file-handling", () => ({
  addFileAttachments: vi.fn(),
}));

vi.mock("../../helpers", () => ({
  escapeHtml: (s: string) => s,
  formatMarkdownNotes: (s: string) => s,
  formatShortDate: (s: string) => s,
  scrollToBottom: vi.fn(),
}));

vi.mock("../../keyboard", () => ({
  setChangelogHandlers: vi.fn(),
  getChangelogTriggerEl: vi.fn(() => null),
  dismissChangelog: vi.fn(),
}));

vi.mock("../../a11y", () => ({
  createFocusTrap: vi.fn(() => vi.fn()),
  saveFocus: vi.fn(() => null),
  restoreFocus: vi.fn(),
  announceToScreenReader: vi.fn(),
}));

import { init } from "../../message-handler";
import * as dashboard from "../../dashboard";
import * as toasts from "../../toasts";
import * as thinkingPicker from "../../thinking-picker";

let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;
let promptInput: HTMLTextAreaElement;
let mockVscode: { postMessage: ReturnType<typeof vi.fn> };
let mockUpdateAllUI: ReturnType<typeof vi.fn>;
let mockUpdateHeaderUI: ReturnType<typeof vi.fn>;
let mockUpdateFooterUI: ReturnType<typeof vi.fn>;
let mockUpdateInputUI: ReturnType<typeof vi.fn>;
let mockUpdateOverlayIndicators: ReturnType<typeof vi.fn>;
let mockUpdateWorkflowBadge: ReturnType<typeof vi.fn>;
let mockHandleModelRouted: ReturnType<typeof vi.fn>;
let mockAutoResize: ReturnType<typeof vi.fn>;

function resetState(): void {
  state.entries = [];
  state.currentTurn = null;
  state.isStreaming = false;
  state.isCompacting = false;
  state.isRetrying = false;
  state.model = null;
  state.thinkingLevel = null;
  state.processStatus = "stopped";
  state.processHealth = "responsive";
  state.sessionStats = {};
  state.commands = [];
  state.commandsLoaded = false;
  state.availableModels = [];
  state.modelsLoaded = false;
  state.modelsRequested = false;
}

function sendMessage(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

describe("state-handlers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    messagesContainer = document.createElement("div");
    welcomeScreen = document.createElement("div");
    promptInput = document.createElement("textarea") as HTMLTextAreaElement;
    document.body.appendChild(messagesContainer);
    document.body.appendChild(welcomeScreen);
    document.body.appendChild(promptInput);

    mockVscode = { postMessage: vi.fn() };
    mockUpdateAllUI = vi.fn();
    mockUpdateHeaderUI = vi.fn();
    mockUpdateFooterUI = vi.fn();
    mockUpdateInputUI = vi.fn();
    mockUpdateOverlayIndicators = vi.fn();
    mockUpdateWorkflowBadge = vi.fn();
    mockHandleModelRouted = vi.fn();
    mockAutoResize = vi.fn();

    resetState();
    vi.clearAllMocks();

    init({
      vscode: mockVscode,
      messagesContainer,
      welcomeScreen,
      promptInput,
      updateAllUI: mockUpdateAllUI,
      updateHeaderUI: mockUpdateHeaderUI,
      updateFooterUI: mockUpdateFooterUI,
      updateInputUI: mockUpdateInputUI,
      updateOverlayIndicators: mockUpdateOverlayIndicators,
      updateWorkflowBadge: mockUpdateWorkflowBadge,
      handleModelRouted: mockHandleModelRouted,
      autoResize: mockAutoResize,
    });
  });

  afterEach(() => {
    resetState();
  });

  describe("config message", () => {
    it("updates settings from config message", () => {
      sendMessage({ type: "config", useCtrlEnterToSend: true, cwd: "/test", version: "1.0" });
      expect(state.useCtrlEnterToSend).toBe(true);
      expect(state.cwd).toBe("/test");
      expect(state.version).toBe("1.0");
      expect(mockUpdateAllUI).toHaveBeenCalled();
    });

    it("updates extensionVersion and header element", () => {
      const headerVer = document.createElement("span");
      headerVer.id = "headerVersion";
      document.body.appendChild(headerVer);
      sendMessage({ type: "config", extensionVersion: "2.0.0" });
      expect(state.extensionVersion).toBe("2.0.0");
      expect(headerVer.textContent).toBe("v2.0.0");
    });
  });

  describe("state message", () => {
    it("updates model and streaming state", () => {
      sendMessage({
        type: "state",
        data: {
          model: { id: "claude-3", name: "Claude 3", provider: "anthropic", contextWindow: 200000 },
          isStreaming: true,
          thinkingLevel: "medium",
        },
      });
      expect(state.model?.id).toBe("claude-3");
      expect(state.isStreaming).toBe(true);
      expect(state.thinkingLevel).toBe("medium");
    });

    it("sets processStatus to running", () => {
      state.processStatus = "stopped";
      sendMessage({ type: "state", data: { model: null } });
      expect(state.processStatus).toBe("running");
    });

    it("requests available models if not loaded", () => {
      state.modelsLoaded = false;
      state.modelsRequested = false;
      sendMessage({ type: "state", data: {} });
      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "get_available_models" });
    });
  });

  describe("session_stats message", () => {
    it("applies contextWindow and autoCompactionEnabled from session_stats", () => {
      sendMessage({ type: "session_stats", data: { contextWindow: 1000000, autoCompactionEnabled: true } });
      expect(state.sessionStats.contextWindow).toBe(1000000);
      expect(state.sessionStats.autoCompactionEnabled).toBe(true);
      expect(mockUpdateHeaderUI).toHaveBeenCalled();
      expect(mockUpdateFooterUI).toHaveBeenCalled();
    });

    it("does not overwrite cost or tokens from session_stats", () => {
      state.sessionStats.cost = 0.10;
      sendMessage({ type: "session_stats", data: { cost: 0.05 } });
      expect(state.sessionStats.cost).toBe(0.10);
    });
  });

  describe("cost_update message", () => {
    it("reads tokens from GSD PI nested format (tokens.input)", () => {
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.15,
        tokens: { input: 50000, output: 2000, cacheRead: 30000, cacheWrite: 5000 },
      });
      expect(state.sessionStats.tokens).toEqual({
        input: 50000,
        output: 2000,
        cacheRead: 30000,
        cacheWrite: 5000,
        total: 87000,
      });
      expect(state.sessionStats.cost).toBe(0.15);
    });

    it("handles cost_update with tokens at top level", () => {
      sendMessage({
        type: "cost_update",
        runId: "r1",
        turnCost: 0.20,
        cumulativeCost: 0.20,
        tokens: { input: 60000, output: 3000, cacheRead: 0, cacheWrite: 0 },
      });
      expect(state.sessionStats.tokens?.input).toBe(60000);
      expect(state.sessionStats.tokens?.output).toBe(3000);
      expect(state.sessionStats.cost).toBe(0.20);
    });

    it("computes per-turn deltas from cumulative totals", () => {
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.05,
        tokens: { input: 10000, output: 500, cacheRead: 0, cacheWrite: 0 },
      });
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.12,
        tokens: { input: 25000, output: 1200, cacheRead: 8000, cacheWrite: 0 },
      });
      expect(state.sessionStats.tokens?.input).toBe(25000);
      expect(state.sessionStats.cost).toBe(0.12);
    });

    it("does NOT compute contextPercent from cost_update (deferred to message_end)", () => {
      state.sessionStats.contextWindow = 200_000;
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.05,
        tokens: { input: 30000, output: 1000, cacheRead: 10000, cacheWrite: 5000 },
      });
      expect(state.sessionStats.contextPercent).toBeUndefined();
      expect(state.sessionStats.contextTokens).toBeUndefined();
    });
  });

  describe("process_status message", () => {
    it("updates process status", () => {
      sendMessage({ type: "process_status", status: "running" });
      expect(state.processStatus).toBe("running");
    });

    it("resets commands and streaming when transitioning to running", () => {
      state.processStatus = "stopped";
      state.isStreaming = true;
      state.commandsLoaded = true;
      sendMessage({ type: "process_status", status: "running" });
      expect(state.isStreaming).toBe(false);
      expect(state.commandsLoaded).toBe(false);
      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "get_commands" });
    });
  });

  describe("available_models message", () => {
    it("populates state.availableModels", () => {
      sendMessage({
        type: "available_models",
        models: [{ id: "gpt-4", name: "GPT-4", provider: "openai", reasoning: false, contextWindow: 128000 }],
      });
      expect(state.availableModels.length).toBe(1);
      expect(state.modelsLoaded).toBe(true);
    });

    it("backfills contextWindow on current model when missing", () => {
      state.model = { id: "gpt-4", name: "GPT-4", provider: "openai" };
      expect(state.model.contextWindow).toBeUndefined();
      sendMessage({
        type: "available_models",
        models: [{ id: "gpt-4", name: "GPT-4", provider: "openai", reasoning: false, contextWindow: 128000 }],
      });
      expect(state.model.contextWindow).toBe(128000);
      expect(mockUpdateHeaderUI).toHaveBeenCalled();
      expect(mockUpdateFooterUI).toHaveBeenCalled();
    });

    it("does not overwrite existing contextWindow on current model", () => {
      state.model = { id: "gpt-4", name: "GPT-4", provider: "openai", contextWindow: 200000 };
      sendMessage({
        type: "available_models",
        models: [{ id: "gpt-4", name: "GPT-4", provider: "openai", reasoning: false, contextWindow: 128000 }],
      });
      expect(state.model.contextWindow).toBe(200000);
    });
  });

  describe("thinking_level_changed message", () => {
    it("updates thinking level and refreshes picker", () => {
      sendMessage({ type: "thinking_level_changed", level: "high" });
      expect(state.thinkingLevel).toBe("high");
      expect(thinkingPicker.refresh).toHaveBeenCalled();
      expect(toasts.show).toHaveBeenCalledWith("Thinking: high");
    });
  });

  describe("commands message", () => {
    it("populates state.commands", () => {
      sendMessage({ type: "commands", commands: [{ name: "test", description: "test cmd" }] });
      expect(state.commands.length).toBe(1);
      expect(state.commandsLoaded).toBe(true);
    });
  });

  describe("workflow_state message", () => {
    it("passes state to updateWorkflowBadge", () => {
      const wfState = { milestone: "M001", slice: "S01" };
      sendMessage({ type: "workflow_state", state: wfState });
      expect(mockUpdateWorkflowBadge).toHaveBeenCalledWith(wfState);
    });
  });

  describe("dashboard_data message", () => {
    it("renders dashboard when visualizer is not visible", () => {
      sendMessage({ type: "dashboard_data", data: { milestones: [] } });
      expect(dashboard.renderDashboard).toHaveBeenCalled();
    });
  });

  describe("session_switched message", () => {
    it("resets sessionStats on session switch", () => {
      state.sessionStats = {
        tokens: { input: 50000, output: 2000, cacheRead: 0, cacheWrite: 0, total: 52000 },
        cost: 0.15,
        contextWindow: 200000,
        contextPercent: 25,
        contextTokens: 50000,
      };
      sendMessage({
        type: "session_switched",
        state: { model: { id: "test", name: "test", provider: "test" } },
        messages: [],
      });
      expect(state.sessionStats).toEqual({});
    });

    it("resets cost tracking so next cost_update starts from zero", () => {
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.10,
        tokens: { input: 40000, output: 1000, cacheRead: 0, cacheWrite: 0 },
      });
      expect(state.sessionStats.cost).toBe(0.10);

      sendMessage({
        type: "session_switched",
        state: { model: { id: "test", name: "test", provider: "test" } },
        messages: [],
      });
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.02,
        tokens: { input: 5000, output: 200, cacheRead: 0, cacheWrite: 0 },
      });
      expect(state.sessionStats.tokens?.input).toBe(5000);
      expect(state.sessionStats.cost).toBe(0.02);
    });

    it("allows message_end token accumulation in new session (hasCostUpdateSource reset)", () => {
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.10,
        tokens: { input: 40000, output: 1000, cacheRead: 0, cacheWrite: 0 },
      });
      sendMessage({
        type: "session_switched",
        state: { model: { id: "test", name: "test", provider: "test" } },
        messages: [],
      });
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          usage: { input: 8000, output: 500, cacheRead: 0, cacheWrite: 0 },
        },
      });
      expect(state.sessionStats.tokens?.input).toBe(8000);
      expect(state.sessionStats.tokens?.output).toBe(500);
    });
  });

  describe("cost_update without cost field", () => {
    it("updates tokens but leaves cost unchanged when no cost field", () => {
      state.sessionStats.cost = 0.05;
      sendMessage({
        type: "cost_update",
        runId: "r1",
        turnCost: 0,
        cumulativeCost: undefined as unknown as number,
        tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100 },
      });
      expect(state.sessionStats.tokens?.input).toBe(1000);
      expect(state.sessionStats.tokens?.output).toBe(500);
      expect(state.sessionStats.cost).toBe(0.05);
    });

    it("computes per-turn cost deltas from cumulative totals", () => {
      sendMessage({
        type: "cost_update",
        runId: "r1",
        turnCost: 0.01,
        cumulativeCost: 0.01,
        tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
      });
      expect(state.sessionStats.cost).toBe(0.01);
      sendMessage({
        type: "cost_update",
        runId: "r1",
        turnCost: 0.02,
        cumulativeCost: 0.03,
        tokens: { input: 2000, output: 1000, cacheRead: 100, cacheWrite: 50 },
      });
      expect(state.sessionStats.cost).toBe(0.03);
      expect(state.sessionStats.tokens?.input).toBe(2000);
    });
  });

  describe("session_switched", () => {
    it("resets state and applies new session data", () => {
      state.isStreaming = true;
      state.model = { id: "old-model", name: "Old", provider: "old" };
      sendMessage({
        type: "session_switched",
        state: {
          model: { id: "new-model" },
          thinkingLevel: "high",
          isStreaming: false,
          isCompacting: false,
          sessionId: "s-new",
        },
        messages: [],
      });
      expect(state.isStreaming).toBe(false);
      expect(state.model?.id).toBe("new-model");
      expect(state.thinkingLevel).toBe("high");
    });

    it("renders historical messages from new session", () => {
      sendMessage({
        type: "session_switched",
        state: {
          model: null,
          isStreaming: false,
          isCompacting: false,
        },
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ],
      });
      expect(mockUpdateAllUI).toHaveBeenCalled();
    });
  });

  describe("state message (extended)", () => {
    it("updates model and streaming state", () => {
      sendMessage({
        type: "state",
        data: {
          model: { id: "test-model", contextWindow: 200_000 },
          thinkingLevel: "medium",
          isStreaming: true,
          isCompacting: false,
        },
      });
      expect(state.model?.id).toBe("test-model");
      expect(state.thinkingLevel).toBe("medium");
      expect(state.isStreaming).toBe(true);
      expect(state.sessionStats.contextWindow).toBe(200_000);
    });

    it("preserves thinkingLevel when field is omitted", () => {
      state.thinkingLevel = "high";
      sendMessage({
        type: "state",
        data: {
          model: null,
          isStreaming: false,
          isCompacting: false,
        },
      });
      expect(state.thinkingLevel).toBe("high");
    });

    it("clears thinkingLevel when backend sends explicit null", () => {
      state.thinkingLevel = "high";
      sendMessage({
        type: "state",
        data: {
          model: null,
          thinkingLevel: null,
          isStreaming: false,
          isCompacting: false,
        },
      });
      expect(state.thinkingLevel).toBeNull();
    });
  });

  describe("thinking_level_changed", () => {
    it("updates thinkingLevel from backend confirmation", () => {
      state.thinkingLevel = null;
      sendMessage({ type: "thinking_level_changed", level: "high" });
      expect(state.thinkingLevel).toBe("high");
      expect(mockUpdateHeaderUI).toHaveBeenCalled();
      expect(mockUpdateFooterUI).toHaveBeenCalled();
      expect(thinkingPicker.refresh).toHaveBeenCalled();
      expect(toasts.show).toHaveBeenCalledWith("Thinking: high");
    });

    it("defaults to off when level is falsy", () => {
      sendMessage({ type: "thinking_level_changed", level: "" });
      expect(state.thinkingLevel).toBe("off");
    });
  });

  describe("model_routed", () => {
    it("calls handleModelRouted and shows toast", () => {
      const oldModel = { id: "claude-sonnet-4-6" };
      const newModel = { id: "claude-opus-4-6" };
      sendMessage({ type: "model_routed", oldModel, newModel });
      expect(mockHandleModelRouted).toHaveBeenCalledWith(oldModel, newModel);
      expect(toasts.show).toHaveBeenCalled();
    });
  });

  describe("commands", () => {
    it("stores commands and marks as loaded", () => {
      const cmds = [
        { name: "test", description: "Test command" },
        { name: "help", description: "Help command" },
      ];
      sendMessage({ type: "commands", commands: cmds });
      expect(state.commands).toEqual(cmds);
      expect(state.commandsLoaded).toBe(true);
    });
  });

  describe("available_models", () => {
    it("stores available models and marks models as loaded", () => {
      const models = [
        { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic", reasoning: true },
        { id: "gpt-4o", name: "GPT-4o", provider: "openai", reasoning: false },
      ];
      sendMessage({ type: "available_models", models });
      expect(state.availableModels.length).toBe(2);
      expect(state.modelsLoaded).toBe(true);
      expect(state.modelsRequested).toBe(false);
    });

    it("backfills contextWindow on current model", () => {
      state.model = { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic" };
      sendMessage({
        type: "available_models",
        models: [
          { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic", contextWindow: 200_000, reasoning: true },
        ],
      });
      expect(state.model.contextWindow).toBe(200_000);
      expect(mockUpdateHeaderUI).toHaveBeenCalled();
    });

    it("does not backfill when model already has contextWindow", () => {
      state.model = { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic", contextWindow: 150_000 };
      sendMessage({
        type: "available_models",
        models: [
          { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic", contextWindow: 200_000, reasoning: true },
        ],
      });
      expect(state.model.contextWindow).toBe(150_000);
    });
  });

  describe("session_stats", () => {
    it("updates autoCompactionEnabled from session stats", () => {
      sendMessage({
        type: "session_stats",
        data: { autoCompactionEnabled: true },
      });
      expect(state.sessionStats.autoCompactionEnabled).toBe(true);
    });
  });
});
