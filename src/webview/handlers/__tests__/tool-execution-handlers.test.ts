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
  createParallelBatch: vi.fn(),
  expandParallelBatch: vi.fn(),
  syncBatchState: vi.fn(),
  updateParallelBatchStatus: vi.fn(),
  finalizeParallelBatch: vi.fn(),
  clearActiveBatch: vi.fn(),
  getActiveBatchElement: vi.fn(() => null),
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
  state.loadedSkills.clear();
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

describe("tool-execution-handlers", () => {
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
  // tool_execution lifecycle
  // ============================================================

  describe("tool_execution lifecycle", () => {
    it("tracks tool from start through update to end", () => {
      sendMessage({ type: "agent_start" });
      vi.clearAllMocks();

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

      sendMessage({
        type: "tool_execution_update",
        toolCallId: "t1",
        partialResult: { content: [{ text: "partial data" }] },
      });
      expect(tc.resultText).toBe("partial data");

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

      sendMessage({ type: "tool_execution_start", toolCallId: "t1", toolName: "Read", args: {} });
      expect(state.currentTurn!.toolCalls.get("t1")!.isParallel).toBeFalsy();

      sendMessage({ type: "tool_execution_start", toolCallId: "t2", toolName: "Bash", args: {} });
      expect(state.currentTurn!.toolCalls.get("t2")!.isParallel).toBe(true);
      expect(state.currentTurn!.toolCalls.get("t1")!.isParallel).toBe(true);
    });
  });

  // ============================================================
  // skill detection
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
});
