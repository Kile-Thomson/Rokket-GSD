// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { init, handleNewConversation } from "../keyboard";
import { state } from "../state";
import type { KeyboardDeps } from "../keyboard";

// Mock all imported modules that keyboard.ts uses internally
vi.mock("../helpers", () => ({
  scrollToBottom: vi.fn(),
  sanitizeUrl: (url: string) => url,
}));

vi.mock("../slash-menu", () => ({
  isVisible: vi.fn(() => false),
  hide: vi.fn(),
  navigateDown: vi.fn(),
  navigateUp: vi.fn(),
  selectCurrent: vi.fn(),
}));

vi.mock("../model-picker", () => ({
  isVisible: vi.fn(() => false),
  hide: vi.fn(),
}));

vi.mock("../thinking-picker", () => ({
  isVisible: vi.fn(() => false),
  hide: vi.fn(),
}));

vi.mock("../session-history", () => ({
  isVisible: vi.fn(() => false),
  hide: vi.fn(),
  handleKeyDown: vi.fn(() => false),
}));

vi.mock("../visualizer", () => ({
  isVisible: vi.fn(() => false),
  handleKeyDown: vi.fn(() => false),
}));

vi.mock("../toasts", () => ({
  show: vi.fn(),
}));

vi.mock("../renderer", () => ({
  resetStreamingState: vi.fn(),
  clearMessages: vi.fn(),
}));

// ============================================================
// Helpers
// ============================================================

let deps: KeyboardDeps;
let mockVscode: { postMessage: ReturnType<typeof vi.fn> };
let mockSendMessage: ReturnType<typeof vi.fn>;
let mockUpdateAllUI: ReturnType<typeof vi.fn>;
let mockAutoResize: ReturnType<typeof vi.fn>;

function createDeps(): KeyboardDeps {
  mockVscode = { postMessage: vi.fn() };
  mockSendMessage = vi.fn();
  mockUpdateAllUI = vi.fn();
  mockAutoResize = vi.fn();

  return {
    vscode: mockVscode,
    messagesContainer: document.createElement("div"),
    welcomeScreen: document.createElement("div"),
    promptInput: document.createElement("textarea") as HTMLTextAreaElement,
    sendBtn: document.createElement("button"),
    headerVersion: document.createElement("span"),
    newConvoBtn: document.createElement("button"),
    compactBtn: document.createElement("button"),
    exportBtn: document.createElement("button"),
    attachBtn: document.createElement("button"),
    thinkingBadge: document.createElement("span"),
    sendMessage: mockSendMessage,
    updateAllUI: mockUpdateAllUI,
    autoResize: mockAutoResize,
  };
}

function resetState(): void {
  state.isStreaming = false;
  state.useCtrlEnterToSend = false;
  state.entries = [];
  state.currentTurn = null;
  state.sessionStats = {};
  state.theme = "classic";
}

function fireKeydown(target: EventTarget, key: string, opts: Partial<KeyboardEventInit> = {}): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
}

// ============================================================
// Tests
// ============================================================

