// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  init,
  ensureCurrentTurnElement,
  appendToTextSegment,
  finalizeCurrentTurn,
  resetStreamingState,
} from "../../renderer";

import {
  state,
  nextId,
  MAX_ENTRIES,
  pruneOldEntries,
  resetPrunedCount,
  resetState as resetFullState,
  type ChatEntry,
  type ToolCallState,
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

describe("batches", () => {
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

    it("does not apply deferred updates after finalise", () => {
      startTurn();
      ensureCurrentTurnElement();
      appendToTextSegment("text", "data");
      finalizeCurrentTurn();
      const entryCountAfterFinalise = state.entries.length;
      vi.advanceTimersByTime(16);
      expect(state.currentTurn).toBeNull();
      expect(state.entries.length).toBe(entryCountAfterFinalise);
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
      const entriesBefore = state.entries.length;
      finalizeCurrentTurn();
      expect(state.currentTurn).toBeNull();
      expect(state.entries.length).toBe(entriesBefore);
    });
  });

  describe("entry cap", () => {
    beforeEach(() => {
      resetFullState();
    });

    function pushEntries(count: number): string[] {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const entry = makeUserEntry(`Message ${i}`);
        state.entries.push(entry);
        const el = document.createElement("div");
        el.className = "gsd-entry gsd-entry-user";
        el.setAttribute("data-entry-id", entry.id);
        el.textContent = entry.text!;
        messagesContainer.appendChild(el);
        ids.push(entry.id);
      }
      return ids;
    }

    it("does not prune when exactly at the cap (300 entries)", () => {
      pushEntries(MAX_ENTRIES);
      expect(state.entries.length).toBe(MAX_ENTRIES);
      const pruned = pruneOldEntries(messagesContainer);
      expect(pruned).toBe(0);
      expect(state.entries.length).toBe(MAX_ENTRIES);
      expect(messagesContainer.querySelector(".gsd-pruned-indicator")).toBeNull();
    });

    it("removes the oldest entry when one over the cap (301 entries)", () => {
      const ids = pushEntries(MAX_ENTRIES + 1);
      expect(state.entries.length).toBe(MAX_ENTRIES + 1);
      const pruned = pruneOldEntries(messagesContainer);
      expect(pruned).toBe(1);
      expect(state.entries.length).toBe(MAX_ENTRIES);
      expect(state.entries[0].id).toBe(ids[1]);
      expect(messagesContainer.querySelector(`[data-entry-id="${ids[0]}"]`)).toBeNull();
      expect(messagesContainer.querySelector(`[data-entry-id="${ids[1]}"]`)).toBeTruthy();
      const indicator = messagesContainer.querySelector(".gsd-pruned-indicator");
      expect(indicator).toBeTruthy();
      expect(indicator!.textContent).toContain("1 earlier messages removed");
    });

    it("prunes 100 entries when 400 are pushed, indicator shows correct count", () => {
      pushEntries(400);
      expect(state.entries.length).toBe(400);
      const pruned = pruneOldEntries(messagesContainer);
      expect(pruned).toBe(100);
      expect(state.entries.length).toBe(MAX_ENTRIES);
      const indicator = messagesContainer.querySelector(".gsd-pruned-indicator");
      expect(indicator).toBeTruthy();
      expect(indicator!.textContent).toBe("100 earlier messages removed to improve performance");
      expect(messagesContainer.querySelectorAll(".gsd-entry").length).toBe(MAX_ENTRIES);
    });

    it("adjusts scrollTop by the total height of pruned DOM elements", () => {
      const MOCK_HEIGHT = 50;
      pushEntries(MAX_ENTRIES + 5);
      const entries = messagesContainer.querySelectorAll(".gsd-entry");
      entries.forEach((el) => {
        Object.defineProperty(el, "offsetHeight", { value: MOCK_HEIGHT, configurable: true });
      });
      const initialScroll = 1000;
      messagesContainer.scrollTop = initialScroll;
      const pruned = pruneOldEntries(messagesContainer);
      expect(pruned).toBe(5);
      expect(messagesContainer.scrollTop).toBe(initialScroll - 5 * MOCK_HEIGHT);
    });

    it("accumulates pruned count across multiple prune calls", () => {
      pushEntries(310);
      pruneOldEntries(messagesContainer);
      let indicator = messagesContainer.querySelector(".gsd-pruned-indicator");
      expect(indicator!.textContent).toContain("10 earlier messages removed");
      pushEntries(20);
      pruneOldEntries(messagesContainer);
      indicator = messagesContainer.querySelector(".gsd-pruned-indicator");
      expect(indicator!.textContent).toBe("30 earlier messages removed to improve performance");
      expect(state.entries.length).toBe(MAX_ENTRIES);
    });

    it("resetState() clears pruned state and removes indicator from DOM", () => {
      pushEntries(MAX_ENTRIES + 10);
      pruneOldEntries(messagesContainer);
      expect(messagesContainer.querySelector(".gsd-pruned-indicator")).toBeTruthy();
      resetFullState();
      pushEntries(MAX_ENTRIES + 5);
      pruneOldEntries(messagesContainer);
      const indicator = messagesContainer.querySelector(".gsd-pruned-indicator");
      expect(indicator!.textContent).toBe("5 earlier messages removed to improve performance");
    });

    it("logs console.warn when entries are pruned", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        pushEntries(MAX_ENTRIES + 3);
        pruneOldEntries(messagesContainer);
        expect(warnSpy).toHaveBeenCalledWith(
          `GSD: Pruned 3 oldest entries to maintain ${MAX_ENTRIES}-entry cap`
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("resetPrunedCount() clears counter and hides indicator", () => {
      pushEntries(MAX_ENTRIES + 10);
      pruneOldEntries(messagesContainer);
      const indicator = messagesContainer.querySelector(".gsd-pruned-indicator");
      expect(indicator).toBeTruthy();
      expect(indicator!.textContent).toContain("10");
      resetPrunedCount();
      expect(messagesContainer.querySelector(".gsd-pruned-indicator")).toBeNull();
      pushEntries(5);
      pruneOldEntries(messagesContainer);
      const newIndicator = messagesContainer.querySelector(".gsd-pruned-indicator");
      // Pruning occurs since prior entries still in DOM push total over MAX_ENTRIES
      expect(newIndicator).not.toBeNull();
      expect(newIndicator!.textContent).toContain("5");
    });
  });
});
