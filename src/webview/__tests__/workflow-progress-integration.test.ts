// @vitest-environment jsdom
// Integration reproduction: drive the REAL streaming + finalize lifecycle with a
// Workflow tool call and assert when the live panel is actually in the DOM.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { init } from "../renderer";
import { appendToolSegmentElement } from "../render/streaming";
import { finalizeCurrentTurn, resetStreamingState } from "../render/batches";
import { update as updateWorkflow, reset as resetWorkflow } from "../workflow-progress";
import { state, nextId, type ToolCallState } from "../state";
import type { WorkflowProgressData } from "../../shared/types";

vi.mock("../helpers", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    escapeHtml: (s: string) => s,
    escapeAttr: (s: string) => s,
    formatDuration: (ms: number) => `${ms}ms`,
    formatTokens: (n: number) => String(n),
    renderMarkdown: (t: string) => `<p>${t}</p>`,
    sanitizeAndPostProcess: (html: string) => html,
    parseTokens: (toks: Array<{ text?: string; raw?: string }>) =>
      toks.map((t) => `<p>${t.text || t.raw || ""}</p>`).join("\n"),
    lexMarkdown: (text: string) => Object.assign(text ? [{ type: "paragraph", raw: text, text, tokens: [] }] : [], { links: {} }),
    scrollToBottom: vi.fn(),
    resetAutoScroll: vi.fn(),
    getToolCategory: () => "generic",
    getToolIcon: () => "🔧",
    getToolKeyArg: () => "",
    formatToolResult: (_n: string, t: string) => t,
    buildUsagePills: () => "",
    formatRelativeTime: () => "now",
  };
});

vi.mock("../tool-grouping", () => ({
  groupConsecutiveTools: (segs: unknown[]) => segs.map((s) => ({ type: "single", segment: s })),
  buildGroupSummaryLabel: () => "tools",
  shouldCollapseWithPredecessor: () => false,
  collapseToolIntoGroup: vi.fn(),
}));

const TC = "wf-tool-1";

function snap(over: Partial<WorkflowProgressData> = {}): WorkflowProgressData {
  return {
    toolCallId: TC,
    name: "audit",
    phases: ["Review"],
    status: "running",
    agents: [{ label: "review:bugs", state: "running" }],
    plannedAgentCount: 1,
    doneAgentCount: 0,
    runningAgentCount: 1,
    startedAt: 1000,
    updatedAt: 2000,
    stale: false,
    ...over,
  };
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.gsd-workflow-panel[data-workflow-tool-id="${TC}"]`);
}

function wfToolCall(): ToolCallState {
  return { id: TC, name: "Workflow", args: { script: "x" }, resultText: "", isError: false, isRunning: true, startTime: Date.now() };
}

describe("workflow panel — real streaming lifecycle", () => {
  let messagesContainer: HTMLElement;
  let welcomeScreen: HTMLElement;

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
    state.entries = [];
    state.currentTurn = null;
    resetStreamingState();
    resetWorkflow();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetWorkflow();
    resetStreamingState();
  });

  it("panel is visible DURING the turn and survives finalize", () => {
    // 1. Turn starts, Workflow tool segment rendered (as message-handler does on tool_execution_start).
    state.currentTurn = { id: nextId(), segments: [], toolCalls: new Map(), isComplete: false, timestamp: Date.now() };
    const tc = wfToolCall();
    state.currentTurn.toolCalls.set(TC, tc);
    state.currentTurn.segments.push({ type: "tool", toolCallId: TC });
    appendToolSegmentElement(tc, 0);

    // 2. Extension posts "launching" mid-turn.
    updateWorkflow(snap({ status: "launching" }));
    vi.advanceTimersByTime(400); // let bounded retry run
    const duringLaunch = !!panel();

    // 3. Extension posts "running" snapshots mid-turn.
    updateWorkflow(snap({ status: "running" }));
    vi.advanceTimersByTime(50);
    const duringRunning = !!panel();

    // 4. Turn finalizes (agent's text turn ends; workflow keeps running in background).
    finalizeCurrentTurn();
    const afterFinalize = !!panel();

    // 5. Post-turn poll keeps updating (workflow runs in the background after the turn).
    updateWorkflow(snap({ status: "running" }));
    vi.advanceTimersByTime(50);
    const afterPostTurnPoll = !!panel();

    expect({ duringLaunch, duringRunning, afterFinalize, afterPostTurnPoll }).toEqual({
      duringLaunch: true,
      duringRunning: true,
      afterFinalize: true,
      afterPostTurnPoll: true,
    });
  });
});
