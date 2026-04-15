// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  init,
  clearMessages,
  renderNewEntry,
  ensureCurrentTurnElement,
  appendToTextSegment,
  appendToolSegmentElement,
  appendServerToolSegment,
  completeServerToolSegment,
  updateToolSegmentElement,
  finalizeCurrentTurn,
  resetStreamingState,
  patchToolBlock,
} from "../renderer";

import {
  state,
  nextId,
  MAX_ENTRIES,
  pruneOldEntries,
  resetPrunedCount,
  resetState as resetFullState,
  type ChatEntry,
  type ToolCallState,
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

describe("renderer re-exports", () => {
  it("exposes all expected functions", () => {
    expect(typeof init).toBe("function");
    expect(typeof clearMessages).toBe("function");
    expect(typeof renderNewEntry).toBe("function");
    expect(typeof ensureCurrentTurnElement).toBe("function");
    expect(typeof appendToTextSegment).toBe("function");
    expect(typeof appendToolSegmentElement).toBe("function");
    expect(typeof appendServerToolSegment).toBe("function");
    expect(typeof completeServerToolSegment).toBe("function");
    expect(typeof updateToolSegmentElement).toBe("function");
    expect(typeof finalizeCurrentTurn).toBe("function");
    expect(typeof resetStreamingState).toBe("function");
    expect(typeof patchToolBlock).toBe("function");
  });

  it("exposes state utilities", () => {
    expect(typeof nextId).toBe("function");
    expect(typeof MAX_ENTRIES).toBe("number");
    expect(typeof pruneOldEntries).toBe("function");
    expect(typeof resetPrunedCount).toBe("function");
    expect(typeof resetFullState).toBe("function");
  });
});
