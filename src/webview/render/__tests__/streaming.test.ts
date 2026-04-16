// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { init } from "../../renderer";
import {
  clearMessages,
  renderNewEntry,
  ensureCurrentTurnElement,
  appendToTextSegment,
  appendToolSegmentElement,
  updateToolSegmentElement,
} from "../streaming";
import { resetStreamingState } from "../batches";

import {
  state,
  nextId,
  type ChatEntry,
  type ToolCallState,
  type AssistantTurn,
} from "../../state";

vi.mock("../../helpers", () => ({
  escapeHtml: (s: string) => s,
  escapeAttr: (s: string) => s,
  formatDuration: (ms: number) => `${ms}ms`,
  formatRelativeTime: () => "just now",
  formatTokens: (n: number) => String(n),
  getToolCategory: () => "generic",
  getToolIcon: () => "🔧",
  getToolKeyArg: () => "",
  formatToolResult: (_n: string, t: string) => t,
  buildSubagentOutputHtml: () => "<div class=\"gsd-subagent-panel\"><div class=\"gsd-subagent-summary\"><span class=\"gsd-subagent-mode\">Parallel</span><span class=\"gsd-subagent-counts\"></span><span class=\"gsd-subagent-total\">0/0</span></div><div class=\"gsd-agent-cards\"></div></div>",
  buildUsagePills: () => "",
  renderMarkdown: (t: string) => `<p>${t}</p>`,
  sanitizeAndPostProcess: (html: string) => html,
  lexMarkdown: (text: string) => {
    if (!text) return Object.assign([], { links: {} });
    const blocks = text.split(/\n\n+/).filter(Boolean);
    const tokens = blocks.map((b, _i) => ({
      type: "paragraph" as const,
      raw: b,
      text: b,
      tokens: [{ type: "text", raw: b, text: b }],
    }));
    return Object.assign(tokens, { links: {} });
  },
  parseTokens: (tokens: Array<{ text?: string; raw?: string }>) => tokens.map((t) => `<p>${t.text || t.raw || ""}</p>`).join("\n"),
  scrollToBottom: vi.fn(),
  resetAutoScroll: vi.fn(),
}));

vi.mock("../../tool-grouping", () => ({
  groupConsecutiveTools: (segs: unknown[]) => segs.map((s) => ({ type: "single", segment: s })),
  buildGroupSummaryLabel: () => "tools",
  shouldCollapseWithPredecessor: () => false,
  collapseToolIntoGroup: vi.fn(),
}));

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

describe("streaming", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    messagesContainer = document.createElement("div");
    messagesContainer.id = "messages";
    welcomeScreen = document.createElement("div");
    welcomeScreen.id = "welcome";
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

    it("inserts user message after current streaming element without splitting", () => {
      startTurn();
      ensureCurrentTurnElement();
      renderNewEntry(makeUserEntry("Interrupt"));
      const entries = messagesContainer.querySelectorAll(".gsd-entry");
      expect(entries.length).toBe(2);
      expect(entries[0].classList.contains("gsd-entry-assistant")).toBe(true);
      expect(entries[0].classList.contains("streaming")).toBe(true);
      expect(entries[1].classList.contains("gsd-entry-user")).toBe(true);
    });
  });

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
      expect(welcomeScreen.classList.contains("gsd-hidden")).toBe(true);
    });

    it("returns the same element on repeated calls (idempotent)", () => {
      startTurn();
      const el1 = ensureCurrentTurnElement();
      const el2 = ensureCurrentTurnElement();
      expect(el1).toBe(el2);
    });
  });

  describe("appendToTextSegment", () => {
    it("does nothing when currentTurn is null", () => {
      state.currentTurn = null;
      appendToTextSegment("text", "hello");
    });

    it("creates a text segment and renders via rAF", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "hello ");
      appendToTextSegment("text", "world");
      expect(state.currentTurn!.segments.length).toBe(1);
      expect(state.currentTurn!.segments[0].type).toBe("text");
      vi.advanceTimersByTime(16);
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

    it("does not affect thinking segments — they still use textContent", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("thinking", "Step 1: analyze the problem");
      vi.advanceTimersByTime(16);
      const thinkingBlock = messagesContainer.querySelector(".gsd-thinking-block");
      expect(thinkingBlock).toBeTruthy();
      const thinkingContent = thinkingBlock!.querySelector(".gsd-thinking-content");
      expect(thinkingContent).toBeTruthy();
      expect(thinkingContent!.textContent).toBe("Step 1: analyze the problem");
      expect(thinkingBlock!.querySelectorAll("[data-block-idx]").length).toBe(0);
      expect(thinkingBlock!.querySelectorAll("[data-block-trailing]").length).toBe(0);
    });

    it("handles empty text deltas without errors", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "");
      vi.advanceTimersByTime(16);
      const el = messagesContainer.querySelector(".gsd-assistant-text");
      if (el) {
        const trailing = el.querySelector("[data-block-trailing]");
        if (trailing) {
          expect(trailing.innerHTML).toBe("");
        }
      }
    });
  });

  describe("appendToolSegmentElement", () => {
    it("creates a tool segment DOM element", () => {
      startTurn();
      ensureCurrentTurnElement();
      const tc = makeToolCall("tc-1", "Read");
      state.currentTurn!.toolCalls.set(tc.id, tc);
      appendToolSegmentElement(tc, 0);
      const toolEl = messagesContainer.querySelector(".gsd-tool-segment");
      expect(toolEl).toBeTruthy();
      expect((toolEl as HTMLElement)!.dataset.toolId).toBe("tc-1");
    });
  });

  describe("updateToolSegmentElement", () => {
    it("updates an existing tool segment's HTML", () => {
      startTurn();
      ensureCurrentTurnElement();
      const tc = makeToolCall("tc-2", "Bash");
      state.currentTurn!.toolCalls.set(tc.id, tc);
      state.currentTurn!.segments.push({ type: "tool", toolCallId: tc.id });
      appendToolSegmentElement(tc, 0);
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
      updateToolSegmentElement("nonexistent");
    });
  });

  describe("resetStreamingState", () => {
    it("clears module-level streaming state without affecting entries", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "partial");
      vi.advanceTimersByTime(16);
      state.entries.push(makeUserEntry());
      resetStreamingState();
      expect(state.entries.length).toBe(1);
      startTurn();
      const el = ensureCurrentTurnElement();
      expect(el.classList.contains("streaming")).toBe(true);
    });
  });
});
