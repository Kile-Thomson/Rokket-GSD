// @vitest-environment jsdom
//
// End-to-end parallel-batch tests — drives real message-handler + real renderer
// (NO renderer mock). Asserts on the actual DOM shape to catch regressions
// where event sequences that should form one parallel batch instead render as
// individual rows (or merge into one giant block across messages).
//
// Ground truth for pi's event shape (see M026 investigation):
//   - N parallel tool_use blocks in one assistant message share a single
//     message_start → message_end pair.
//   - message_end.message.content carries the authoritative parallel tool-id
//     list (only events where grouping is definitive).
//   - tool_execution_start / tool_execution_end are emitted per-tool, back-to-back.
//   - Different assistant messages (e.g. reasoning between waves) get
//     distinct message_start / message_end pairs — these MUST split batches.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../state";

// Mock only peripheral modules — keep the real renderer so DOM assertions work.
vi.mock("../session-history", () => ({
  setCurrentSessionId: vi.fn(),
  updateSessions: vi.fn(),
  showError: vi.fn(),
  hide: vi.fn(),
}));
vi.mock("../slash-menu", () => ({ isVisible: vi.fn(() => false), show: vi.fn() }));
vi.mock("../model-picker", () => ({ isVisible: vi.fn(() => false), render: vi.fn() }));
vi.mock("../thinking-picker", () => ({ refresh: vi.fn() }));
vi.mock("../ui-dialogs", () => ({
  hasPending: vi.fn(() => false),
  expireAllPending: vi.fn(),
  handleRequest: vi.fn(),
}));
vi.mock("../toasts", () => ({ show: vi.fn() }));
vi.mock("../dashboard", () => ({
  renderDashboard: vi.fn(),
  updateWelcomeScreen: vi.fn(),
}));
vi.mock("../auto-progress", () => ({ update: vi.fn() }));
vi.mock("../visualizer", () => ({ isVisible: vi.fn(() => false), updateData: vi.fn() }));
vi.mock("../file-handling", () => ({ addFileAttachments: vi.fn() }));
vi.mock("../keyboard", () => ({
  setChangelogHandlers: vi.fn(),
  getChangelogTriggerEl: vi.fn(() => null),
  dismissChangelog: vi.fn(),
}));
vi.mock("../a11y", () => ({
  createFocusTrap: vi.fn(() => vi.fn()),
  saveFocus: vi.fn(() => null),
  restoreFocus: vi.fn(),
  announceToScreenReader: vi.fn(),
}));

import { init, cleanup } from "../message-handler";
import * as renderer from "../renderer";

function sendMessage(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function msgEndWithTools(toolBlocks: Array<{ id: string; name: string; type?: string }>): Record<string, unknown> {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: toolBlocks.map((b) => ({
        type: b.type ?? "tool_use",
        id: b.id,
        name: b.name,
        input: {},
      })),
    },
  };
}

function resetState(): void {
  state.entries = [];
  state.currentTurn = null;
  state.isStreaming = false;
  state.isCompacting = false;
  state.isRetrying = false;
  state.model = null;
  state.thinkingLevel = null;
  state.processStatus = "stopped";
  state.processHealth = "responsive";
  state.sessionStats = {};
  state.commands = [];
  state.commandsLoaded = false;
  state.availableModels = [];
  state.modelsLoaded = false;
  state.modelsRequested = false;
  state.loadedSkills = new Set<string>();
}

