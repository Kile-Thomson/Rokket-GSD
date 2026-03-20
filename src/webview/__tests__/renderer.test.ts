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
  sanitizeAndPostProcess: (html: string) => html,
  lexMarkdown: (text: string) => {
    // Simple mock lexer: split on double newlines to produce paragraph-like tokens
    if (!text) return Object.assign([], { links: {} });
    const blocks = text.split(/\n\n+/).filter(Boolean);
    const tokens = blocks.map((b, i) => ({
      type: "paragraph" as const,
      raw: b,
      text: b,
      tokens: [{ type: "text", raw: b, text: b }],
    }));
    return Object.assign(tokens, { links: {} });
  },
  parseTokens: (tokens: any[]) => tokens.map((t: any) => `<p>${t.text || t.raw || ""}</p>`).join("\n"),
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
      expect(welcomeScreen.classList.contains("gsd-hidden")).toBe(true);
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
      expect((toolEl as HTMLElement)!.dataset.toolId).toBe("tc-1");
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

  // ============================================================
  // Incremental rendering
  // ============================================================

  describe("incremental rendering", () => {
    /**
     * Helper: simulate streaming by appending small deltas and flushing rAF
     * after each chunk. Returns the `.gsd-assistant-text` element.
     */
    function streamText(fullText: string, chunkSize: number): HTMLElement {
      startTurn();
      ensureCurrentTurnElement();
      for (let i = 0; i < fullText.length; i += chunkSize) {
        const delta = fullText.slice(i, i + chunkSize);
        appendToTextSegment("text", delta);
        vi.advanceTimersByTime(16); // flush rAF
      }
      return messagesContainer.querySelector(".gsd-assistant-text")!;
    }

    it("streams multi-paragraph text into frozen blocks plus trailing", () => {
      // Two paragraphs separated by double newline.
      // Mock lexer splits on \n\n → produces two tokens.
      // The first paragraph should freeze as [data-block-idx="0"],
      // the second remains as [data-block-trailing].
      const text = "Hello world\n\nSecond paragraph";
      const el = streamText(text, 5);

      const frozenBlocks = el.querySelectorAll("[data-block-idx]");
      const trailing = el.querySelector("[data-block-trailing]");

      expect(frozenBlocks.length).toBe(1);
      expect(frozenBlocks[0].getAttribute("data-block-idx")).toBe("0");
      expect(frozenBlocks[0].innerHTML).toContain("Hello world");
      expect(trailing).toBeTruthy();
      expect(trailing!.innerHTML).toContain("Second paragraph");
    });

    it("keeps a fenced code block as single in-progress token until complete", () => {
      // Simulate streaming a fenced code block line by line.
      // The mock lexer won't see \n\n inside the code fence, so the entire
      // block is one token — it stays as [data-block-trailing] the whole time.
      const codeFence = "```js\nconsole.log(\"hi\")\n```";
      const el = streamText(codeFence, 10);

      const frozenBlocks = el.querySelectorAll("[data-block-idx]");
      const trailing = el.querySelector("[data-block-trailing]");

      // No frozen blocks — the whole code fence is a single token (last = in-progress)
      expect(frozenBlocks.length).toBe(0);
      expect(trailing).toBeTruthy();
      expect(trailing!.innerHTML).toBeTruthy();
    });

    it("freezes code block when followed by another paragraph", () => {
      // Code block followed by a paragraph — the code block becomes the first
      // token (frozen), the paragraph is the trailing token.
      const text = "```js\nconsole.log(\"hi\")\n```\n\nAfter the code";
      const el = streamText(text, 8);

      const frozenBlocks = el.querySelectorAll("[data-block-idx]");
      const trailing = el.querySelector("[data-block-trailing]");

      expect(frozenBlocks.length).toBe(1);
      expect(trailing).toBeTruthy();
      expect(trailing!.innerHTML).toContain("After the code");
    });

    it("streams a markdown table and renders it after completion", () => {
      // Table with a paragraph after it. The mock lexer splits on \n\n.
      // The table portion is one block, the trailing text is another.
      const table = "| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |";
      const text = table + "\n\nSummary row below";
      const el = streamText(text, 10);

      const frozenBlocks = el.querySelectorAll("[data-block-idx]");
      const trailing = el.querySelector("[data-block-trailing]");

      // Table is frozen as first block, summary is trailing
      expect(frozenBlocks.length).toBe(1);
      expect(frozenBlocks[0].innerHTML).toContain("| A | B | C |");
      expect(trailing).toBeTruthy();
      expect(trailing!.innerHTML).toContain("Summary row below");
    });

    it("handles split bold text across deltas without premature tag closing", () => {
      // Stream bold text in two chunks that split the ** markers.
      // Since the mock lexer produces a single paragraph token (no \n\n),
      // the entire text stays as trailing until finalized.
      // The key assertion: the final content has the complete bold markers.
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "**bold te");
      vi.advanceTimersByTime(16);
      appendToTextSegment("text", "xt**");
      vi.advanceTimersByTime(16);

      const el = messagesContainer.querySelector(".gsd-assistant-text")!;
      const trailing = el.querySelector("[data-block-trailing]");

      expect(trailing).toBeTruthy();
      // The mock parseTokens wraps in <p>, so check that the full bold markers
      // are present in the rendered text (no premature closing)
      expect(trailing!.innerHTML).toContain("**bold text**");
    });

    it("produces same final content as renderMarkdown for roundtrip equivalence", () => {
      // For a complex markdown string, verify incremental render produces
      // the same effective text content as a full-pass render would.
      const complexMd = "First paragraph\n\nSecond paragraph\n\nThird paragraph";

      // Incremental render via streaming
      const el = streamText(complexMd, 6);

      // Collect all rendered text from frozen blocks + trailing
      const allBlocks = el.querySelectorAll("[data-block-idx]");
      const trailing = el.querySelector("[data-block-trailing]");

      const incrementalParts: string[] = [];
      allBlocks.forEach((b) => incrementalParts.push(b.textContent || ""));
      if (trailing) incrementalParts.push(trailing.textContent || "");
      const incrementalText = incrementalParts.join("");

      // Full-pass: the mock renderMarkdown wraps in <p>text</p>
      // The mock lexer splits into 3 tokens, parseTokens wraps each in <p>
      // So incremental should contain all three paragraphs
      expect(incrementalText).toContain("First paragraph");
      expect(incrementalText).toContain("Second paragraph");
      expect(incrementalText).toContain("Third paragraph");

      // Verify structure: 2 frozen blocks + 1 trailing = 3 total blocks
      expect(allBlocks.length).toBe(2);
      expect(trailing).toBeTruthy();
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
      // Thinking uses textContent — no [data-block-idx] or [data-block-trailing] children
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
      // Element may or may not exist — but no crash
      if (el) {
        // If element exists, trailing should be empty or not present
        const trailing = el.querySelector("[data-block-trailing]");
        if (trailing) {
          expect(trailing.innerHTML).toBe("");
        }
      }
    });

    it("advances frozenBlockCount correctly as paragraphs complete", () => {
      // Stream 4 paragraphs one at a time, verifying frozen count increases
      startTurn();
      ensureCurrentTurnElement();

      // Stream first paragraph only — no frozen blocks yet (it's the only token = trailing)
      appendToTextSegment("text", "Para one");
      vi.advanceTimersByTime(16);
      let el = messagesContainer.querySelector(".gsd-assistant-text")!;
      expect(el.querySelectorAll("[data-block-idx]").length).toBe(0);
      expect(el.querySelector("[data-block-trailing]")).toBeTruthy();

      // Add second paragraph — first freezes, second is trailing
      appendToTextSegment("text", "\n\nPara two");
      vi.advanceTimersByTime(16);
      expect(el.querySelectorAll("[data-block-idx]").length).toBe(1);
      expect(el.querySelector("[data-block-trailing]")!.innerHTML).toContain("Para two");

      // Add third paragraph — first two frozen, third is trailing
      appendToTextSegment("text", "\n\nPara three");
      vi.advanceTimersByTime(16);
      expect(el.querySelectorAll("[data-block-idx]").length).toBe(2);
      expect(el.querySelector("[data-block-trailing]")!.innerHTML).toContain("Para three");
    });
  });
});
