// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  init,
  ensureCurrentTurnElement,
  appendServerToolSegment,
  completeServerToolSegment,
  finalizeCurrentTurn,
  resetStreamingState,
  patchToolBlock,
} from "../../renderer";

import {
  state,
  nextId,
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
  parseTokens: (tokens: any[]) => tokens.map((t: any) => `<p>${t.text || t.raw || ""}</p>`).join("\n"),
  scrollToBottom: vi.fn(),
  resetAutoScroll: vi.fn(),
}));

vi.mock("../../tool-grouping", () => ({
  groupConsecutiveTools: (segs: unknown[]) => segs.map((s) => ({ type: "single", segment: s })),
  buildGroupSummaryLabel: () => "tools",
  shouldCollapseWithPredecessor: () => false,
  collapseToolIntoGroup: vi.fn(),
}));

// patchToolBlock tests
describe("patchToolBlock", () => {
  let messagesContainer: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="messages"></div><div id="welcome"></div>';
    messagesContainer = document.getElementById("messages")!;
    init({
      messagesContainer,
      welcomeScreen: document.getElementById("welcome")!,
    });
  });

  function makeTc(overrides: Partial<ToolCallState> = {}): ToolCallState {
    return {
      id: "tc-1",
      name: "bash",
      args: { command: "ls" },
      resultText: "",
      isError: false,
      isRunning: true,
      startTime: Date.now(),
      isParallel: false,
      ...overrides,
    };
  }

  function makeToolSegment(tc: ToolCallState): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "gsd-tool-segment";
    wrapper.innerHTML = `<div class="gsd-tool-block running cat-generic" data-tool-id="${tc.id}">
      <div class="gsd-tool-header">
        <span class="gsd-tool-spinner"></span>
        <span class="gsd-tool-cat-icon">🔧</span>
        <span class="gsd-tool-name">${tc.name}</span>
        <span class="gsd-tool-header-right"><span class="gsd-tool-chevron">▸</span></span>
      </div>
      <div class="gsd-tool-output"><span class="gsd-tool-output-pending">Running...</span></div>
    </div>`;
    return wrapper;
  }

  it("updates state class when tool completes successfully", () => {
    const tc = makeTc();
    const el = makeToolSegment(tc);
    const block = el.querySelector<HTMLElement>(".gsd-tool-block")!;
    tc.isRunning = false;
    tc.endTime = tc.startTime! + 500;
    tc.resultText = "output line 1";
    patchToolBlock(el, tc);
    expect(block.classList.contains("done")).toBe(true);
    expect(block.classList.contains("running")).toBe(false);
  });

  it("replaces spinner with success icon on completion", () => {
    const tc = makeTc();
    const el = makeToolSegment(tc);
    tc.isRunning = false;
    tc.endTime = tc.startTime! + 100;
    tc.resultText = "ok";
    patchToolBlock(el, tc);
    expect(el.querySelector(".gsd-tool-spinner")).toBeNull();
    const icon = el.querySelector(".gsd-tool-icon");
    expect(icon?.classList.contains("success")).toBe(true);
  });

  it("replaces spinner with error icon on failure", () => {
    const tc = makeTc();
    const el = makeToolSegment(tc);
    tc.isRunning = false;
    tc.isError = true;
    tc.endTime = tc.startTime! + 100;
    tc.resultText = "error occurred";
    patchToolBlock(el, tc);
    const icon = el.querySelector(".gsd-tool-icon");
    expect(icon?.classList.contains("error")).toBe(true);
    expect(icon?.textContent).toBe("✗");
  });

  it("preserves spinner element when tool is still running", () => {
    const tc = makeTc({ isRunning: true });
    const el = makeToolSegment(tc);
    const spinnerBefore = el.querySelector(".gsd-tool-spinner");
    patchToolBlock(el, tc);
    const spinnerAfter = el.querySelector(".gsd-tool-spinner");
    expect(spinnerAfter).toBe(spinnerBefore);
  });

  it("updates duration text without replacing spinner", () => {
    const tc = makeTc({ isRunning: true, startTime: Date.now() - 2000 });
    const el = makeToolSegment(tc);
    const spinnerBefore = el.querySelector(".gsd-tool-spinner");
    patchToolBlock(el, tc);
    const spinnerAfter = el.querySelector(".gsd-tool-spinner");
    expect(spinnerAfter).toBe(spinnerBefore);
    const durationEl = el.querySelector(".gsd-tool-duration");
    expect(durationEl).toBeTruthy();
  });

  it("adds collapsed class when result is long", () => {
    const tc = makeTc({ isRunning: false });
    tc.endTime = Date.now();
    tc.resultText = Array(10).fill("line").join("\n");
    const el = makeToolSegment(tc);
    patchToolBlock(el, tc);
    const block = el.querySelector<HTMLElement>(".gsd-tool-block")!;
    expect(block.classList.contains("collapsed")).toBe(true);
  });

  it("updates output content when result text changes", () => {
    const tc = makeTc({ isRunning: false, resultText: "hello world" });
    tc.endTime = Date.now();
    const el = makeToolSegment(tc);
    patchToolBlock(el, tc);
    const output = el.querySelector(".gsd-tool-output");
    expect(output?.textContent).toContain("hello world");
  });

  it("falls back to full rebuild when block element not found", () => {
    const tc = makeTc({ isRunning: false, resultText: "done" });
    tc.endTime = Date.now();
    const el = document.createElement("div");
    el.className = "gsd-tool-segment";
    el.innerHTML = `<div data-tool-id="${tc.id}">bare</div>`;
    expect(() => patchToolBlock(el, tc)).not.toThrow();
  });

  it("handles async_subagent tool with subagent panel", () => {
    const tc = makeTc({ name: "async_subagent", isRunning: true });
    const el = document.createElement("div");
    el.className = "gsd-tool-segment";
    el.innerHTML = `<div class="gsd-tool-block running cat-agent" data-tool-id="${tc.id}">
      <div class="gsd-tool-header">
        <span class="gsd-tool-spinner"></span>
        <span class="gsd-tool-name">async_subagent</span>
        <span class="gsd-tool-header-right"><span class="gsd-tool-chevron">▸</span></span>
      </div>
      <div class="gsd-tool-output gsd-tool-output-rich">
        <div class="gsd-subagent-panel">
          <div class="gsd-subagent-summary">
            <span class="gsd-subagent-mode">Parallel</span>
            <span class="gsd-subagent-counts"></span>
            <span class="gsd-subagent-total">0/1</span>
          </div>
          <div class="gsd-agent-cards">
            <div class="gsd-agent-card running">
              <div class="gsd-agent-header">
                <div class="gsd-agent-header-left"><span class="gsd-tool-spinner"></span><span class="gsd-agent-name">worker</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    tc.details = {
      mode: "parallel",
      results: [{ agent: "worker", task: "do stuff", exitCode: -1, status: "running" }],
    };
    tc.resultText = "0/1 done, 1 running";
    const spinnerBefore = el.querySelector(".gsd-agent-card .gsd-tool-spinner");
    expect(() => patchToolBlock(el, tc)).not.toThrow();
    const spinnerAfter = el.querySelector(".gsd-agent-card .gsd-tool-spinner");
    expect(spinnerAfter).toBe(spinnerBefore);
  });

  it("transitions agent card from running to done when exitCode changes", () => {
    const tc = makeTc({ name: "async_subagent", isRunning: false });
    tc.endTime = Date.now();
    const el = document.createElement("div");
    el.className = "gsd-tool-segment";
    el.innerHTML = `<div class="gsd-tool-block done cat-agent" data-tool-id="${tc.id}">
      <div class="gsd-tool-header">
        <span class="gsd-tool-icon success">✓</span>
        <span class="gsd-tool-name">async_subagent</span>
        <span class="gsd-tool-header-right"><span class="gsd-tool-chevron">▸</span></span>
      </div>
      <div class="gsd-tool-output gsd-tool-output-rich">
        <div class="gsd-subagent-panel">
          <div class="gsd-subagent-summary">
            <span class="gsd-subagent-mode">Parallel</span>
            <span class="gsd-subagent-counts"></span>
            <span class="gsd-subagent-total">0/1</span>
          </div>
          <div class="gsd-agent-cards">
            <div class="gsd-agent-card running">
              <div class="gsd-agent-header">
                <div class="gsd-agent-header-left"><span class="gsd-tool-spinner"></span><span class="gsd-agent-name">worker</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    tc.details = {
      mode: "parallel",
      results: [{ agent: "worker", task: "do stuff", exitCode: 0, status: "done", usage: { turns: 1, input: 100, output: 50, cost: 0.001 } }],
    };
    tc.resultText = "1/1 done, 0 running";
    patchToolBlock(el, tc);
    expect(el.querySelector(".gsd-agent-card .gsd-tool-spinner")).toBeNull();
    const agentIcon = el.querySelector(".gsd-agent-card .gsd-agent-icon");
    expect(agentIcon?.classList.contains("done")).toBe(true);
    const card = el.querySelector(".gsd-agent-card");
    expect(card?.classList.contains("done")).toBe(true);
    expect(card?.classList.contains("running")).toBe(false);
    expect(el.querySelector(".gsd-subagent-total")?.textContent).toBe("1/1");
  });

  it("parallel badge added when tool becomes parallel", () => {
    const tc = makeTc({ isRunning: true, isParallel: true });
    const el = makeToolSegment(tc);
    patchToolBlock(el, tc);
    const block = el.querySelector(".gsd-tool-block");
    expect(block?.classList.contains("parallel")).toBe(true);
  });
});