describe("parallel batch rendering (E2E, real renderer)", () => {
  let messagesContainer: HTMLElement;
  let welcomeScreen: HTMLElement;
  let promptInput: HTMLTextAreaElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    messagesContainer = document.createElement("div");
    messagesContainer.id = "messages";
    welcomeScreen = document.createElement("div");
    promptInput = document.createElement("textarea") as HTMLTextAreaElement;
    document.body.appendChild(messagesContainer);
    document.body.appendChild(welcomeScreen);
    document.body.appendChild(promptInput);

    resetState();
    vi.clearAllMocks();

    renderer.init({ messagesContainer, welcomeScreen });
    init({
      vscode: { postMessage: vi.fn() },
      messagesContainer,
      welcomeScreen,
      promptInput,
      updateAllUI: vi.fn(),
      updateHeaderUI: vi.fn(),
      updateFooterUI: vi.fn(),
      updateInputUI: vi.fn(),
      updateOverlayIndicators: vi.fn(),
      updateWorkflowBadge: vi.fn(),
      handleModelRouted: vi.fn(),
      autoResize: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    resetState();
  });

  it("5 parallel tools in one message render as one batch container", () => {
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    const tools = [
      { id: "t1", name: "Bash" },
      { id: "t2", name: "Bash" },
      { id: "t3", name: "Grep" },
      { id: "t4", name: "Read" },
      { id: "t5", name: "Read" },
    ];

    // Simulate streaming toolcall_start deltas for each tool (creates segments)
    for (const t of tools) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }

    // message_end with all 5 as tool_use blocks — authoritative parallel set
    sendMessage(msgEndWithTools(tools));

    // Back-to-back tool_execution_start events (parallel dispatch)
    for (const t of tools) {
      sendMessage({
        type: "tool_execution_start",
        toolCallId: t.id,
        toolName: t.name,
        args: {},
      });
    }

    // All 5 segments should live inside exactly one parallel batch container.
    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(1);
    const batch = batches[0];
    const segments = batch.querySelectorAll(".gsd-parallel-batch-content .gsd-tool-segment");
    expect(segments.length).toBe(5);

    // No tool segments should be loose (outside any batch) inside the turn.
    const looseSegments = messagesContainer.querySelectorAll(
      ".gsd-assistant-turn > .gsd-tool-segment",
    );
    expect(looseSegments.length).toBe(0);
  });

  it("5 parallel tools delivered via tool_execution_start only (no streaming deltas) still form one batch", () => {
    // Some providers (external SDK mode) skip content_block streaming and emit
    // tool_execution_start events directly. The batch must still form.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    const tools = [
      { id: "u1", name: "Bash" },
      { id: "u2", name: "Bash" },
      { id: "u3", name: "Grep" },
      { id: "u4", name: "Read" },
      { id: "u5", name: "Read" },
    ];

    // message_end FIRST with full parallel set
    sendMessage(msgEndWithTools(tools));

    // Then back-to-back tool_execution_start events
    for (const t of tools) {
      sendMessage({
        type: "tool_execution_start",
        toolCallId: t.id,
        toolName: t.name,
        args: {},
      });
    }

    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(1);
    const segments = batches[0].querySelectorAll(
      ".gsd-parallel-batch-content .gsd-tool-segment",
    );
    expect(segments.length).toBe(5);
  });

  it("two sequential messages each with 3 tools render as TWO batches, not one", () => {
    // Ground truth: two separate assistant messages with no overlap = two batches.
    sendMessage({ type: "agent_start" });

    // Message 1
    sendMessage({ type: "message_start" });
    const wave1 = [
      { id: "a1", name: "Bash" },
      { id: "a2", name: "Bash" },
      { id: "a3", name: "Grep" },
    ];
    sendMessage(msgEndWithTools(wave1));
    for (const t of wave1) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave1) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 10,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Message 2 — fresh message_start should split batches
    sendMessage({ type: "message_start" });
    const wave2 = [
      { id: "b1", name: "Read" },
      { id: "b2", name: "Read" },
      { id: "b3", name: "Grep" },
    ];
    sendMessage(msgEndWithTools(wave2));
    for (const t of wave2) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(2);

    // Each batch should hold its own wave's tools
    const allBatchIds = Array.from(batches).map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]")).map(
        (el) => el.dataset.toolId,
      ),
    );
    // One batch has all a*, the other has all b*
    const flat = allBatchIds.flat().sort();
    expect(flat).toEqual(["a1", "a2", "a3", "b1", "b2", "b3"]);

    const aBatch = allBatchIds.find((ids) => ids.some((id) => id!.startsWith("a")))!;
    const bBatch = allBatchIds.find((ids) => ids.some((id) => id!.startsWith("b")))!;
    expect(aBatch.every((id) => id!.startsWith("a"))).toBe(true);
    expect(bBatch.every((id) => id!.startsWith("b"))).toBe(true);
  });

  it("narration between parallel waves in one message splits into two batches", () => {
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    // Wave 1 (3 tools), then narration, then wave 2 (2 tools) — all in one message
    const wave1 = [
      { id: "w1-1", name: "Bash" },
      { id: "w1-2", name: "Bash" },
      { id: "w1-3", name: "Grep" },
    ];
    for (const t of wave1) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave1) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 10,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Narration chunk between waves (thought-cycle boundary)
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Now checking the next set." },
    });

    const wave2 = [
      { id: "w2-1", name: "Read" },
      { id: "w2-2", name: "Read" },
    ];
    for (const t of wave2) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    // message_end with text block separating the two waves — narration is part
    // of the authoritative content structure, so wave splitting sees 2 waves.
    sendMessage({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          ...wave1.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
          { type: "text", text: "Now checking the next set." },
          ...wave2.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
        ],
      },
    });

    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(2);
  });

  it("claude-code external SDK sequence: 5 tools then 5 follow-up turns each with 1 tool → 2+ batches, not 1", () => {
    // Ground truth per M026 Explore report (gsd-pi external SDK mode):
    //   message_start (assistant #1)
    //   message_end (assistant #1 with 5 tool_use blocks)
    //   tool_execution_start × 5, tool_execution_end × 5
    //   message_start/message_end × 5 (tool result messages)
    //   message_start (assistant #2)
    //   message_end (assistant #2 with 1 tool_use)
    //   tool_execution_start/end for that tool
    //   [repeat for assistant #3, #4, #5]
    //
    // Expected DOM: the first 5 tools form ONE parallel batch. Each follow-up
    // single-tool response is a lone segment (not wrapped in a batch). So we
    // expect exactly 1 .gsd-parallel-batch (containing 5 segments) and
    // additional loose single-tool segments for the 5 follow-up turns.
    sendMessage({ type: "agent_start" });

    // ── Assistant response #1: 5 parallel tools ──
    sendMessage({ type: "message_start" });
    const wave1 = [
      { id: "w1-t1", name: "Bash" },
      { id: "w1-t2", name: "Bash" },
      { id: "w1-t3", name: "Grep" },
      { id: "w1-t4", name: "Read" },
      { id: "w1-t5", name: "Read" },
    ];
    sendMessage(msgEndWithTools(wave1));
    for (const t of wave1) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave1) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 10,
        result: { content: [{ text: "ok" }] },
      });
    }
    // Five tool-result user messages — each is its own message_start/end pair
    for (let i = 0; i < 5; i++) {
      sendMessage({ type: "message_start" });
      sendMessage({
        type: "message_end",
        message: { role: "user", content: [{ type: "tool_result", toolUseId: wave1[i].id }] },
      });
    }

    // ── Follow-up turns #2..#5, each a single-tool assistant response ──
    for (let turn = 2; turn <= 5; turn++) {
      sendMessage({ type: "message_start" });
      const tool = { id: `w${turn}-t1`, name: "Bash" };
      sendMessage(msgEndWithTools([tool]));
      sendMessage({ type: "tool_execution_start", toolCallId: tool.id, toolName: tool.name, args: {} });
      sendMessage({
        type: "tool_execution_end",
        toolCallId: tool.id,
        isError: false,
        durationMs: 10,
        result: { content: [{ text: "ok" }] },
      });
      // Tool-result user message
      sendMessage({ type: "message_start" });
      sendMessage({
        type: "message_end",
        message: { role: "user", content: [{ type: "tool_result", toolUseId: tool.id }] },
      });
    }

    // Expect: exactly ONE .gsd-parallel-batch containing the 5 wave1 tools.
    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(1);
    const batchSegments = batches[0].querySelectorAll(
      ".gsd-parallel-batch-content .gsd-tool-segment",
    );
    expect(batchSegments.length).toBe(5);
    const batchIds = Array.from(batchSegments)
      .map((el) => (el as HTMLElement).dataset.toolId!)
      .sort();
    expect(batchIds).toEqual(["w1-t1", "w1-t2", "w1-t3", "w1-t4", "w1-t5"]);

    // The 4 follow-up single-tool responses must NOT be inside the batch
    for (const id of ["w2-t1", "w3-t1", "w4-t1", "w5-t1"]) {
      const seg = messagesContainer.querySelector(`.gsd-tool-segment[data-tool-id="${id}"]`);
      expect(seg).not.toBeNull();
      // The segment must not be a descendant of any .gsd-parallel-batch
      expect(seg!.closest(".gsd-parallel-batch")).toBeNull();
    }
  });

  it.each([
    ["serverToolUse"],
    ["server_tool_use"],
  ])("mixed Bash + Agent parallel tools (%s blocks) render in one batch", (serverToolUseType) => {
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    // 2 Bash + 2 Agent server-side tools in one message
    const tools = [
      { id: "bh-1", name: "Bash", type: "tool_use" as const },
      { id: "bh-2", name: "Bash", type: "tool_use" as const },
      { id: "ag-1", name: "Agent", type: serverToolUseType },
      { id: "ag-2", name: "Agent", type: serverToolUseType },
    ];

    // Only the regular tool_use blocks emit tool_execution_start; server tool
    // blocks complete server-side and arrive only in message_end content.
    for (const t of tools) {
      if (t.type === "tool_use") {
        sendMessage({
          type: "message_update",
          assistantMessageEvent: {
            type: "toolcall_start",
            toolCall: { type: "toolCall", id: t.id, name: t.name },
            contentIndex: 0,
            partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
          },
        });
      }
    }

    sendMessage(msgEndWithTools(tools));

    for (const t of tools) {
      if (t.type === "tool_use") {
        sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
      }
    }

    // All four (2 Bash + 2 Agent) should be in one batch
    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(1);
    const segments = batches[0].querySelectorAll(
      ".gsd-parallel-batch-content .gsd-tool-segment",
    );
    expect(segments.length).toBe(4);
    const ids = Array.from(segments).map((el) => (el as HTMLElement).dataset.toolId).sort();
    expect(ids).toEqual(["ag-1", "ag-2", "bh-1", "bh-2"]);
  });

  it("PRODUCTION BUG: sequential waves with NO intermediate message_start must split into separate batches", () => {
    // Reproduces the real-world bug seen in claude-code external SDK mode:
    // gsd-pi coalesces the SDK stream and does NOT emit a fresh message_start
    // between sequential assistant responses within one turn. Each response
    // arrives as its own message_end with tool_use blocks, but no delimiter.
    // Pre-fix behaviour: all tools merge into one giant batch ("162 tools...").
    // Post-fix behaviour: each wave's tools must live in its own batch.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" }); // only ONE for the whole turn

    // Wave 1: 3 tools dispatched, completed
    const wave1 = [
      { id: "p1-t1", name: "Bash" },
      { id: "p1-t2", name: "Bash" },
      { id: "p1-t3", name: "Grep" },
    ];
    sendMessage(msgEndWithTools(wave1));
    for (const t of wave1) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave1) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 10,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Wave 2 arrives immediately — NO message_start between waves.
    // (pi in external SDK mode did not emit one.) message_end carries only
    // the new wave's tools; they must NOT be absorbed into wave 1's batch.
    const wave2 = [
      { id: "p2-t1", name: "Read" },
      { id: "p2-t2", name: "Read" },
      { id: "p2-t3", name: "Grep" },
    ];
    sendMessage(msgEndWithTools(wave2));
    for (const t of wave2) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave2) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 10,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Wave 3 — another cycle, still no message_start.
    const wave3 = [
      { id: "p3-t1", name: "Bash" },
      { id: "p3-t2", name: "Bash" },
    ];
    sendMessage(msgEndWithTools(wave3));
    for (const t of wave3) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    // Three distinct waves → three distinct batches
    expect(batches.length).toBe(3);

    // Each batch should hold only its own wave's tools
    const batchIds = Array.from(batches).map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
        .map((el) => el.dataset.toolId!)
        .sort(),
    );
    const p1 = batchIds.find((ids) => ids.some((id) => id.startsWith("p1-")))!;
    const p2 = batchIds.find((ids) => ids.some((id) => id.startsWith("p2-")))!;
    const p3 = batchIds.find((ids) => ids.some((id) => id.startsWith("p3-")))!;
    expect(p1).toEqual(["p1-t1", "p1-t2", "p1-t3"]);
    expect(p2).toEqual(["p2-t1", "p2-t2", "p2-t3"]);
    expect(p3).toEqual(["p3-t1", "p3-t2"]);
  });

  it("PRODUCTION BUG (timing variant): message_end for wave 2 arrives BEFORE tool_execution_end for wave 1 — must still split", () => {
    // A subtler variant: wave 1 tools are still "running" (no tool_execution_end
    // yet) when message_end for wave 2 arrives. The stale-batch check at
    // message_end bails out because activeBatchToolIds still has running
    // members, so wave 2 tools get merged into wave 1's batch. This is likely
    // the real-world bug: long-running tools (Agent/Task) never emit
    // tool_execution_end, so their ids are "always running" in the batch set.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    // Wave 1: 3 tools START but never complete (simulate long-running Agents)
    const wave1 = [
      { id: "q1-t1", name: "Agent", type: "serverToolUse" as const },
      { id: "q1-t2", name: "Agent", type: "serverToolUse" as const },
      { id: "q1-t3", name: "Agent", type: "serverToolUse" as const },
    ];
    sendMessage(msgEndWithTools(wave1));
    // serverToolUse blocks never emit tool_execution_start/end — they are
    // synthesized from message_end and marked as already-complete. But the
    // batch tracking still treats them as in-batch. Next wave must NOT merge.

    // Wave 2: arrives next, NO message_start between.
    const wave2 = [
      { id: "q2-t1", name: "Read" },
      { id: "q2-t2", name: "Read" },
    ];
    sendMessage(msgEndWithTools(wave2));
    for (const t of wave2) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(2);
    const batchIds = Array.from(batches).map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
        .map((el) => el.dataset.toolId!)
        .sort(),
    );
    const q1 = batchIds.find((ids) => ids.some((id) => id.startsWith("q1-")))!;
    const q2 = batchIds.find((ids) => ids.some((id) => id.startsWith("q2-")))!;
    expect(q1).toEqual(["q1-t1", "q1-t2", "q1-t3"]);
    expect(q2).toEqual(["q2-t1", "q2-t2"]);
  });

  it("PRODUCTION BUG (still-running variant): wave 2 message_end while wave 1 tools still running — split on disjoint tool-id sets", () => {
    // Most likely the actual production trigger. gsd-pi's external SDK adapter
    // emits message_end for a new assistant response before the previous
    // assistant response's long-running tools have emitted tool_execution_end.
    // The existing stale-batch guard requires hasRunningMember=false, so it
    // refuses to split. Fix: if the new message_end tool-id set is COMPLETELY
    // DISJOINT from the current batch, treat that as a wave boundary even if
    // the prior wave's tools are still running.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    // Wave 1: tool_execution_start fires but NO tool_execution_end yet
    const wave1 = [
      { id: "r1-t1", name: "Bash" },
      { id: "r1-t2", name: "Bash" },
    ];
    sendMessage(msgEndWithTools(wave1));
    for (const t of wave1) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    // Wave 2 message_end arrives while wave1 tools still running, no new message_start.
    const wave2 = [
      { id: "r2-t1", name: "Grep" },
      { id: "r2-t2", name: "Grep" },
    ];
    sendMessage(msgEndWithTools(wave2));
    for (const t of wave2) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(2);
    const batchIds = Array.from(batches).map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
        .map((el) => el.dataset.toolId!)
        .sort(),
    );
    const r1 = batchIds.find((ids) => ids.some((id) => id.startsWith("r1-")))!;
    const r2 = batchIds.find((ids) => ids.some((id) => id.startsWith("r2-")))!;
    expect(r1).toEqual(["r1-t1", "r1-t2"]);
    expect(r2).toEqual(["r2-t1", "r2-t2"]);
  });

  it("PRODUCTION BUG: text_delta between toolcall_start events in streaming must NOT split the batch", () => {
    // Reproduces the real-world bug: Claude streams toolcall_start events with
    // brief text_delta fragments between them (streaming cadence artifact, not
    // real narration). Before the fix, each text_delta sealed the batch,
    // splitting 4 parallel tools into 2-tool sealed batches. After the fix,
    // text_delta during messageInFlight is ignored and message_end organizes
    // the batch correctly.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    // Streaming: Grep A, Grep B, then text_delta, then Bash C, Bash D
    const allTools = [
      { id: "s1", name: "Grep" },
      { id: "s2", name: "Grep" },
      { id: "s3", name: "Bash" },
      { id: "s4", name: "Bash" },
    ];
    // Wave 1 pair
    for (const t of allTools.slice(0, 2)) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    // Text fragment between tool groups (streaming artifact)
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Running searches..." },
    });
    // Wave 2 pair
    for (const t of allTools.slice(2)) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }

    // message_end with all 4 tools — authoritative parallel set
    sendMessage(msgEndWithTools(allTools));

    // tool_execution_start for all 4
    for (const t of allTools) {
      sendMessage({
        type: "tool_execution_start",
        toolCallId: t.id,
        toolName: t.name,
        args: { command: `test-${t.id}` },
      });
    }

    // All 4 tools must be in ONE batch, not split into 2-tool sealed batches
    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(1);
    const segments = batches[0].querySelectorAll(
      ".gsd-parallel-batch-content .gsd-tool-segment",
    );
    expect(segments.length).toBe(4);
    const ids = Array.from(segments)
      .map((el) => (el as HTMLElement).dataset.toolId!)
      .sort();
    expect(ids).toEqual(["s1", "s2", "s3", "s4"]);

    // No orphaned tools outside batches
    const looseSegments = messagesContainer.querySelectorAll(
      ".gsd-assistant-turn > .gsd-tool-segment",
    );
    expect(looseSegments.length).toBe(0);
  });

  it("PRODUCTION BUG: 3 tool waves with text blocks in single message_end must split into 3 batches", () => {
    // Claude Code sends all tool waves in one API message when the model emits
    // text between parallel tool groups within a single response. The message_end
    // content looks like: [tool×5, text, tool×5, text, tool×4]. Each contiguous
    // run of tool blocks must be a separate batch; text blocks are wave boundaries.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    const wave1 = [
      { id: "m1", name: "Read" },
      { id: "m2", name: "Read" },
      { id: "m3", name: "Read" },
    ];
    const wave2 = [
      { id: "m4", name: "Read" },
      { id: "m5", name: "Read" },
      { id: "m6", name: "Read" },
    ];
    const wave3 = [
      { id: "m7", name: "Read" },
      { id: "m8", name: "Read" },
    ];

    // Streaming: all toolcall_start events arrive first
    for (const t of [...wave1, ...wave2, ...wave3]) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }

    // Single message_end with text blocks separating tool waves
    sendMessage({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Wave 1: 3 parallel reads." },
          ...wave1.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
          { type: "text", text: "Wave 1 done. Wave 2: 3 more reads." },
          ...wave2.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
          { type: "text", text: "Wave 2 done. Wave 3: 2 reads." },
          ...wave3.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
        ],
      },
    });

    // tool_execution_start for all
    for (const t of [...wave1, ...wave2, ...wave3]) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    const batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(3);

    const batchIds = Array.from(batches).map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
        .map((el) => el.dataset.toolId!)
        .sort(),
    );
    expect(batchIds).toContainEqual(["m1", "m2", "m3"]);
    expect(batchIds).toContainEqual(["m4", "m5", "m6"]);
    expect(batchIds).toContainEqual(["m7", "m8"]);
  });

  it("REGRESSION: 3 waves in single message_end with text separators must survive agent_end", () => {
    // Same as the "3 tool waves with text blocks in single message_end" test
    // but extended through agent_end to catch merging during turn finalization.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    const wave1 = [
      { id: "x1", name: "Read" },
      { id: "x2", name: "Glob" },
    ];
    const wave2 = [
      { id: "x3", name: "Bash" },
      { id: "x4", name: "Bash" },
    ];
    const wave3 = [
      { id: "x5", name: "Grep" },
      { id: "x6", name: "Glob" },
    ];

    // Streaming: all toolcall_start events
    for (const t of [...wave1, ...wave2, ...wave3]) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }

    // Text deltas between waves (narration)
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 1 done." },
    });

    // Single message_end with text blocks separating tool waves
    sendMessage({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Wave 1: Read + Glob" },
          ...wave1.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
          { type: "text", text: "Wave 2: Bash + Bash" },
          ...wave2.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
          { type: "text", text: "Wave 3: Grep + Glob" },
          ...wave3.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
        ],
      },
    });

    // tool_execution_start + end for all
    for (const t of [...wave1, ...wave2, ...wave3]) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of [...wave1, ...wave2, ...wave3]) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Before agent_end: 3 batches
    let batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(3);

    // agent_end
    sendMessage({ type: "agent_end" });

    // After agent_end: still 3 batches
    batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(3);

    const batchIds = Array.from(batches).map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
        .map((el) => el.dataset.toolId!)
        .sort(),
    );
    expect(batchIds).toContainEqual(["x1", "x2"]);
    expect(batchIds).toContainEqual(["x3", "x4"]);
    expect(batchIds).toContainEqual(["x5", "x6"]);
  });

  it("REGRESSION: realistic streaming order (text→tools interleaved) must keep 3 batches after agent_end", () => {
    // Matches real Claude streaming: text_delta before each wave, toolcall_start
    // events interleaved with text_delta between waves. The text_delta handler
    // seals the active batch. message_end arrives last with the authoritative
    // wave structure. agent_end must not merge the batches.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    const wave1 = [
      { id: "y1", name: "Read" },
      { id: "y2", name: "Glob" },
    ];
    const wave2 = [
      { id: "y3", name: "Bash" },
      { id: "y4", name: "Bash" },
    ];
    const wave3 = [
      { id: "y5", name: "Grep" },
      { id: "y6", name: "Glob" },
    ];

    // Realistic streaming order: text → tools → text → tools → text → tools
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 1: Read + Glob" },
    });
    for (const t of wave1) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    // Text between waves seals wave1 batch
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 2: Bash + Bash" },
    });
    for (const t of wave2) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    // Text between waves seals wave2 batch
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 3: Grep + Glob" },
    });
    for (const t of wave3) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }

    // message_end with text blocks separating tool waves
    sendMessage({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Wave 1: Read + Glob" },
          ...wave1.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
          { type: "text", text: "Wave 2: Bash + Bash" },
          ...wave2.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
          { type: "text", text: "Wave 3: Grep + Glob" },
          ...wave3.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
        ],
      },
    });

    // tool_execution_start + end for all
    for (const t of [...wave1, ...wave2, ...wave3]) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of [...wave1, ...wave2, ...wave3]) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Before agent_end: should have 3 batches
    let batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(3);

    // agent_end
    sendMessage({ type: "agent_end" });

    // After: still 3 batches
    batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(3);

    const batchIds = Array.from(batches).map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
        .map((el) => el.dataset.toolId!)
        .sort(),
    );
    expect(batchIds).toContainEqual(["y1", "y2"]);
    expect(batchIds).toContainEqual(["y3", "y4"]);
    expect(batchIds).toContainEqual(["y5", "y6"]);
  });

  it("REGRESSION: execution events interleaved during streaming — batches must survive agent_end", () => {
    // In production, tool_execution_start/end can fire DURING streaming of the
    // same message (Claude Code dispatches tools as soon as it sees the block).
    // Wave 1 tools might start executing before wave 2 toolcall_start events arrive.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    const wave1 = [
      { id: "z1", name: "Read" },
      { id: "z2", name: "Glob" },
    ];
    const wave2 = [
      { id: "z3", name: "Bash" },
      { id: "z4", name: "Bash" },
    ];
    const wave3 = [
      { id: "z5", name: "Grep" },
      { id: "z6", name: "Glob" },
    ];

    // Wave 1 toolcall_start
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 1:" },
    });
    for (const t of wave1) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }

    // Wave 1 tool_execution_start fires during streaming (before text_delta)
    for (const t of wave1) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    // Wave 1 tool_execution_end fires during streaming
    for (const t of wave1) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Text between waves seals wave1 batch
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 2:" },
    });
    for (const t of wave2) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    for (const t of wave2) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave2) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Text between waves
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 3:" },
    });
    for (const t of wave3) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    for (const t of wave3) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave3) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // message_end with authoritative wave structure
    sendMessage({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Wave 1:" },
          ...wave1.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
          { type: "text", text: "Wave 2:" },
          ...wave2.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
          { type: "text", text: "Wave 3:" },
          ...wave3.map(t => ({ type: "tool_use", id: t.id, name: t.name, input: {} })),
        ],
      },
    });

    // Before agent_end: 3 batches
    let batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(3);

    // agent_end
    sendMessage({ type: "agent_end" });

    // After: still 3 batches
    batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(3);

    const batchIds = Array.from(batches).map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
        .map((el) => el.dataset.toolId!)
        .sort(),
    );
    expect(batchIds).toContainEqual(["z1", "z2"]);
    expect(batchIds).toContainEqual(["z3", "z4"]);
    expect(batchIds).toContainEqual(["z5", "z6"]);
  });

  it("REGRESSION: 3 separate API messages (one per wave) must keep batches after agent_end", () => {
    // Matches the Claude Code scenario: each wave is a separate API message
    // with its own message_start/message_end. During streaming, text_delta
    // and toolcall_start events create proper wave boundaries. On agent_end,
    // all batches must survive — they must NOT merge into one.
    sendMessage({ type: "agent_start" });

    // ── Wave 1: 3 tools ──
    sendMessage({ type: "message_start" });
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 1: 3 reads." },
    });
    const wave1 = [
      { id: "v1", name: "Read" },
      { id: "v2", name: "Glob" },
      { id: "v3", name: "Grep" },
    ];
    for (const t of wave1) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    sendMessage(msgEndWithTools(wave1));
    for (const t of wave1) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave1) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // ── Wave 2: 3 tools ──
    sendMessage({ type: "message_start" });
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 2: 3 bash." },
    });
    const wave2 = [
      { id: "v4", name: "Bash" },
      { id: "v5", name: "Bash" },
      { id: "v6", name: "Bash" },
    ];
    for (const t of wave2) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    sendMessage(msgEndWithTools(wave2));
    for (const t of wave2) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave2) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // ── Wave 3: 2 tools ──
    sendMessage({ type: "message_start" });
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Wave 3: 2 tools." },
    });
    const wave3 = [
      { id: "v7", name: "Grep" },
      { id: "v8", name: "Glob" },
    ];
    for (const t of wave3) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    sendMessage(msgEndWithTools(wave3));
    for (const t of wave3) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave3) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Verify: 3 separate batches during streaming
    let batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(3);

    // ── agent_end: finalize the turn ──
    sendMessage({ type: "agent_end" });

    // After agent_end, the 3 batches must still be 3 separate batches
    batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(3);

    const batchIds = Array.from(batches).map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
        .map((el) => el.dataset.toolId!)
        .sort(),
    );
    expect(batchIds).toContainEqual(["v1", "v2", "v3"]);
    expect(batchIds).toContainEqual(["v4", "v5", "v6"]);
    expect(batchIds).toContainEqual(["v7", "v8"]);
  });

  it("REGRESSION: orphaned batch from mid-stream finalize must not duplicate tools after agent_end", () => {
    // Scenario: batch finalized by text_delta (ref cleared), then agent_end.
    // The orphaned batch element must stay intact — no tool duplication.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    // 3 tools streamed in
    const tools = [
      { id: "o1", name: "Bash" },
      { id: "o2", name: "Bash" },
      { id: "o3", name: "Read" },
    ];
    for (const t of tools) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }

    // message_end with the 3 tools
    sendMessage(msgEndWithTools(tools));

    // tool_execution_start + end for all 3
    for (const t of tools) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of tools) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Text delta after tools complete — this triggers batch finalization + clearFinalizedBatch
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "All done." },
    });

    // At this point the batch is finalized, its ref is cleared.
    // Verify there's 1 batch with 3 tools, no orphan duplication.
    let batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(1);
    expect(batches[0].querySelectorAll(".gsd-tool-segment[data-tool-id]").length).toBe(3);

    // No tool segments should exist outside the batch
    const turnEl = messagesContainer.querySelector(".gsd-assistant-turn");
    if (turnEl) {
      const directToolSegments = Array.from(turnEl.children).filter(
        (el) => el.classList.contains("gsd-tool-segment"),
      );
      expect(directToolSegments.length).toBe(0);
    }

    // agent_end: finalize the turn
    sendMessage({ type: "agent_end" });

    // After agent_end, still 1 batch with 3 tools, no duplication
    batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(1);
    expect(batches[0].querySelectorAll(".gsd-tool-segment[data-tool-id]").length).toBe(3);

    // No tool segments outside the batch after finalization
    const turnElAfter = messagesContainer.querySelector(".gsd-assistant-turn");
    if (turnElAfter) {
      const directToolSegments = Array.from(turnElAfter.children).filter(
        (el) => el.classList.contains("gsd-tool-segment"),
      );
      expect(directToolSegments.length).toBe(0);
    }

    // Each tool segment should appear exactly once in the entire turn
    for (const t of tools) {
      const allSegments = messagesContainer.querySelectorAll(`.gsd-tool-segment[data-tool-id="${t.id}"]`);
      expect(allSegments.length).toBe(1);
    }
  });

  it("REGRESSION: multi-message turn with mid-stream finalizations must not create orphaned batches at agent_end", () => {
    // Scenario: 2 separate API messages, each with 3 tools. Text between them
    // finalizes the first batch. After all tools complete and agent_end fires,
    // there should be exactly 2 batches (one per message), no orphans.
    sendMessage({ type: "agent_start" });

    // ── Message 1: 3 tools ──
    sendMessage({ type: "message_start" });
    const wave1 = [
      { id: "m1", name: "Bash" },
      { id: "m2", name: "Read" },
      { id: "m3", name: "Grep" },
    ];
    for (const t of wave1) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    sendMessage(msgEndWithTools(wave1));
    for (const t of wave1) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave1) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // ── Message 2: narration then 3 more tools ──
    sendMessage({ type: "message_start" });
    // This text_delta should finalize/seal the wave1 batch
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Now doing wave 2." },
    });
    const wave2 = [
      { id: "m4", name: "Bash" },
      { id: "m5", name: "Bash" },
      { id: "m6", name: "Write" },
    ];
    for (const t of wave2) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    sendMessage(msgEndWithTools(wave2));
    for (const t of wave2) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave2) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // Text after wave 2 — this finalizes wave 2's batch
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "All done now." },
    });

    // Before agent_end: should have 2 batches
    let batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(2);

    // agent_end
    sendMessage({ type: "agent_end" });

    // After agent_end: still 2 batches, no orphan duplication
    batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(2);

    // Each tool segment appears exactly once
    for (const t of [...wave1, ...wave2]) {
      const segs = messagesContainer.querySelectorAll(`.gsd-tool-segment[data-tool-id="${t.id}"]`);
      expect(segs.length).toBe(1);
    }

    // Verify wave1 tools are in first batch, wave2 in second
    const batch1Ids = Array.from(batches[0].querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
      .map(el => el.dataset.toolId!).sort();
    const batch2Ids = Array.from(batches[1].querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
      .map(el => el.dataset.toolId!).sort();
    expect(batch1Ids).toEqual(["m1", "m2", "m3"]);
    expect(batch2Ids).toEqual(["m4", "m5", "m6"]);
  });

  it("REGRESSION: tool_execution_start must not pull completed-batch tools into a later batch", () => {
    // Root cause of the "all tools collapse to first container at turn end" bug:
    // message_end for wave 1 creates batch {A,B,C} and finalizes it. Wave 2
    // message_end creates batch {D,E}. Then tool_execution_start for A fires —
    // A.isParallel is true, A is not in a sealed batch, so the handler tries to
    // add it to the active batch ({D,E}), pulling it out of its completed batch.
    // Fix: isInCompletedBatch() checks the DOM for .gsd-parallel-batch.done ancestors.
    sendMessage({ type: "agent_start" });

    // ── Wave 1: 3 tools, fully complete ──
    sendMessage({ type: "message_start" });
    const wave1 = [
      { id: "cb1", name: "Read" },
      { id: "cb2", name: "Glob" },
      { id: "cb3", name: "Grep" },
    ];
    for (const t of wave1) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    sendMessage(msgEndWithTools(wave1));
    for (const t of wave1) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }
    for (const t of wave1) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // ── Wave 2: 2 tools ──
    sendMessage({ type: "message_start" });
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Now wave 2." },
    });
    const wave2 = [
      { id: "cb4", name: "Bash" },
      { id: "cb5", name: "Bash" },
    ];
    for (const t of wave2) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }
    sendMessage(msgEndWithTools(wave2));

    // CRITICAL: tool_execution_start for wave 2 fires — this used to trigger
    // the bug where wave 1 tools got pulled into wave 2's batch.
    for (const t of wave2) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    // Also simulate late tool_execution_start for wave 1 tools (backend quirk)
    for (const t of wave1) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    // Must have 2 separate batches
    let batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(2);

    // Wave 1 tools stay in their batch
    const batch1Ids = Array.from(batches[0].querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
      .map(el => el.dataset.toolId!).sort();
    expect(batch1Ids).toEqual(["cb1", "cb2", "cb3"]);

    // Wave 2 tools stay in their batch
    const batch2Ids = Array.from(batches[1].querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"))
      .map(el => el.dataset.toolId!).sort();
    expect(batch2Ids).toEqual(["cb4", "cb5"]);

    // agent_end must not merge them
    sendMessage({ type: "agent_end" });
    batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(2);
  });

  it("REGRESSION: tool_execution events arriving AFTER batch finalized by text_delta must not create duplicate batch", () => {
    // Scenario: streaming creates batch → text_delta finalizes → clearFinalizedBatch
    // → tool_execution_start arrives late → syncBatchState might create a new batch
    // while the old one is still in the DOM as an orphan.
    sendMessage({ type: "agent_start" });
    sendMessage({ type: "message_start" });

    const tools = [
      { id: "late1", name: "Bash" },
      { id: "late2", name: "Bash" },
      { id: "late3", name: "Read" },
    ];

    // Streaming creates tool segments
    for (const t of tools) {
      sendMessage({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          toolCall: { type: "toolCall", id: t.id, name: t.name },
          contentIndex: 0,
          partial: { content: [{ type: "toolCall", id: t.id, name: t.name }] },
        },
      });
    }

    // message_end with the 3 tools
    sendMessage(msgEndWithTools(tools));

    // Text delta BEFORE execution events — finalizes the batch
    sendMessage({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Running tools..." },
    });

    // Now tool_execution_start events arrive (late, after batch already finalized)
    for (const t of tools) {
      sendMessage({ type: "tool_execution_start", toolCallId: t.id, toolName: t.name, args: {} });
    }

    // Check: should still be 1 batch, not 2
    let batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(1);

    // Tools complete
    for (const t of tools) {
      sendMessage({
        type: "tool_execution_end",
        toolCallId: t.id,
        isError: false,
        durationMs: 50,
        result: { content: [{ text: "ok" }] },
      });
    }

    // agent_end
    sendMessage({ type: "agent_end" });

    // After finalization: 1 batch with all 3 tools
    batches = messagesContainer.querySelectorAll(".gsd-parallel-batch");
    expect(batches.length).toBe(1);
    expect(batches[0].querySelectorAll(".gsd-tool-segment[data-tool-id]").length).toBe(3);

    // No duplicate tool segments
    for (const t of tools) {
      const segs = messagesContainer.querySelectorAll(`.gsd-tool-segment[data-tool-id="${t.id}"]`);
      expect(segs.length).toBe(1);
    }
  });
});
