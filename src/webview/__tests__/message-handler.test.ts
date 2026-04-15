// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { state } from "../state";

// ============================================================
// Mock cross-module imports
// ============================================================

vi.mock("../renderer", () => ({
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
}));

vi.mock("../session-history", () => ({
  setCurrentSessionId: vi.fn(),
  updateSessions: vi.fn(),
  showError: vi.fn(),
  hide: vi.fn(),
}));

vi.mock("../slash-menu", () => ({
  isVisible: vi.fn(() => false),
  show: vi.fn(),
}));

vi.mock("../model-picker", () => ({
  isVisible: vi.fn(() => false),
  render: vi.fn(),
}));

vi.mock("../thinking-picker", () => ({
  refresh: vi.fn(),
}));

vi.mock("../ui-dialogs", () => ({
  hasPending: vi.fn(() => false),
  expireAllPending: vi.fn(),
  handleRequest: vi.fn(),
}));

vi.mock("../toasts", () => ({
  show: vi.fn(),
}));

vi.mock("../dashboard", () => ({
  renderDashboard: vi.fn(),
  updateWelcomeScreen: vi.fn(),
}));

vi.mock("../auto-progress", () => ({
  update: vi.fn(),
}));

vi.mock("../visualizer", () => ({
  isVisible: vi.fn(() => false),
  updateData: vi.fn(),
}));

vi.mock("../file-handling", () => ({
  addFileAttachments: vi.fn(),
}));

vi.mock("../helpers", () => ({
  escapeHtml: (s: string) => s,
  formatMarkdownNotes: (s: string) => s,
  formatShortDate: (s: string) => s,
  scrollToBottom: vi.fn(),
}));

vi.mock("../keyboard", () => ({
  setChangelogHandlers: vi.fn(),
  getChangelogTriggerEl: vi.fn(() => null),
  dismissChangelog: vi.fn(),
}));

vi.mock("../a11y", () => ({
  createFocusTrap: vi.fn(() => vi.fn()),
  saveFocus: vi.fn(() => null),
  restoreFocus: vi.fn(),
}));

import { init, addSystemEntry } from "../message-handler";
import * as renderer from "../renderer";
import * as uiDialogs from "../ui-dialogs";
// session-history imported transitively via message-handler
import * as autoProgress from "../auto-progress";
import * as dashboard from "../dashboard";
import * as toasts from "../toasts";
import * as thinkingPicker from "../thinking-picker";
import * as keyboard from "../keyboard";

// ============================================================
// Helpers
// ============================================================

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
let mockAnnounce: ReturnType<typeof vi.fn>;

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

// ============================================================
// Setup
// ============================================================

