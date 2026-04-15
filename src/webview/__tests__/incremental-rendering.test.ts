// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  init,
  ensureCurrentTurnElement,
  appendToTextSegment,
  resetStreamingState,
} from "../renderer";

import {
  state,
  nextId,
  type AssistantTurn,
} from "../state";

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
  buildSubagentOutputHtml: () =>
    '<div class="gsd-subagent-panel"><div class="gsd-subagent-summary"><span class="gsd-subagent-mode">Parallel</span><span class="gsd-subagent-counts"></span><span class="gsd-subagent-total">0/0</span></div><div class="gsd-agent-cards"></div></div>',
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
  parseTokens: (tokens: any[]) =>
    tokens.map((t: any) => `<p>${t.text || t.raw || ""}</p>`).join("\n"),
  scrollToBottom: vi.fn(),
  resetAutoScroll: vi.fn(),
}));

vi.mock("../tool-grouping", () => ({
  groupConsecutiveTools: (segs: unknown[]) =>
    segs.map((s) => ({ type: "single", segment: s })),
  buildGroupSummaryLabel: () => "tools",
  shouldCollapseWithPredecessor: () => false,
  collapseToolIntoGroup: vi.fn(),
}));

let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;

function resetTestState(): void {
  state.entries = [];
  state.currentTurn = null;
  state.isStreaming = false;
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

describe("incremental rendering", () => {
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
    resetTestState();
    resetStreamingState();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTestState();
    resetStreamingState();
  });

  function streamText(fullText: string, chunkSize: number): HTMLElement {
    startTurn();
    ensureCurrentTurnElement();
    for (let i = 0; i < fullText.length; i += chunkSize) {
      const delta = fullText.slice(i, i + chunkSize);
      appendToTextSegment("text", delta);
      vi.advanceTimersByTime(16);
    }
    return messagesContainer.querySelector(".gsd-assistant-text")!;
  }

  it("streams multi-paragraph text into frozen blocks plus trailing", () => {
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
    const codeFence = "```js\nconsole.log(\"hi\")\n```";
    const el = streamText(codeFence, 10);
    const frozenBlocks = el.querySelectorAll("[data-block-idx]");
    const trailing = el.querySelector("[data-block-trailing]");
    expect(frozenBlocks.length).toBe(0);
    expect(trailing).toBeTruthy();
    expect(trailing!.innerHTML).toBeTruthy();
  });

  it("freezes code block when followed by another paragraph", () => {
    const text = "```js\nconsole.log(\"hi\")\n```\n\nAfter the code";
    const el = streamText(text, 8);
    const frozenBlocks = el.querySelectorAll("[data-block-idx]");
    const trailing = el.querySelector("[data-block-trailing]");
    expect(frozenBlocks.length).toBe(1);
    expect(trailing).toBeTruthy();
    expect(trailing!.innerHTML).toContain("After the code");
  });

  it("streams a markdown table and renders it after completion", () => {
    const table = "| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |";
    const text = table + "\n\nSummary row below";
    const el = streamText(text, 10);
    const frozenBlocks = el.querySelectorAll("[data-block-idx]");
    const trailing = el.querySelector("[data-block-trailing]");
    expect(frozenBlocks.length).toBe(1);
    expect(frozenBlocks[0].innerHTML).toContain("| A | B | C |");
    expect(trailing).toBeTruthy();
    expect(trailing!.innerHTML).toContain("Summary row below");
  });

  it("handles split bold text across deltas without premature tag closing", () => {
    startTurn();
    ensureCurrentTurnElement();
    appendToTextSegment("text", "**bold te");
    vi.advanceTimersByTime(16);
    appendToTextSegment("text", "xt**");
    vi.advanceTimersByTime(16);
    const el = messagesContainer.querySelector(".gsd-assistant-text")!;
    const trailing = el.querySelector("[data-block-trailing]");
    expect(trailing).toBeTruthy();
    expect(trailing!.innerHTML).toContain("**bold text**");
  });

  it("produces same final content as renderMarkdown for roundtrip equivalence", () => {
    const complexMd = "First paragraph\n\nSecond paragraph\n\nThird paragraph";
    const el = streamText(complexMd, 6);
    const allBlocks = el.querySelectorAll("[data-block-idx]");
    const trailing = el.querySelector("[data-block-trailing]");
    const incrementalParts: string[] = [];
    allBlocks.forEach((b) => incrementalParts.push(b.textContent || ""));
    if (trailing) incrementalParts.push(trailing.textContent || "");
    const incrementalText = incrementalParts.join("");
    expect(incrementalText).toContain("First paragraph");
    expect(incrementalText).toContain("Second paragraph");
    expect(incrementalText).toContain("Third paragraph");
    expect(allBlocks.length).toBe(2);
    expect(trailing).toBeTruthy();
  });

  it("advances frozenBlockCount correctly as paragraphs complete", () => {
    startTurn();
    ensureCurrentTurnElement();
    appendToTextSegment("text", "Para one");
    vi.advanceTimersByTime(16);
    const el = messagesContainer.querySelector(".gsd-assistant-text")!;
    expect(el.querySelectorAll("[data-block-idx]").length).toBe(0);
    expect(el.querySelector("[data-block-trailing]")).toBeTruthy();
    appendToTextSegment("text", "\n\nPara two");
    vi.advanceTimersByTime(16);
    expect(el.querySelectorAll("[data-block-idx]").length).toBe(1);
    expect(el.querySelector("[data-block-trailing]")!.innerHTML).toContain("Para two");
    appendToTextSegment("text", "\n\nPara three");
    vi.advanceTimersByTime(16);
    expect(el.querySelectorAll("[data-block-idx]").length).toBe(2);
    expect(el.querySelector("[data-block-trailing]")!.innerHTML).toContain("Para three");
  });
});
