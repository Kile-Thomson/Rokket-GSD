// @vitest-environment jsdom
// Integration proof: drive the REAL streaming + finalize lifecycle with a
// Workflow tool call and assert the live inline card is in the conversation DOM
// DURING the turn and survives finalization. The card is fed by the disk-watcher
// path (workflow-live), keyed by run id — deliberately independent of the
// Workflow tool's call id, which is exactly why it can render before the tool
// block exists.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { init } from "../renderer";
import { appendToolSegmentElement } from "../render/streaming";
import { finalizeCurrentTurn, resetStreamingState } from "../render/batches";
import { update as updateLive, reset as resetLive } from "../workflow-live";
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

// The Workflow tool's RPC call id, and the workflow's on-disk run id. They differ
// on purpose — the live card keys on the run id, so it never depends on the tool
// block existing in the DOM.
const TOOL_CALL_ID = "wf-tool-1";
const RUN_ID = "wf_abc123";

function snap(over: Partial<WorkflowProgressData> = {}): WorkflowProgressData {
  return {
    toolCallId: RUN_ID,
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

function card(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.gsd-wf-inline[data-workflow-run-id="${RUN_ID}"]`);
}

function wfToolCall(): ToolCallState {
  return { id: TOOL_CALL_ID, name: "Workflow", args: { script: "x" }, resultText: "", isError: false, isRunning: true, startTime: Date.now() };
}

describe("workflow live card — real streaming lifecycle", () => {
  let messagesContainer: HTMLElement;
  let welcomeScreen: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    messagesContainer = document.createElement("div");
    messagesContainer.id = "messagesContainer";
    welcomeScreen = document.createElement("div");
    welcomeScreen.id = "welcome";
    document.body.appendChild(messagesContainer);
    document.body.appendChild(welcomeScreen);
    init({ messagesContainer, welcomeScreen });
    state.entries = [];
    state.currentTurn = null;
    resetStreamingState();
    resetLive();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetLive();
    resetStreamingState();
  });

  it("inline card is visible DURING the turn and survives finalize + post-turn polls", () => {
    // 1. Turn starts; the Workflow tool segment is rendered (as the message
    //    handler does on tool_execution_start).
    state.currentTurn = { id: nextId(), segments: [], toolCalls: new Map(), isComplete: false, timestamp: Date.now() };
    const tc = wfToolCall();
    state.currentTurn.toolCalls.set(TOOL_CALL_ID, tc);
    state.currentTurn.segments.push({ type: "tool", toolCallId: TOOL_CALL_ID });
    appendToolSegmentElement(tc, 0);

    // 2. The disk watcher surfaces the run mid-turn — "launching" then "running".
    updateLive(snap({ status: "launching" }));
    const duringLaunch = !!card();

    updateLive(snap({ status: "running" }));
    const duringRunning = !!card();
    const insideConversation = card()?.parentElement === messagesContainer;

    // 3. The agent's text turn ends; the workflow keeps running in the background.
    finalizeCurrentTurn();
    const afterFinalize = !!card();

    // 4. Post-turn watcher polls keep updating the card after the turn is over.
    updateLive(snap({ status: "running", doneAgentCount: 1 }));
    const afterPostTurnPoll = !!card();

    // 5. Completion swaps in the terminal snapshot, which persists as a record.
    updateLive(snap({ status: "completed", runningAgentCount: 0, doneAgentCount: 1, agents: [{ label: "review:bugs", state: "done" }] }));
    const atCompletion = card()?.className.includes("status-completed");

    expect({ duringLaunch, duringRunning, insideConversation, afterFinalize, afterPostTurnPoll, atCompletion }).toEqual({
      duringLaunch: true,
      duringRunning: true,
      insideConversation: true,
      afterFinalize: true,
      afterPostTurnPoll: true,
      atCompletion: true,
    });
  });
});