describe("message-handler", () => {
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
    mockAnnounce = vi.fn();

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
      announceToScreenReader: mockAnnounce,
    });
  });

  afterEach(() => {
    resetState();
  });

  // ============================================================
  // config
  // ============================================================

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

  // ============================================================
  // state
  // ============================================================

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

  // ============================================================
  // session_stats
  // ============================================================

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
      // cost from session_stats is ignored — cost_update is authoritative
      expect(state.sessionStats.cost).toBe(0.10);
    });
  });

  // ============================================================
  // cost_update
  // ============================================================

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

    it("falls back to flat field names (totalInput)", () => {
      sendMessage({
        type: "cost_update",
        data: { totalCost: 0.20, totalInput: 60000, totalOutput: 3000, totalCacheRead: 0, totalCacheWrite: 0 },
      });
      expect(state.sessionStats.tokens?.input).toBe(60000);
      expect(state.sessionStats.tokens?.output).toBe(3000);
      expect(state.sessionStats.cost).toBe(0.20);
    });

    it("computes per-turn deltas from cumulative totals", () => {
      // First cost_update — establishes baseline
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.05,
        tokens: { input: 10000, output: 500, cacheRead: 0, cacheWrite: 0 },
      });
      // Second cost_update — deltas should be computed
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.12,
        tokens: { input: 25000, output: 1200, cacheRead: 8000, cacheWrite: 0 },
      });
      // Session totals = cumulative (not summed deltas)
      expect(state.sessionStats.tokens?.input).toBe(25000);
      expect(state.sessionStats.cost).toBe(0.12);
    });

    it("computes contextPercent from per-turn deltas", () => {
      state.sessionStats.contextWindow = 200_000;
      // First cost_update — turn deltas = full cumulative (prev was 0)
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.05,
        tokens: { input: 30000, output: 1000, cacheRead: 10000, cacheWrite: 5000 },
      });
      // turnContextTokens = 30000 + 10000 + 5000 = 45000
      // contextPercent = 45000 / 200000 * 100 = 22.5
      expect(state.sessionStats.contextPercent).toBe(22.5);
      expect(state.sessionStats.contextTokens).toBe(45000);

      // Second cost_update — cumulative grows, but context % uses deltas
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.10,
        tokens: { input: 95000, output: 3000, cacheRead: 50000, cacheWrite: 10000 },
      });
      // turnInput = 95000 - 30000 = 65000
      // turnCacheRead = 50000 - 10000 = 40000
      // turnCacheWrite = 10000 - 5000 = 5000
      // turnContextTokens = 65000 + 40000 + 5000 = 110000
      // contextPercent = 110000 / 200000 * 100 = 55
      expect(state.sessionStats.contextPercent).toBeCloseTo(55, 5);
      expect(state.sessionStats.contextTokens).toBe(110000);
    });
  });

  // ============================================================
  // process_status
  // ============================================================

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

  // ============================================================
  // agent_start / agent_end
  // ============================================================

  describe("agent_start message", () => {
    it("starts streaming and creates a turn", () => {
      sendMessage({ type: "agent_start" });
      expect(state.isStreaming).toBe(true);
      expect(state.currentTurn).not.toBeNull();
      expect(renderer.ensureCurrentTurnElement).toHaveBeenCalled();
      expect(mockAnnounce).toHaveBeenCalledWith("Assistant is responding...");
    });

    it("expires pending dialogs", () => {
      vi.mocked(uiDialogs.hasPending).mockReturnValue(true);
      sendMessage({ type: "agent_start" });
      expect(uiDialogs.expireAllPending).toHaveBeenCalledWith("New turn started");
    });
  });

  describe("agent_end message", () => {
    it("stops streaming and finalizes turn", () => {
      // Start a turn first
      sendMessage({ type: "agent_start" });
      vi.clearAllMocks();

      sendMessage({ type: "agent_end" });
      expect(state.isStreaming).toBe(false);
      expect(renderer.finalizeCurrentTurn).toHaveBeenCalled();
      expect(mockUpdateInputUI).toHaveBeenCalled();
    });
  });

  // ============================================================
  // turn_start
  // ============================================================

  describe("turn_start message", () => {
    it("creates a turn if none exists", () => {
      expect(state.currentTurn).toBeNull();
      sendMessage({ type: "turn_start" });
      expect(state.currentTurn).not.toBeNull();
    });

    it("does not replace an existing turn", () => {
      sendMessage({ type: "agent_start" });
      const turnId = state.currentTurn!.id;
      sendMessage({ type: "turn_start" });
      expect(state.currentTurn!.id).toBe(turnId);
    });
  });

  // ============================================================
  // message_update
  // ============================================================

  describe("message_update message", () => {
    it("appends text delta to renderer", () => {
      sendMessage({ type: "agent_start" });
      vi.clearAllMocks();

      sendMessage({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
      });
      expect(renderer.appendToTextSegment).toHaveBeenCalledWith("text", "hello");
    });

    it("appends thinking delta to renderer", () => {
      sendMessage({ type: "agent_start" });
      vi.clearAllMocks();

      sendMessage({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
      });
      expect(renderer.appendToTextSegment).toHaveBeenCalledWith("thinking", "hmm");
    });

    it("renders thinking delta even when thinking is off (makes backend bug visible)", () => {
      sendMessage({ type: "agent_start" });
      state.thinkingLevel = "off";
      vi.clearAllMocks();

      sendMessage({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "secret thoughts" },
      });
      // Thinking deltas are always rendered — if the backend sends them with
      // thinking "off", that's a backend bug and the user should see it.
      expect(renderer.appendToTextSegment).toHaveBeenCalledWith("thinking", "secret thoughts");
    });

    it("does nothing when no current turn", () => {
      state.currentTurn = null;
      sendMessage({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
      });
      expect(renderer.appendToTextSegment).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // message_end
  // ============================================================

  describe("message_end message", () => {
    it("accumulates token usage", () => {
      state.model = { id: "test", name: "test", provider: "test", contextWindow: 100000 };
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { total: 0.01 } },
        },
      });
      expect(state.sessionStats.tokens!.input).toBe(100);
      expect(state.sessionStats.tokens!.output).toBe(50);
      expect(state.sessionStats.cost).toBe(0.01);
    });
  });

  // ============================================================
  // tool_execution lifecycle
  // ============================================================

  describe("tool_execution lifecycle", () => {
    it("tracks tool from start through update to end", () => {
      sendMessage({ type: "agent_start" });
      vi.clearAllMocks();

      // Start
      sendMessage({
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "Read",
        args: { path: "foo.ts" },
      });
      expect(state.currentTurn!.toolCalls.has("t1")).toBe(true);
      const tc = state.currentTurn!.toolCalls.get("t1")!;
      expect(tc.isRunning).toBe(true);
      expect(renderer.appendToolSegmentElement).toHaveBeenCalled();

      // Update
      sendMessage({
        type: "tool_execution_update",
        toolCallId: "t1",
        partialResult: { content: [{ text: "partial data" }] },
      });
      expect(tc.resultText).toBe("partial data");

      // End
      sendMessage({
        type: "tool_execution_end",
        toolCallId: "t1",
        isError: false,
        durationMs: 150,
        result: { content: [{ text: "final data" }] },
      });
      expect(tc.isRunning).toBe(false);
      expect(tc.resultText).toBe("final data");
    });

    it("detects parallel tool execution", () => {
      sendMessage({ type: "agent_start" });

      // First tool
      sendMessage({ type: "tool_execution_start", toolCallId: "t1", toolName: "Read", args: {} });
      expect(state.currentTurn!.toolCalls.get("t1")!.isParallel).toBeFalsy();

      // Second tool while first is still running
      sendMessage({ type: "tool_execution_start", toolCallId: "t2", toolName: "Bash", args: {} });
      expect(state.currentTurn!.toolCalls.get("t2")!.isParallel).toBe(true);
      // First tool should now be marked parallel too
      expect(state.currentTurn!.toolCalls.get("t1")!.isParallel).toBe(true);
    });
  });

  // ============================================================
  // compaction
  // ============================================================

  describe("compaction messages", () => {
    it("toggles compaction state", () => {
      sendMessage({ type: "auto_compaction_start" });
      expect(state.isCompacting).toBe(true);
      expect(mockUpdateOverlayIndicators).toHaveBeenCalled();

      vi.clearAllMocks();
      sendMessage({ type: "auto_compaction_end" });
      expect(state.isCompacting).toBe(false);
      expect(mockUpdateOverlayIndicators).toHaveBeenCalled();
    });
  });

  // ============================================================
  // auto_retry
  // ============================================================

  describe("auto_retry messages", () => {
    it("tracks retry state", () => {
      sendMessage({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "rate limit" });
      expect(state.isRetrying).toBe(true);
      expect(state.retryInfo?.attempt).toBe(1);

      sendMessage({ type: "auto_retry_end", success: true });
      expect(state.isRetrying).toBe(false);
    });

    it("adds system entry on final failure", () => {
      sendMessage({ type: "auto_retry_end", success: false, finalError: "All retries exhausted" });
      const lastEntry = state.entries[state.entries.length - 1];
      expect(lastEntry.type).toBe("system");
      expect(lastEntry.systemText).toContain("All retries exhausted");
    });
  });

  // ============================================================
  // process_exit
  // ============================================================

  describe("process_exit message", () => {
    it("cleans up streaming state and adds system entry", () => {
      state.isStreaming = true;
      state.commandsLoaded = true;
      sendMessage({ type: "process_exit", code: 1 });
      expect(state.isStreaming).toBe(false);
      expect(state.commandsLoaded).toBe(false);
      expect(renderer.resetStreamingState).toHaveBeenCalled();
      expect(autoProgress.update).toHaveBeenCalledWith(null);
      const lastEntry = state.entries[state.entries.length - 1];
      expect(lastEntry.systemKind).toBe("error");
    });

    it("uses info kind for clean exit", () => {
      sendMessage({ type: "process_exit", code: 0 });
      const lastEntry = state.entries[state.entries.length - 1];
      expect(lastEntry.systemKind).toBe("info");
    });

    it("includes detail text when provided", () => {
      sendMessage({ type: "process_exit", code: 1, detail: "Segfault in module X" });
      const lastEntry = state.entries[state.entries.length - 1];
      expect(lastEntry.systemText).toContain("Segfault in module X");
    });
  });

  // ============================================================
  // commands / available_models
  // ============================================================

  describe("commands message", () => {
    it("populates state.commands", () => {
      sendMessage({ type: "commands", commands: [{ name: "test", description: "test cmd" }] });
      expect(state.commands.length).toBe(1);
      expect(state.commandsLoaded).toBe(true);
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

      // Should keep the existing value
      expect(state.model.contextWindow).toBe(200000);
    });
  });

  // ============================================================
  // thinking_level_changed
  // ============================================================

  describe("thinking_level_changed message", () => {
    it("updates thinking level and refreshes picker", () => {
      sendMessage({ type: "thinking_level_changed", level: "high" });
      expect(state.thinkingLevel).toBe("high");
      expect(thinkingPicker.refresh).toHaveBeenCalled();
      expect(toasts.show).toHaveBeenCalledWith("Thinking: high");
    });
  });

  // ============================================================
  // process_health
  // ============================================================

  describe("process_health message", () => {
    it("updates health state", () => {
      sendMessage({ type: "process_health", status: "unresponsive" });
      expect(state.processHealth).toBe("unresponsive");
      expect(mockUpdateOverlayIndicators).toHaveBeenCalled();
    });

    it("adds system entry on recovery", () => {
      sendMessage({ type: "process_health", status: "recovered" });
      expect(state.processHealth).toBe("recovered");
      const lastEntry = state.entries[state.entries.length - 1];
      expect(lastEntry.systemText).toContain("recovered");
    });
  });

  // ============================================================
  // addSystemEntry
  // ============================================================

  describe("addSystemEntry", () => {
    it("creates a system entry and renders it", () => {
      addSystemEntry("Test alert", "warning");
      expect(state.entries.length).toBe(1);
      expect(state.entries[0].systemText).toBe("Test alert");
      expect(state.entries[0].systemKind).toBe("warning");
      expect(renderer.renderNewEntry).toHaveBeenCalled();
    });
  });

  // ============================================================
  // error boundary
  // ============================================================

  describe("error boundary", () => {
    it("catches handler errors and surfaces them as system entries", () => {
      // extension_ui_request with method=select triggers uiDialogs.handleRequest
      // which is mocked, but we can test error boundary by sending an unknown
      // message type that triggers an error in the switch. Actually, the
      // error boundary catches internal errors. Let's trigger one by making
      // a mock throw.
      vi.mocked(renderer.renderNewEntry).mockImplementationOnce(() => {
        throw new Error("DOM exploded");
      });

      // This triggers addSystemEntry which calls renderer.renderNewEntry
      // First call throws, but the error boundary in handleMessage should catch it
      sendMessage({ type: "error", message: "test error" });

      // The error boundary should have added an error entry about the crash
      // Check that at least one entry mentions the error
      const hasErrorEntry = state.entries.some(
        (e) => e.systemKind === "error" && e.systemText?.includes("Internal error"),
      );
      expect(hasErrorEntry).toBe(true);
    });
  });

  // ============================================================
  // session_switched
  // ============================================================

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
      // Simulate a cost_update in the old session
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.10,
        tokens: { input: 40000, output: 1000, cacheRead: 0, cacheWrite: 0 },
      });
      expect(state.sessionStats.cost).toBe(0.10);

      // Switch sessions
      sendMessage({
        type: "session_switched",
        state: { model: { id: "test", name: "test", provider: "test" } },
        messages: [],
      });

      // New session's first cost_update — should use its own cumulative values,
      // not compute deltas against the old session's totals
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.02,
        tokens: { input: 5000, output: 200, cacheRead: 0, cacheWrite: 0 },
      });

      expect(state.sessionStats.tokens?.input).toBe(5000);
      expect(state.sessionStats.cost).toBe(0.02);
    });

    it("allows message_end token accumulation in new session (hasCostUpdateSource reset)", () => {
      // In the old session, cost_update was authoritative
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.10,
        tokens: { input: 40000, output: 1000, cacheRead: 0, cacheWrite: 0 },
      });

      // Switch sessions
      sendMessage({
        type: "session_switched",
        state: { model: { id: "test", name: "test", provider: "test" } },
        messages: [],
      });

      // In new session, send agent_start + message_end with usage (no cost_update)
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          usage: { input: 8000, output: 500, cacheRead: 0, cacheWrite: 0 },
        },
      });

      // message_end should have accumulated tokens since cost_update source was reset
      expect(state.sessionStats.tokens?.input).toBe(8000);
      expect(state.sessionStats.tokens?.output).toBe(500);
    });
  });

  // ============================================================
  // extension_ui_request
  // ============================================================

  describe("extension_ui_request message", () => {
    it("routes select/confirm/input methods to uiDialogs", () => {
      sendMessage({ type: "extension_ui_request", method: "select", id: "r1" });
      expect(uiDialogs.handleRequest).toHaveBeenCalled();
    });

    it("sets editor text for set_editor_text method", () => {
      sendMessage({ type: "extension_ui_request", method: "set_editor_text", text: "hello world" });
      expect(promptInput.value).toBe("hello world");
      expect(mockAutoResize).toHaveBeenCalled();
    });

    it("adds system entry for notify method", () => {
      sendMessage({ type: "extension_ui_request", method: "notify", message: "Heads up!", notifyType: "warning" });
      const lastEntry = state.entries[state.entries.length - 1];
      expect(lastEntry.systemText).toBe("Heads up!");
      expect(lastEntry.systemKind).toBe("warning");
    });
  });

  // ============================================================
  // workflow_state / dashboard_data
  // ============================================================

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

  // ============================================================
  // changelog
  // ============================================================

  describe("changelog message", () => {
    it("calls dismissChangelog with silent flag before rendering content", () => {
      sendMessage({
        type: "changelog",
        entries: [{ version: "1.0.0", notes: "Initial release", date: "2026-01-01" }],
      });
      expect(keyboard.dismissChangelog).toHaveBeenCalledWith({ silent: true });
      // The new changelog card should be inserted
      const card = messagesContainer.querySelector("#gsd-changelog");
      expect(card).toBeTruthy();
    });

    it("does not leave orphaned handlers when replacing loader", () => {
      // Simulate a loader element already in the DOM
      const loader = document.createElement("div");
      loader.id = "gsd-changelog";
      messagesContainer.appendChild(loader);

      sendMessage({
        type: "changelog",
        entries: [{ version: "2.0.0", notes: "Update", date: "2026-04-01" }],
      });

      // dismissChangelog should have cleaned up the loader
      expect(keyboard.dismissChangelog).toHaveBeenCalledWith({ silent: true });
      // setChangelogHandlers should be called with new handlers
      expect(keyboard.setChangelogHandlers).toHaveBeenCalled();
    });
  });

  // ============================================================
  // resolveContextWindow — context window resolution via message_end
  // ============================================================

  describe("resolveContextWindow", () => {
    function startTurnAndEndMessage(usage: Record<string, unknown>): void {
      // Start a turn so message_end has a currentTurn to work with
      sendMessage({ type: "agent_start" });
      // message_end expects msg.message.usage (not msg.usage)
      sendMessage({
        type: "message_end",
        message: { role: "assistant", usage },
      });
    }

    it("uses sessionStats.contextWindow when set", () => {
      state.sessionStats.contextWindow = 200_000;
      state.model = { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic" };
      startTurnAndEndMessage({ input: 1000, output: 500 });
      expect(state.sessionStats.contextWindow).toBe(200_000);
    });

    it("uses model.contextWindow when sessionStats has none", () => {
      state.model = { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic", contextWindow: 180_000 };
      startTurnAndEndMessage({ input: 1000, output: 500 });
      expect(state.sessionStats.contextWindow).toBe(180_000);
    });

    it("cross-references availableModels when model has no contextWindow", () => {
      state.model = { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic" };
      state.availableModels = [
        { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic", contextWindow: 190_000, reasoning: true },
      ] as any;
      startTurnAndEndMessage({ input: 1000, output: 500 });
      expect(state.sessionStats.contextWindow).toBe(190_000);
    });

    it("falls back to known model table for opus-4", () => {
      state.model = { id: "claude-opus-4-6", name: "Opus", provider: "anthropic" };
      startTurnAndEndMessage({ input: 1000, output: 500 });
      expect(state.sessionStats.contextWindow).toBe(200_000);
    });

    it("falls back to known model table for gpt-4o", () => {
      state.model = { id: "gpt-4o-mini", name: "GPT-4o", provider: "openai" };
      startTurnAndEndMessage({ input: 1000, output: 500 });
      expect(state.sessionStats.contextWindow).toBe(128_000);
    });

    it("falls back to known model table for gemini-2", () => {
      state.model = { id: "gemini-2.0-flash", name: "Gemini", provider: "google" };
      startTurnAndEndMessage({ input: 1000, output: 500 });
      expect(state.sessionStats.contextWindow).toBe(1_000_000);
    });

    it("returns 0 for unknown model with no context window info", () => {
      state.model = { id: "custom-model-xyz", name: "Custom", provider: "custom" };
      startTurnAndEndMessage({ input: 1000, output: 500 });
      // contextWindow should be 0 (or undefined/unset) since resolveContextWindow returns 0
      expect(state.sessionStats.contextWindow || 0).toBe(0);
    });
  });

  // ============================================================
  // cost_update — missing cost field
  // ============================================================

  describe("cost_update without cost field", () => {
    it("updates tokens but leaves cost unchanged when no cost field", () => {
      state.sessionStats.cost = 0.05; // previous cost
      sendMessage({
        type: "cost_update",
        data: {
          tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100 },
          // No cumulativeCost or totalCost
        },
      });
      expect(state.sessionStats.tokens?.input).toBe(1000);
      expect(state.sessionStats.tokens?.output).toBe(500);
      expect(state.sessionStats.cost).toBe(0.05); // unchanged
    });

    it("computes per-turn cost deltas from cumulative totals", () => {
      // First cost_update — establishes baseline
      sendMessage({
        type: "cost_update",
        data: {
          tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
          cumulativeCost: 0.01,
        },
      });
      expect(state.sessionStats.cost).toBe(0.01);

      // Second cost_update — delta should be computed
      sendMessage({
        type: "cost_update",
        data: {
          tokens: { input: 2000, output: 1000, cacheRead: 100, cacheWrite: 50 },
          cumulativeCost: 0.03,
        },
      });
      expect(state.sessionStats.cost).toBe(0.03);
      expect(state.sessionStats.tokens?.input).toBe(2000);
    });
  });

  // ============================================================
  // process_exit resets derived session tracking
  // ============================================================

  describe("process_exit", () => {
    it("resets session tracking state on process exit", () => {
      // Set up some tracking state
      sendMessage({
        type: "cost_update",
        data: {
          tokens: { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0 },
          cumulativeCost: 0.10,
        },
      });
      expect(state.sessionStats.tokens?.input).toBe(5000);

      // Now process exits
      sendMessage({ type: "process_exit", code: 0 });

      // Verify state was cleaned up
      expect(state.isStreaming).toBe(false);
      expect(state.currentTurn).toBeNull();
      expect(state.processHealth).toBe("responsive");
    });
  });

  // ============================================================
  // Skill detection in tool_execution_start
  // ============================================================

  describe("skill detection", () => {
    it("detects skill from Read tool targeting a SKILL.md file", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "tool_execution_start",
        toolCallId: "tc-skill-1",
        toolName: "Read",
        args: { path: "/home/user/.agents/skills/my-cool-skill/SKILL.md" },
      });
      expect(state.loadedSkills.has("my-cool-skill")).toBe(true);
    });

    it("detects skill from Read tool with Windows-style backslashes", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "tool_execution_start",
        toolCallId: "tc-skill-2",
        toolName: "Read",
        args: { path: "C:\\Users\\test\\.agents\\skills\\debug-like-expert\\SKILL.md" },
      });
      expect(state.loadedSkills.has("debug-like-expert")).toBe(true);
    });

    it("does not double-add already loaded skills", () => {
      state.loadedSkills.clear();
      state.loadedSkills.add("existing-skill");
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "tool_execution_start",
        toolCallId: "tc-skill-3",
        toolName: "Read",
        args: { path: "/skills/existing-skill/SKILL.md" },
      });
      // Should still have it, but set size stays the same
      expect(state.loadedSkills.has("existing-skill")).toBe(true);
      expect(state.loadedSkills.size).toBe(1);
    });

    it("detects skill from Skill tool invocation", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "tool_execution_start",
        toolCallId: "tc-skill-4",
        toolName: "Skill",
        args: { skill: "lint" },
      });
      expect(state.loadedSkills.has("lint")).toBe(true);
    });
  });

  // ============================================================
  // tool_execution_end
  // ============================================================

  describe("tool_execution_end", () => {
    it("marks a tool as not running on completion", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "tool_execution_start",
        toolCallId: "tc-done-1",
        toolName: "Read",
        args: { path: "/test.txt" },
      });
      expect(state.currentTurn?.toolCalls.get("tc-done-1")?.isRunning).toBe(true);

      sendMessage({
        type: "tool_execution_end",
        toolCallId: "tc-done-1",
        output: "file contents",
      });
      expect(state.currentTurn?.toolCalls.get("tc-done-1")?.isRunning).toBe(false);
    });

    it("records error status on tool failure", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "tool_execution_start",
        toolCallId: "tc-err-1",
        toolName: "Bash",
        args: { command: "false" },
      });
      sendMessage({
        type: "tool_execution_end",
        toolCallId: "tc-err-1",
        output: "command failed",
        isError: true,
      });
      const tc = state.currentTurn?.toolCalls.get("tc-err-1");
      expect(tc?.isRunning).toBe(false);
      expect(tc?.isError).toBe(true);
    });
  });

  // ============================================================
  // session_switched
  // ============================================================

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

  // ============================================================
  // message_end — token accumulation
  // ============================================================

  describe("message_end token accumulation", () => {
    it("accumulates tokens from message_end when no cost_update source", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 500, output: 200, cacheRead: 100, cacheWrite: 50 },
        },
      });
      expect(state.sessionStats.tokens?.input).toBe(500);
      expect(state.sessionStats.tokens?.output).toBe(200);
      expect(state.sessionStats.tokens?.cacheRead).toBe(100);
      expect(state.sessionStats.tokens?.cacheWrite).toBe(50);
      expect(state.sessionStats.tokens?.total).toBe(850);
    });

    it("accumulates cost from message_end usage", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 500, output: 200, cost: { total: 0.005 } },
        },
      });
      expect(state.sessionStats.cost).toBe(0.005);
    });

    it("computes contextPercent from usage tokens when cost_update is absent", () => {
      state.sessionStats.contextWindow = 100_000;
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 40000, output: 5000, cacheRead: 10000, cacheWrite: 0 },
        },
      });
      // contextTokens = input + cacheRead + cacheWrite = 50000
      // contextPercent = 50000 / 100000 * 100 = 50
      expect(state.sessionStats.contextPercent).toBe(50);
    });

    it("does NOT compute contextPercent from message_end when cost_update is active", () => {
      state.sessionStats.contextWindow = 100_000;
      // Activate cost_update source first
      sendMessage({
        type: "cost_update",
        cumulativeCost: 0.01,
        tokens: { input: 5000, output: 500, cacheRead: 2000, cacheWrite: 1000 },
      });
      // cost_update sets context % from per-turn deltas: (5000+2000+1000)/100000 = 8%
      expect(state.sessionStats.contextPercent).toBe(8);

      // Now send message_end with much larger cumulative values — should NOT override
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 500000, output: 50000, cacheRead: 200000, cacheWrite: 100000 },
        },
      });
      // contextPercent should still be 8% from cost_update, not 800% from message_end
      expect(state.sessionStats.contextPercent).toBe(8);
    });

    it("handles message_end with stopReason:error without crashing", () => {
      sendMessage({ type: "agent_start" });
      // This should not throw — error messages are surfaced via addSystemEntry
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "API key expired",
        },
      });
      // message_end doesn't finalize the turn — agent_end does.
      // Verify no crash occurred and the turn is still active.
      expect(state.currentTurn).toBeTruthy();
    });
  });

  // ============================================================
  // state message
  // ============================================================

  describe("state message", () => {
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
          // thinkingLevel NOT present
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

  // ============================================================
  // thinking_level_changed
  // ============================================================

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

  // ============================================================
  // model_routed
  // ============================================================

  describe("model_routed", () => {
    it("calls handleModelRouted and shows toast", () => {
      const oldModel = { id: "claude-sonnet-4-6" };
      const newModel = { id: "claude-opus-4-6" };
      sendMessage({ type: "model_routed", oldModel, newModel });
      expect(mockHandleModelRouted).toHaveBeenCalledWith(oldModel, newModel);
      expect(toasts.show).toHaveBeenCalled();
    });
  });

  // ============================================================
  // agent_end
  // ============================================================

  describe("agent_end", () => {
    it("stops streaming and finalizes turn", () => {
      sendMessage({ type: "agent_start" });
      expect(state.isStreaming).toBe(true);

      sendMessage({ type: "agent_end" });
      expect(state.isStreaming).toBe(false);
      expect(state.processHealth).toBe("responsive");
      expect(renderer.finalizeCurrentTurn).toHaveBeenCalled();
      expect(mockUpdateInputUI).toHaveBeenCalled();
      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "get_session_stats" });
    });

    it("expires pending dialogs on agent_end", () => {
      (uiDialogs.hasPending as any).mockReturnValue(true);
      sendMessage({ type: "agent_start" });
      sendMessage({ type: "agent_end" });
      expect(uiDialogs.expireAllPending).toHaveBeenCalledWith("Agent finished");
    });

    it("clears active batch on agent_end", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({ type: "agent_end" });
      expect(renderer.clearActiveBatch).toHaveBeenCalled();
    });
  });

  // ============================================================
  // error message
  // ============================================================

  describe("error message", () => {
    it("handles error message without crashing", () => {
      // Just verify this doesn't throw
      expect(() => {
        sendMessage({ type: "error", message: "Something went wrong" });
      }).not.toThrow();
    });
  });

  // ============================================================
  // turn_start
  // ============================================================

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

  // ============================================================
  // extension_ui_request — widget rendering
  // ============================================================

  describe("extension_ui_request (widgets)", () => {
    it("handles setWidget without crashing when no container", () => {
      // No widgetContainer in DOM — should bail gracefully
      expect(() => {
        sendMessage({
          type: "extension_ui_request",
          action: "setWidget",
          key: "test-widget",
          lines: ["Status: OK"],
        });
      }).not.toThrow();
    });
  });

  // ============================================================
  // turn_start
  // ============================================================

  describe("turn_start", () => {
    it("creates a new turn when none exists", () => {
      state.currentTurn = null;
      sendMessage({ type: "turn_start" });
      expect(state.currentTurn).toBeTruthy();
      expect(state.currentTurn!.segments).toEqual([]);
      expect(state.currentTurn!.toolCalls).toBeInstanceOf(Map);
    });

    it("does not overwrite an existing turn", () => {
      sendMessage({ type: "agent_start" }); // creates a turn
      const turnId = state.currentTurn!.id;
      sendMessage({ type: "turn_start" });
      expect(state.currentTurn!.id).toBe(turnId);
    });
  });

  // ============================================================
  // message_update — text_delta and thinking_delta
  // ============================================================

  describe("message_update deltas", () => {
    it("appends text via text_delta", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello world" },
      });
      expect(renderer.appendToTextSegment).toHaveBeenCalledWith("text", "Hello world");
    });

    it("strips async_subagent_progress from text_delta", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: 'some text\n{"__async_subagent_progress": true}\nmore text',
        },
      });
      expect(renderer.appendToTextSegment).toHaveBeenCalledWith("text", "some text\nmore text");
    });

    it("auto-detects thinking level from thinking_delta when null", () => {
      state.thinkingLevel = null;
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "Let me think..." },
      });
      expect(state.thinkingLevel).toBe("medium");
      expect(renderer.appendToTextSegment).toHaveBeenCalledWith("thinking", "Let me think...");
    });

    it("does NOT override explicit thinking level from thinking_delta", () => {
      state.thinkingLevel = "off";
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "thinking..." },
      });
      // "off" is truthy, so auto-detection should NOT fire
      expect(state.thinkingLevel).toBe("off");
    });
  });

  // ============================================================
  // models_loaded
  // ============================================================

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
      // Should keep existing value
      expect(state.model.contextWindow).toBe(150_000);
    });
  });

  // ============================================================
  // session_stats
  // ============================================================

  describe("session_stats", () => {
    it("updates autoCompactionEnabled from session stats", () => {
      sendMessage({
        type: "session_stats",
        data: { autoCompactionEnabled: true },
      });
      expect(state.sessionStats.autoCompactionEnabled).toBe(true);
    });
  });

  // ============================================================
  // auto compaction events
  // ============================================================

  describe("auto compaction events", () => {
    it("sets isCompacting on auto_compaction_start", () => {
      sendMessage({ type: "auto_compaction_start" });
      expect(state.isCompacting).toBe(true);
    });

    it("clears isCompacting on auto_compaction_end", () => {
      state.isCompacting = true;
      sendMessage({ type: "auto_compaction_end" });
      expect(state.isCompacting).toBe(false);
    });
  });

});
