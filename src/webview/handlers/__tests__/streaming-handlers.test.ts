// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { state } from "../../state";

// ============================================================
// Mock cross-module imports
// ============================================================

vi.mock("../../renderer", () => ({
  resetStreamingState: vi.fn(),
  ensureCurrentTurnElement: vi.fn(() => document.createElement("div")),
  appendToTextSegment: vi.fn(),
  appendToolSegmentElement: vi.fn(),
  updateToolSegmentElement: vi.fn(),
  finalizeCurrentTurn: vi.fn(),
  clearMessages: vi.fn(),
  renderNewEntry: vi.fn(),
  getCurrentTurnElement: vi.fn(() => null),

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
import * as renderer from "../../renderer";
import * as uiDialogs from "../../ui-dialogs";
import { announceToScreenReader } from "../../a11y";

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

describe("streaming-handlers", () => {
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

  // ============================================================
  // agent_start message
  // ============================================================

  describe("agent_start message", () => {
    it("starts streaming and creates a turn", () => {
      sendMessage({ type: "agent_start" });
      expect(state.isStreaming).toBe(true);
      expect(state.currentTurn).not.toBeNull();
      expect(renderer.ensureCurrentTurnElement).toHaveBeenCalled();
      expect(announceToScreenReader).toHaveBeenCalledWith("Assistant is responding...");
    });

    it("expires pending dialogs", () => {
      vi.mocked(uiDialogs.hasPending).mockReturnValue(true);
      sendMessage({ type: "agent_start" });
      expect(uiDialogs.expireAllPending).toHaveBeenCalledWith("New turn started");
    });
  });

  // ============================================================
  // agent_end message
  // ============================================================

  describe("agent_end message", () => {
    it("stops streaming and finalizes turn", () => {
      sendMessage({ type: "agent_start" });
      vi.clearAllMocks();
      sendMessage({ type: "agent_end" });
      expect(state.isStreaming).toBe(false);
      expect(renderer.finalizeCurrentTurn).toHaveBeenCalled();
      expect(mockUpdateInputUI).toHaveBeenCalled();
    });
  });

  // ============================================================
  // turn_start message
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
  // message_update message
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
  // message_end message
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
  // resolveContextWindow
  // ============================================================

  describe("resolveContextWindow", () => {
    function startTurnAndEndMessage(usage: Record<string, unknown>): void {
      sendMessage({ type: "agent_start" });
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
      expect(state.sessionStats.contextWindow || 0).toBe(0);
    });
  });

  // ============================================================
  // message_end token accumulation
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

    it("tracks session totals as monotonic-max from message_end usage", () => {
      // pi's `message_end.usage` is a session-wide running aggregate (see
      // gsd-pi agent-session.ts getSessionStats — totalInput sums across all
      // assistant messages). Treat each field as monotonic-max so the header
      // never visibly dips between turns.
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 17, output: 4464, cacheRead: 881636, cacheWrite: 72261 },
        },
      });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 50, output: 9100, cacheRead: 1700000, cacheWrite: 50000 },
        },
      });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 50, output: 16000, cacheRead: 2100000, cacheWrite: 40000 },
        },
      });
      const t = state.sessionStats.tokens!;
      expect(t.input).toBe(50);
      expect(t.output).toBe(16000);
      expect(t.cacheRead).toBe(2100000);
      expect(t.cacheWrite).toBe(72261);
      expect(t.total).toBe(t.input + t.output + t.cacheRead + t.cacheWrite);
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

    it("computes contextPercent from perCallUsage.totalTokens when present", () => {
      // pi's claude-code-cli adapter attaches `perCallUsage` — the last API
      // call's snapshot. `totalTokens` is the authoritative value (matches
      // pi's calculateContextTokens exactly).
      state.sessionStats.contextWindow = 100_000;
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 40000, output: 5000, cacheRead: 10000, cacheWrite: 0 },
          perCallUsage: { input: 40000, output: 5000, cacheRead: 10000, cacheWrite: 0, totalTokens: 55000 },
        },
      });
      expect(state.sessionStats.contextPercent).toBeCloseTo(55, 5);
      expect(state.sessionStats.contextTokens).toBe(55000);
    });

    it("falls back to perCallUsage field sum when totalTokens is missing", () => {
      state.sessionStats.contextWindow = 100_000;
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 50, output: 500, cacheRead: 40000, cacheWrite: 5000 },
          // No totalTokens — handler sums input+output+cacheRead+cacheWrite = 45550.
          perCallUsage: { input: 50, output: 500, cacheRead: 40000, cacheWrite: 5000 },
        },
      });
      expect(state.sessionStats.contextTokens).toBe(45550);
      expect(state.sessionStats.contextPercent).toBeCloseTo(45.55, 5);
    });

    it("reflects only the LAST call's perCallUsage across multiple message_end events", () => {
      // The 91.7% regression was caused by delta-computing from `usage`
      // (session-cumulative). With perCallUsage each message_end carries the
      // exact pressure of its own API call — so multi-message turns do not
      // balloon the displayed percentage.
      state.sessionStats.contextWindow = 100_000;
      sendMessage({ type: "agent_start" });

      // Internal call 1: 10000 → 10%
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 10000, output: 2000, cacheRead: 0, cacheWrite: 0 },
          perCallUsage: { input: 10000, output: 2000, cacheRead: 0, cacheWrite: 0, totalTokens: 12000 },
        },
      });
      expect(state.sessionStats.contextPercent).toBe(12);

      // Internal call 2: 20000 → 20% (NOT 32% — per-call replaces, not sums)
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 30000, output: 4000, cacheRead: 0, cacheWrite: 0 },
          perCallUsage: { input: 20000, output: 2000, cacheRead: 0, cacheWrite: 0, totalTokens: 22000 },
        },
      });
      expect(state.sessionStats.contextPercent).toBe(22);
      expect(state.sessionStats.contextTokens).toBe(22000);
    });

    it("computes contextPercent via delta fallback when perCallUsage is absent", () => {
      // When perCallUsage is missing (legacy upstream), the handler falls back
      // to computing a delta from the previous message_end's cumulative usage.
      state.sessionStats.contextWindow = 100_000;
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 40000, output: 5000, cacheRead: 10000, cacheWrite: 0 },
        },
      });
      // Delta from prior test's cumulative usage (input:30000, output:4000):
      // (40000-30000) + (5000-4000) + (10000-0) + (0-0) = 21000
      expect(state.sessionStats.contextTokens).toBe(21000);
      expect(state.sessionStats.contextPercent).toBe(21);
    });

    it("updates contextWindow even when perCallUsage is absent", () => {
      // Context window resolution is independent of per-call data — we still
      // want header chrome to know the model's capacity.
      state.model = { id: "claude-sonnet-4-6", name: "Sonnet", provider: "anthropic", contextWindow: 180_000 };
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        },
      });
      expect(state.sessionStats.contextWindow).toBe(180_000);
    });

    it("handles message_end with stopReason:error without crashing", () => {
      sendMessage({ type: "agent_start" });
      sendMessage({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "API key expired",
        },
      });
      expect(state.currentTurn).toBeTruthy();
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
      sendMessage({ type: "agent_start" });
      const turnId = state.currentTurn!.id;
      sendMessage({ type: "turn_start" });
      expect(state.currentTurn!.id).toBe(turnId);
    });
  });

  // ============================================================
  // message_update deltas
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
      expect(state.thinkingLevel).toBe("off");
    });
  });
});