describe("keyboard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    deps = createDeps();
    document.body.appendChild(deps.promptInput);
    document.body.appendChild(deps.sendBtn);
    document.body.appendChild(deps.messagesContainer);
    init(deps);
  });

  // ----------------------------------------------------------
  // Enter to send
  // ----------------------------------------------------------

  describe("Enter key sends message", () => {
    it("calls sendMessage on Enter (default mode)", () => {
      deps.promptInput.value = "hello";
      fireKeydown(deps.promptInput, "Enter");
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it("does not send on Shift+Enter (allows newline)", () => {
      deps.promptInput.value = "hello";
      fireKeydown(deps.promptInput, "Enter", { shiftKey: true });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("sends on Ctrl+Enter when useCtrlEnterToSend is true", () => {
      state.useCtrlEnterToSend = true;
      deps.promptInput.value = "hello";
      fireKeydown(deps.promptInput, "Enter", { ctrlKey: true });
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it("does not send on plain Enter when useCtrlEnterToSend is true", () => {
      state.useCtrlEnterToSend = true;
      deps.promptInput.value = "hello";
      fireKeydown(deps.promptInput, "Enter");
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // Escape while streaming
  // ----------------------------------------------------------

  describe("Escape while streaming", () => {
    it("sends interrupt when streaming", () => {
      state.isStreaming = true;
      fireKeydown(deps.promptInput, "Escape");
      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "interrupt" });
    });

    it("does not send interrupt when not streaming", () => {
      state.isStreaming = false;
      fireKeydown(deps.promptInput, "Escape");
      // No interrupt message (might still be called for other reasons, but not interrupt)
      const calls = mockVscode.postMessage.mock.calls;
      const interruptCalls = calls.filter((c: any) => c[0]?.type === "interrupt");
      expect(interruptCalls).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------
  // Slash menu keyboard integration
  // ----------------------------------------------------------

  describe("slash menu keyboard when visible", () => {
    it("navigates down on ArrowDown when slash menu is visible", async () => {
      const slashMenu = await import("../slash-menu");
      vi.mocked(slashMenu.isVisible).mockReturnValue(true);
      fireKeydown(deps.promptInput, "ArrowDown");
      expect(slashMenu.navigateDown).toHaveBeenCalled();
    });

    it("navigates up on ArrowUp when slash menu is visible", async () => {
      const slashMenu = await import("../slash-menu");
      vi.mocked(slashMenu.isVisible).mockReturnValue(true);
      fireKeydown(deps.promptInput, "ArrowUp");
      expect(slashMenu.navigateUp).toHaveBeenCalled();
    });

    it("selects current on Enter when slash menu is visible", async () => {
      const slashMenu = await import("../slash-menu");
      vi.mocked(slashMenu.isVisible).mockReturnValue(true);
      fireKeydown(deps.promptInput, "Enter");
      expect(slashMenu.selectCurrent).toHaveBeenCalled();
      // sendMessage should NOT be called — slash menu consumes Enter
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("hides slash menu on Escape", async () => {
      const slashMenu = await import("../slash-menu");
      vi.mocked(slashMenu.isVisible).mockReturnValue(true);
      fireKeydown(deps.promptInput, "Escape");
      expect(slashMenu.hide).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // Send button click
  // ----------------------------------------------------------

  describe("send button click", () => {
    it("calls sendMessage when not streaming", () => {
      state.isStreaming = false;
      deps.sendBtn.click();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it("sends interrupt when streaming", () => {
      state.isStreaming = true;
      deps.sendBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "interrupt" });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // New conversation button
  // ----------------------------------------------------------

  describe("new conversation button", () => {
    it("triggers handleNewConversation on click", () => {
      deps.newConvoBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "new_conversation" });
    });
  });

  // ----------------------------------------------------------
  // handleNewConversation
  // ----------------------------------------------------------

  describe("handleNewConversation", () => {
    it("resets state and shows welcome screen", () => {
      state.entries = [{ id: "1", type: "user", text: "hi", timestamp: 1 }];
      state.sessionStats = { cost: 5 };
      deps.welcomeScreen.classList.add("gsd-hidden");

      handleNewConversation();

      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "new_conversation" });
      expect(state.entries).toEqual([]);
      expect(state.currentTurn).toBeNull();
      expect(state.sessionStats).toEqual({});
      expect(deps.welcomeScreen.classList.contains("gsd-hidden")).toBe(false);
      expect(mockUpdateAllUI).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // Compact button
  // ----------------------------------------------------------

  describe("compact button", () => {
    it("sends compact_context when not streaming", () => {
      state.isStreaming = false;
      deps.compactBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "compact_context" });
    });

    it("does nothing when streaming", () => {
      state.isStreaming = true;
      deps.compactBtn.click();
      const compactCalls = mockVscode.postMessage.mock.calls.filter(
        (c: any) => c[0]?.type === "compact_context"
      );
      expect(compactCalls).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------
  // Attach button
  // ----------------------------------------------------------

  describe("attach button", () => {
    it("sends attach_files message on click", () => {
      deps.attachBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith({ type: "attach_files" });
    });
  });
});