// Server-side tool segments
describe("Server-side tool segments", () => {
  let msgContainer: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    msgContainer = document.createElement("div");
    msgContainer.id = "messages";
    const welcome = document.createElement("div");
    welcome.id = "welcome";
    document.body.appendChild(msgContainer);
    document.body.appendChild(welcome);
    init({ messagesContainer: msgContainer, welcomeScreen: welcome });
    state.entries = [];
    state.currentTurn = null;
    state.isStreaming = false;
    resetStreamingState();
  });

  afterEach(() => {
    vi.useRealTimers();
    state.entries = [];
    state.currentTurn = null;
    state.isStreaming = false;
    document.body.innerHTML = "";
  });

  function startTurn(): void {
    state.currentTurn = {
      id: nextId(),
      segments: [],
      toolCalls: new Map(),
      isComplete: false,
      timestamp: Date.now(),
    };
    state.isStreaming = true;
    ensureCurrentTurnElement();
  }

  it("appendServerToolSegment creates a segment and DOM element", () => {
    startTurn();
    appendServerToolSegment("tool-1", "web_search", { query: "test query" });
    expect(state.currentTurn!.segments).toHaveLength(1);
    const seg = state.currentTurn!.segments[0];
    expect(seg.type).toBe("server_tool");
    if (seg.type === "server_tool") {
      expect(seg.serverToolId).toBe("tool-1");
      expect(seg.name).toBe("web_search");
      expect(seg.isComplete).toBe(false);
    }
    const card = msgContainer.querySelector(".gsd-server-tool-card");
    expect(card).toBeTruthy();
    expect(card?.classList.contains("running")).toBe(true);
    expect(card?.querySelector(".gsd-server-tool-name")?.textContent).toBe("Web Search");
    expect(card?.querySelector(".gsd-server-tool-query")?.textContent).toBe("test query");
    expect(card?.querySelector(".gsd-tool-spinner")).toBeTruthy();
  });

  it("appendServerToolSegment renders non-web-search tools with generic icon", () => {
    startTurn();
    appendServerToolSegment("tool-2", "code_execution", {});
    const name = msgContainer.querySelector(".gsd-server-tool-name");
    expect(name?.textContent).toBe("code_execution");
    const icon = msgContainer.querySelector(".gsd-server-tool-icon");
    expect(icon?.textContent).toBe("⚡");
  });

  it("completeServerToolSegment marks segment done and updates DOM", () => {
    startTurn();
    appendServerToolSegment("tool-1", "web_search", { query: "test" });
    const results = [
      { type: "web_search_result", url: "https://example.com", title: "Example" },
      { type: "web_search_result", url: "https://test.com", title: "Test" },
    ];
    completeServerToolSegment("tool-1", results);
    const seg = state.currentTurn!.segments[0];
    if (seg.type === "server_tool") {
      expect(seg.isComplete).toBe(true);
      expect(seg.results).toBe(results);
    }
    const card = msgContainer.querySelector(".gsd-server-tool-card");
    expect(card?.classList.contains("done")).toBe(true);
    expect(card?.classList.contains("running")).toBe(false);
    expect(card?.querySelector(".gsd-tool-spinner")).toBeNull();
    expect(card?.querySelector(".gsd-server-tool-check")?.textContent).toBe("✓");
    expect(card?.querySelector(".gsd-server-tool-count")?.textContent).toBe("2 results");
  });

  it("completeServerToolSegment upserts count badge instead of duplicating", () => {
    startTurn();
    appendServerToolSegment("tool-1", "web_search", { query: "test" });
    const results1 = [{ type: "web_search_result", url: "https://a.com", title: "A" }];
    completeServerToolSegment("tool-1", results1);
    const results2 = [
      { type: "web_search_result", url: "https://a.com", title: "A" },
      { type: "web_search_result", url: "https://b.com", title: "B" },
      { type: "web_search_result", url: "https://c.com", title: "C" },
    ];
    completeServerToolSegment("tool-1", results2);
    const countEls = msgContainer.querySelectorAll(".gsd-server-tool-count");
    expect(countEls).toHaveLength(1);
    expect(countEls[0].textContent).toBe("3 results");
  });

  it("finalizeCurrentTurn marks incomplete server_tool segments as done", () => {
    startTurn();
    const turn = state.currentTurn!;
    appendServerToolSegment("tool-1", "web_search", { query: "test" });
    finalizeCurrentTurn();
    const seg = turn.segments[0];
    if (seg.type === "server_tool") {
      expect(seg.isComplete).toBe(true);
    }
  });

  it("does nothing when no current turn", () => {
    appendServerToolSegment("tool-1", "web_search", {});
    completeServerToolSegment("tool-1", []);
    expect(state.currentTurn).toBeNull();
  });

  it("singular result text", () => {
    startTurn();
    appendServerToolSegment("tool-1", "web_search", { query: "test" });
    completeServerToolSegment("tool-1", [{ type: "web_search_result", url: "https://a.com", title: "A" }]);
    expect(msgContainer.querySelector(".gsd-server-tool-count")?.textContent).toBe("1 result");
  });
});
