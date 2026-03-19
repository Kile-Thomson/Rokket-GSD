// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  init,
  clearMessages,
  renderNewEntry,
  ensureCurrentTurnElement,
  appendToTextSegment,
  appendToolSegmentElement,
  updateToolSegmentElement,
  finalizeCurrentTurn,
  resetStreamingState,
} from "../renderer";

import { state, nextId, type ChatEntry, type ToolCallState, type AssistantTurn } from "../state";

// ============================================================
// Mock cross-module imports
// ============================================================

vi.mock("../helpers", () => ({
  escapeHtml: (s: string) => s,
  escapeAttr: (s: string) => s,
  formatDuration: (ms: number) => `${ms}ms`,
  formatRelativeTime: () => "just now",
  formatTokens: (n: number) => String(n),
  getToolCategory: () => "generic",
  getToolIcon: () => "🔧",
  getToolKeyArg: () => "",
  formatToolResult: (_n: string, t: string) => t,
  buildSubagentOutputHtml: () => "<div>subagent</div>",
  renderMarkdown: (t: string) => `<p>${t}</p>`,
  scrollToBottom: vi.fn(),
  resetAutoScroll: vi.fn(),
}));

vi.mock("../tool-grouping", () => ({
  groupConsecutiveTools: (segs: unknown[]) => segs.map((s) => ({ type: "single", segment: s })),
  buildGroupSummaryLabel: () => "tools",
  shouldCollapseWithPredecessor: () => false,
  collapseToolIntoGroup: vi.fn(),
}));

// ============================================================
// Helpers
// ============================================================

let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;

function resetState(): void {
  state.entries = [];
  state.currentTurn = null;
  state.isStreaming = false;
}

function makeUserEntry(text = "Hello"): ChatEntry {
  return { id: nextId(), type: "user", text, timestamp: Date.now() };
}

function makeAssistantEntry(): ChatEntry {
  const turn: AssistantTurn = {
    id: nextId(),
    segments: [{ type: "text", chunks: ["Hi there"] }],
    toolCalls: new Map(),
    isComplete: true,
    timestamp: Date.now(),
  };
  return { id: nextId(), type: "assistant", turn, timestamp: Date.now() };
}

function makeSystemEntry(text = "System msg"): ChatEntry {
  return { id: nextId(), type: "system", systemText: text, systemKind: "info", timestamp: Date.now() };
}

function makeToolCall(id = "tc-1", name = "Read"): ToolCallState {
  return {
    id,
    name,
    args: { path: "foo.ts" },
    resultText: "",
    isError: false,
    isRunning: true,
    startTime: Date.now(),
  };
}

function startTurn(): void {
  state.currentTurn = {
    id: nextId(),
    segments: [],
    toolCalls: new Map(),
    isComplete: false,
    timestamp: Date.now(),
  };
}

// ============================================================
// Tests
// ============================================================

