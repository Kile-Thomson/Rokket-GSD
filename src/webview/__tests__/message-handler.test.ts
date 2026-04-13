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

});
