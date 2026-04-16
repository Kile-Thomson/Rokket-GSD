/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { type ToolCallState, type AssistantTurn } from "../../state";

/** Create a minimal turn for testing */
function createTurn(): AssistantTurn {
  return {
    id: "turn-1",
    segments: [],
    toolCalls: new Map(),
    isComplete: false,
    timestamp: Date.now(),
  };
}

/** Simulate tool_execution_start logic from message-handler */
function simulateToolStart(turn: AssistantTurn, toolCallId: string, toolName: string): ToolCallState {
  const runningTools: ToolCallState[] = [];
  for (const [, existing] of turn.toolCalls) {
    if (existing.isRunning) runningTools.push(existing);
  }

  const tc: ToolCallState = {
    id: toolCallId,
    name: toolName,
    args: {},
    resultText: "",
    isError: false,
    isRunning: true,
    startTime: Date.now(),
    isParallel: runningTools.length > 0,
  };

  // Mark previously-running tools as parallel
  if (runningTools.length > 0) {
    for (const rt of runningTools) {
      rt.isParallel = true;
    }
  }

  turn.toolCalls.set(toolCallId, tc);
  turn.segments.push({ type: "tool", toolCallId });
  return tc;
}

/** Simulate tool_execution_end */
function simulateToolEnd(turn: AssistantTurn, toolCallId: string): void {
  const tc = turn.toolCalls.get(toolCallId);
  if (tc) {
    tc.isRunning = false;
    tc.endTime = Date.now();
  }
}

describe("Parallel tool detection", () => {
  let turn: AssistantTurn;

  beforeEach(() => {
    turn = createTurn();
  });

  it("single tool is not marked parallel", () => {
    const tc = simulateToolStart(turn, "t1", "Read");
    expect(tc.isParallel).toBe(false);
  });

  it("second concurrent tool marks both as parallel", () => {
    const tc1 = simulateToolStart(turn, "t1", "Read");
    expect(tc1.isParallel).toBe(false);

    const tc2 = simulateToolStart(turn, "t2", "Bash");
    expect(tc2.isParallel).toBe(true);
    expect(tc1.isParallel).toBe(true);
  });

  it("third concurrent tool is also parallel", () => {
    const tc1 = simulateToolStart(turn, "t1", "Read");
    const tc2 = simulateToolStart(turn, "t2", "Bash");
    const tc3 = simulateToolStart(turn, "t3", "Write");

    expect(tc1.isParallel).toBe(true);
    expect(tc2.isParallel).toBe(true);
    expect(tc3.isParallel).toBe(true);
  });

  it("sequential tools (no overlap) are not parallel", () => {
    const tc1 = simulateToolStart(turn, "t1", "Read");
    simulateToolEnd(turn, "t1");

    const tc2 = simulateToolStart(turn, "t2", "Write");
    expect(tc1.isParallel).toBe(false);
    expect(tc2.isParallel).toBe(false);
  });

  it("tool started after first completes but while second is running", () => {
    const tc1 = simulateToolStart(turn, "t1", "Read");
    simulateToolEnd(turn, "t1");

    const tc2 = simulateToolStart(turn, "t2", "Bash");
    expect(tc2.isParallel).toBe(false);

    const tc3 = simulateToolStart(turn, "t3", "Write");
    expect(tc2.isParallel).toBe(true);
    expect(tc3.isParallel).toBe(true);
    // tc1 was already done — should remain not parallel
    expect(tc1.isParallel).toBe(false);
  });
});

describe("Parallel batch tracking", () => {
  let turn: AssistantTurn;
  let batchToolIds: Set<string> | null;

  function simulateBatchStart(toolCallId: string, toolName: string): ToolCallState {
    const tc = simulateToolStart(turn, toolCallId, toolName);
    const running = [...turn.toolCalls.values()].filter(t => t.isRunning && t.id !== toolCallId);
    if (running.length > 0) {
      if (!batchToolIds) {
        batchToolIds = new Set([...running.map(t => t.id), tc.id]);
      } else {
        batchToolIds.add(tc.id);
      }
    }
    return tc;
  }

  function simulateBatchEnd(toolCallId: string): boolean {
    simulateToolEnd(turn, toolCallId);
    if (!batchToolIds?.has(toolCallId)) return false;
    const allDone = [...batchToolIds].every(id => {
      const t = turn.toolCalls.get(id);
      return t && !t.isRunning;
    });
    if (allDone) {
      batchToolIds = null;
      return true;
    }
    return false;
  }

  beforeEach(() => {
    turn = createTurn();
    batchToolIds = null;
  });

  it("single tool does not create a batch", () => {
    simulateBatchStart("t1", "Read");
    expect(batchToolIds).toBeNull();
  });

  it("two concurrent tools create a batch with both IDs", () => {
    simulateBatchStart("t1", "Read");
    simulateBatchStart("t2", "Bash");
    expect(batchToolIds).not.toBeNull();
    expect(batchToolIds!.has("t1")).toBe(true);
    expect(batchToolIds!.has("t2")).toBe(true);
    expect(batchToolIds!.size).toBe(2);
  });

  it("third concurrent tool expands the batch", () => {
    simulateBatchStart("t1", "Read");
    simulateBatchStart("t2", "Bash");
    simulateBatchStart("t3", "Write");
    expect(batchToolIds!.size).toBe(3);
  });

  it("batch finalizes when all tools complete", () => {
    simulateBatchStart("t1", "Read");
    simulateBatchStart("t2", "Bash");
    simulateBatchStart("t3", "Write");

    expect(simulateBatchEnd("t1")).toBe(false);
    expect(batchToolIds).not.toBeNull();

    expect(simulateBatchEnd("t2")).toBe(false);
    expect(batchToolIds).not.toBeNull();

    expect(simulateBatchEnd("t3")).toBe(true);
    expect(batchToolIds).toBeNull();
  });

  it("sequential tools after a completed batch do not start a new batch", () => {
    simulateBatchStart("t1", "Read");
    simulateBatchStart("t2", "Bash");
    simulateBatchEnd("t1");
    simulateBatchEnd("t2");
    expect(batchToolIds).toBeNull();

    simulateBatchStart("t3", "Write");
    expect(batchToolIds).toBeNull();
  });

  it("new parallel tools after a completed batch create a new batch", () => {
    simulateBatchStart("t1", "Read");
    simulateBatchStart("t2", "Bash");
    simulateBatchEnd("t1");
    simulateBatchEnd("t2");

    simulateBatchStart("t3", "Write");
    simulateBatchStart("t4", "Edit");
    expect(batchToolIds).not.toBeNull();
    expect(batchToolIds!.has("t3")).toBe(true);
    expect(batchToolIds!.has("t4")).toBe(true);
    expect(batchToolIds!.size).toBe(2);
  });
});
