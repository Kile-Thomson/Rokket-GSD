// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { state } from "../state";

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
  announceToScreenReader: vi.fn(),
}));

import { init } from "../message-handler";

let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;
let promptInput: HTMLTextAreaElement;
let mockVscode: { postMessage: ReturnType<typeof vi.fn> };

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

describe("message-handler routing", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    messagesContainer = document.createElement("div");
    welcomeScreen = document.createElement("div");
    promptInput = document.createElement("textarea") as HTMLTextAreaElement;
    document.body.appendChild(messagesContainer);
    document.body.appendChild(welcomeScreen);
    document.body.appendChild(promptInput);

    mockVscode = { postMessage: vi.fn() };

    resetState();
    vi.clearAllMocks();

    init({
      vscode: mockVscode,
      messagesContainer,
      welcomeScreen,
      promptInput,
      updateAllUI: vi.fn(),
      updateHeaderUI: vi.fn(),
      updateFooterUI: vi.fn(),
      updateInputUI: vi.fn(),
      updateOverlayIndicators: vi.fn(),
      updateWorkflowBadge: vi.fn(),
      handleModelRouted: vi.fn(),
      autoResize: vi.fn(),
    });
  });

  afterEach(() => {
    resetState();
  });

  it("initializes without error", () => {
    expect(state.processStatus).toBe("stopped");
  });

  it("routes known message types without throwing", () => {
    expect(() => sendMessage({ type: "config", cwd: "/test" })).not.toThrow();
    expect(() => sendMessage({ type: "state", data: { model: null } })).not.toThrow();
    expect(() => sendMessage({ type: "agent_start" })).not.toThrow();
    expect(() => sendMessage({ type: "agent_end" })).not.toThrow();
  });

  it("handles unknown message types gracefully", () => {
    expect(() => sendMessage({ type: "unknown_type_xyz" })).not.toThrow();
  });
});