describe("renderer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    messagesContainer = document.createElement("div");
    messagesContainer.id = "messages";
    welcomeScreen = document.createElement("div");
    welcomeScreen.id = "welcome";
    welcomeScreen.style.display = "block";
    document.body.appendChild(messagesContainer);
    document.body.appendChild(welcomeScreen);

    init({ messagesContainer, welcomeScreen });
    resetState();
    resetStreamingState();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetState();
    resetStreamingState();
  });

  // ============================================================
  // clearMessages
  // ============================================================

  describe("clearMessages", () => {
    it("removes all .gsd-entry elements from the container", () => {
      const entry = document.createElement("div");
      entry.className = "gsd-entry";
      messagesContainer.appendChild(entry);
      expect(messagesContainer.querySelectorAll(".gsd-entry").length).toBe(1);
      clearMessages();
      expect(messagesContainer.querySelectorAll(".gsd-entry").length).toBe(0);
    });

    it("leaves non-entry elements intact", () => {
      const other = document.createElement("div");
      other.className = "other";
      messagesContainer.appendChild(other);
      clearMessages();
      expect(messagesContainer.querySelector(".other")).toBeTruthy();
    });
  });

  // ============================================================
  // renderNewEntry
  // ============================================================

  describe("renderNewEntry", () => {
    it("renders a user entry", () => {
      renderNewEntry(makeUserEntry("Test message"));
      const el = messagesContainer.querySelector(".gsd-entry-user");
      expect(el).toBeTruthy();
      expect(el!.textContent).toContain("Test message");
    });

    it("renders an assistant entry", () => {
      renderNewEntry(makeAssistantEntry());
      const el = messagesContainer.querySelector(".gsd-entry-assistant");
      expect(el).toBeTruthy();
    });

    it("renders a system entry", () => {
      renderNewEntry(makeSystemEntry("Alert!"));
      const el = messagesContainer.querySelector(".gsd-entry-system");
      expect(el).toBeTruthy();
      expect(el!.textContent).toContain("Alert!");
    });

    it("inserts user message after current streaming element and creates continuation", () => {
      startTurn();
      ensureCurrentTurnElement();
      renderNewEntry(makeUserEntry("Interrupt"));
      // Should have: streaming element, user bubble, continuation element
      const entries = messagesContainer.querySelectorAll(".gsd-entry");
      expect(entries.length).toBe(3);
      expect(entries[1].classList.contains("gsd-entry-user")).toBe(true);
      expect(entries[2].classList.contains("gsd-entry-assistant")).toBe(true);
      expect(entries[2].classList.contains("streaming")).toBe(true);
    });
  });

  // ============================================================
  // ensureCurrentTurnElement
  // ============================================================

  describe("ensureCurrentTurnElement", () => {
    it("creates a streaming assistant element", () => {
      startTurn();
      const el = ensureCurrentTurnElement();
      expect(el.classList.contains("gsd-entry-assistant")).toBe(true);
      expect(el.classList.contains("streaming")).toBe(true);
    });

    it("hides welcome screen", () => {
      startTurn();
      ensureCurrentTurnElement();
      expect(welcomeScreen.style.display).toBe("none");
    });

    it("returns the same element on repeated calls (idempotent)", () => {
      startTurn();
      const el1 = ensureCurrentTurnElement();
      const el2 = ensureCurrentTurnElement();
      expect(el1).toBe(el2);
    });
  });

  // ============================================================
  // appendToTextSegment
  // ============================================================

  describe("appendToTextSegment", () => {
    it("does nothing when currentTurn is null", () => {
      state.currentTurn = null;
      appendToTextSegment("text", "hello");
      // No crash, no segments
    });

    it("creates a text segment and renders via rAF", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "hello ");
      appendToTextSegment("text", "world");
      // Before rAF fires, segments exist in state
      expect(state.currentTurn!.segments.length).toBe(1);
      expect(state.currentTurn!.segments[0].type).toBe("text");
      // Fire rAF
      vi.advanceTimersByTime(16);
      // Check that content was rendered
      const textEl = messagesContainer.querySelector(".gsd-assistant-text");
      expect(textEl).toBeTruthy();
    });

    it("creates separate segments for different types", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "hello");
      appendToTextSegment("thinking", "hmm");
      expect(state.currentTurn!.segments.length).toBe(2);
      expect(state.currentTurn!.segments[0].type).toBe("text");
      expect(state.currentTurn!.segments[1].type).toBe("thinking");
    });
  });

  // ============================================================
  // appendToolSegmentElement
  // ============================================================

  describe("appendToolSegmentElement", () => {
    it("creates a tool segment DOM element", () => {
      startTurn();
      ensureCurrentTurnElement();
      const tc = makeToolCall("tc-1", "Read");
      state.currentTurn!.toolCalls.set(tc.id, tc);
      appendToolSegmentElement(tc, 0);
      const toolEl = messagesContainer.querySelector(".gsd-tool-segment");
      expect(toolEl).toBeTruthy();
      expect(toolEl!.dataset.toolId).toBe("tc-1");
    });
  });

  // ============================================================
  // updateToolSegmentElement
  // ============================================================

  describe("updateToolSegmentElement", () => {
    it("updates an existing tool segment's HTML", () => {
      startTurn();
      ensureCurrentTurnElement();
      const tc = makeToolCall("tc-2", "Bash");
      state.currentTurn!.toolCalls.set(tc.id, tc);
      state.currentTurn!.segments.push({ type: "tool", toolCallId: tc.id });
      appendToolSegmentElement(tc, 0);

      // Update the tool call
      tc.resultText = "done";
      tc.isRunning = false;
      tc.endTime = Date.now() + 1000;
      updateToolSegmentElement("tc-2");

      const toolEl = messagesContainer.querySelector('[data-tool-id="tc-2"]');
      expect(toolEl).toBeTruthy();
    });

    it("does nothing for unknown tool call ID", () => {
      startTurn();
      ensureCurrentTurnElement();
      // Should not throw
      updateToolSegmentElement("nonexistent");
    });
  });

  // ============================================================
  // finalizeCurrentTurn
  // ============================================================

  describe("finalizeCurrentTurn", () => {
    it("marks the turn as complete and adds to entries", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "response");
      vi.advanceTimersByTime(16);

      finalizeCurrentTurn();

      expect(state.currentTurn).toBeNull();
      const lastEntry = state.entries[state.entries.length - 1];
      expect(lastEntry.type).toBe("assistant");
      expect(lastEntry.turn!.isComplete).toBe(true);
    });

    it("removes streaming class from the element", () => {
      startTurn();
      const el = ensureCurrentTurnElement();
      expect(el.classList.contains("streaming")).toBe(true);
      finalizeCurrentTurn();
      expect(el.classList.contains("streaming")).toBe(false);
    });

    it("cancels pending rAF", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "data");
      // Don't advance timers — rAF is pending
      finalizeCurrentTurn();
      // Advancing now should not cause errors
      vi.advanceTimersByTime(16);
    });

    it("stops running tool calls", () => {
      startTurn();
      ensureCurrentTurnElement();
      const tc = makeToolCall("tc-fin", "Read");
      state.currentTurn!.toolCalls.set(tc.id, tc);
      expect(tc.isRunning).toBe(true);
      finalizeCurrentTurn();
      expect(tc.isRunning).toBe(false);
    });

    it("does nothing when no current turn", () => {
      state.currentTurn = null;
      // Should not throw
      finalizeCurrentTurn();
    });
  });

  // ============================================================
  // resetStreamingState
  // ============================================================

  describe("resetStreamingState", () => {
    it("clears module-level streaming state without affecting entries", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "partial");
      vi.advanceTimersByTime(16);

      // Add an entry so we can verify it persists
      state.entries.push(makeUserEntry());

      resetStreamingState();

      // Streaming state is reset but entries remain
      expect(state.entries.length).toBe(1);
      // Next ensureCurrentTurnElement should create a fresh element
      startTurn();
      const el = ensureCurrentTurnElement();
      expect(el.classList.contains("streaming")).toBe(true);
    });
  });
});
