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

import { init, addSystemEntry } from "../../message-handler";
import * as renderer from "../../renderer";
import * as uiDialogs from "../../ui-dialogs";
import * as autoProgress from "../../auto-progress";
import * as keyboard from "../../keyboard";

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

describe("ui-notification-handlers", () => {
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

  describe("addSystemEntry", () => {
    it("creates a system entry and renders it", () => {
      addSystemEntry("Test alert", "warning");
      expect(state.entries.length).toBe(1);
      expect(state.entries[0].systemText).toBe("Test alert");
      expect(state.entries[0].systemKind).toBe("warning");
      expect(renderer.renderNewEntry).toHaveBeenCalled();
    });
  });

  describe("error boundary", () => {
    it("catches handler errors and surfaces them as system entries", () => {
      vi.mocked(renderer.renderNewEntry).mockImplementationOnce(() => {
        throw new Error("DOM exploded");
      });
      sendMessage({ type: "error", message: "test error" });
      const hasErrorEntry = state.entries.some(
        (e) => e.systemKind === "error" && e.systemText?.includes("Internal error"),
      );
      expect(hasErrorEntry).toBe(true);
    });
  });

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

  describe("changelog message", () => {
    it("calls dismissChangelog with silent flag before rendering content", () => {
      sendMessage({
        type: "changelog",
        entries: [{ version: "1.0.0", notes: "Initial release", date: "2026-01-01" }],
      });
      expect(keyboard.dismissChangelog).toHaveBeenCalledWith({ silent: true });
      const card = messagesContainer.querySelector("#gsd-changelog");
      expect(card).toBeTruthy();
    });

    it("does not leave orphaned handlers when replacing loader", () => {
      const loader = document.createElement("div");
      loader.id = "gsd-changelog";
      messagesContainer.appendChild(loader);
      sendMessage({
        type: "changelog",
        entries: [{ version: "2.0.0", notes: "Update", date: "2026-04-01" }],
      });
      expect(keyboard.dismissChangelog).toHaveBeenCalledWith({ silent: true });
      expect(keyboard.setChangelogHandlers).toHaveBeenCalled();
    });
  });

  describe("process_exit (resets tracking)", () => {
    it("resets session tracking state on process exit", () => {
      sendMessage({
        type: "cost_update",
        data: {
          tokens: { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0 },
          cumulativeCost: 0.10,
        },
      });
      expect(state.sessionStats.tokens?.input).toBe(5000);
      sendMessage({ type: "process_exit", code: 0 });
      expect(state.isStreaming).toBe(false);
      expect(state.currentTurn).toBeNull();
      expect(state.processHealth).toBe("responsive");
    });
  });

  describe("error message", () => {
    it("handles error message without crashing", () => {
      expect(() => {
        sendMessage({ type: "error", message: "Something went wrong" });
      }).not.toThrow();
    });
  });

  describe("extension_ui_request (widgets)", () => {
    it("handles setWidget without crashing when no container", () => {
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
