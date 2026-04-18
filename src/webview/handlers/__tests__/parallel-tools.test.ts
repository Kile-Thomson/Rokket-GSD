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

// ============================================================
// Stale batch (finalize-timer grace window) behaviour
// ============================================================
//
// In the real code, `tool_execution_end` does not clear the batch immediately;
// it schedules a `BATCH_FINALIZE_DELAY_MS` timer and clears it then. If a new
// tool arrives during that grace window we must finalize the stale batch
// *before* creating a new one, otherwise the sequential wave gets bundled
// into the previous batch's visual container.
describe("Parallel batch — stale-window finalization", () => {
  let turn: AssistantTurn;
  let activeBatch: Set<string> | null;
  let batchTimerPending: boolean;
  let finalizedBatches: Array<string[]>;

  /** Mirror of the logic we fixed: "if the active batch has no running members
   *  and would be joined by a new tool, finalize it first". */
  function startTool(id: string, name: string): ToolCallState {
    const running = [...turn.toolCalls.values()].filter(t => t.isRunning);

    // Stale-batch guard — mirrors message-handler / tool-execution-handlers
    if (activeBatch && !activeBatch.has(id)) {
      const hasRunningMember = [...activeBatch].some(m => {
        const t = turn.toolCalls.get(m);
        return t?.isRunning && m !== id;
      });
      if (!hasRunningMember) {
        // stale batch — finalize now
        finalizedBatches.push([...activeBatch]);
        activeBatch = null;
        batchTimerPending = false;
      }
    }

    const tc = simulateToolStart(turn, id, name);

    if (running.length > 0) {
      // real concurrency — open or extend batch
      if (!activeBatch) {
        activeBatch = new Set([...running.map(t => t.id), tc.id]);
      } else {
        activeBatch.add(tc.id);
      }
      batchTimerPending = false;
    }
    return tc;
  }

  /** Mirror of tool_execution_end: when all batch members are done, set the
   *  "finalize pending" flag but keep the batch alive (simulating the 800ms
   *  debounce timer). */
  function endTool(id: string): void {
    simulateToolEnd(turn, id);
    if (!activeBatch?.has(id)) return;
    const allDone = [...activeBatch].every(m => !turn.toolCalls.get(m)?.isRunning);
    if (allDone) batchTimerPending = true;
  }

  /** Explicitly fire the finalize timer. */
  function fireFinalizeTimer(): void {
    if (batchTimerPending && activeBatch) {
      finalizedBatches.push([...activeBatch]);
      activeBatch = null;
      batchTimerPending = false;
    }
  }

  beforeEach(() => {
    turn = createTurn();
    activeBatch = null;
    batchTimerPending = false;
    finalizedBatches = [];
  });

  it("sequential wave during the finalize-timer grace window does NOT merge batches", () => {
    // Wave 1 — 3 parallel tools
    startTool("t1", "Read");
    startTool("t2", "Bash");
    startTool("t3", "Grep");
    expect(activeBatch!.size).toBe(3);

    // All of wave 1 complete — batch enters the grace window but stays alive
    endTool("t1");
    endTool("t2");
    endTool("t3");
    expect(batchTimerPending).toBe(true);
    expect(activeBatch).not.toBeNull();

    // Wave 2 — 2 parallel tools arrive BEFORE the timer fires
    const tc4 = startTool("t4", "Write");
    const tc5 = startTool("t5", "Edit");

    // The stale batch must have been finalized as its own closed batch…
    expect(finalizedBatches.length).toBe(1);
    expect(finalizedBatches[0].sort()).toEqual(["t1", "t2", "t3"]);

    // …and wave 2 must live in a fresh batch of just t4 + t5.
    expect(activeBatch).not.toBeNull();
    expect(activeBatch!.size).toBe(2);
    expect(activeBatch!.has("t4")).toBe(true);
    expect(activeBatch!.has("t5")).toBe(true);
    expect(activeBatch!.has("t1")).toBe(false);
    expect(tc4.isParallel).toBe(true);
    expect(tc5.isParallel).toBe(true);
  });

  it("a single sequential tool in the grace window finalizes the stale batch and does NOT join it", () => {
    // Wave 1 — 2 parallel
    startTool("t1", "Read");
    startTool("t2", "Bash");
    endTool("t1");
    endTool("t2");
    expect(batchTimerPending).toBe(true);

    // One sequential tool arrives during grace window
    const tc3 = startTool("t3", "Write");

    // Stale batch finalized as its own closed unit
    expect(finalizedBatches.length).toBe(1);
    expect(finalizedBatches[0].sort()).toEqual(["t1", "t2"]);

    // t3 is solo — no active batch, not parallel
    expect(activeBatch).toBeNull();
    expect(tc3.isParallel).toBe(false);
  });

  it("timer firing naturally (no new tools) finalizes the batch once", () => {
    startTool("t1", "Read");
    startTool("t2", "Bash");
    endTool("t1");
    endTool("t2");

    fireFinalizeTimer();
    expect(finalizedBatches.length).toBe(1);
    expect(activeBatch).toBeNull();

    // Subsequent sequential tool does not resurrect the batch
    const tc3 = startTool("t3", "Write");
    expect(activeBatch).toBeNull();
    expect(tc3.isParallel).toBe(false);
    expect(finalizedBatches.length).toBe(1);
  });
});

// ============================================================
// Sealed-batches: thought-cycle boundaries split concurrent waves
// ============================================================
//
// Scenario: agent narrates, spawns A+B+C (batch #1). While A/B/C are still
// running, the agent narrates again and spawns D+E. We want two distinct
// batches ([A,B,C] + [D,E]) — not a single merged [A,B,C,D,E] batch.
// The seal mechanism closes batch #1 to new additions while its members keep
// running, and opens a fresh batch for the D+E wave.
describe("Parallel batch — seal-on-narration boundary", () => {
  let turn: AssistantTurn;
  let activeBatch: Set<string> | null;
  const sealedBatches: Array<{ toolIds: Set<string> }> = [];
  let finalizedBatches: Array<string[]>;

  /** Is this tool currently inside a sealed batch? */
  function isInSealedBatch(id: string): boolean {
    return sealedBatches.some(s => s.toolIds.has(id));
  }

  /** Mirror of the seal-on-narration logic: seal the active batch so its
   *  running members keep their spot on screen but new waves open fresh. */
  function narrate(): void {
    if (!activeBatch) return;
    const allDone = [...activeBatch].every(id => !turn.toolCalls.get(id)?.isRunning);
    if (allDone) {
      finalizedBatches.push([...activeBatch]);
    } else if (activeBatch.size >= 2) {
      sealedBatches.push({ toolIds: new Set(activeBatch) });
    }
    activeBatch = null;
  }

  /** Mirror of tool_execution_start with sealed-batch exclusion. */
  function startTool(id: string, name: string): ToolCallState {
    const running = [...turn.toolCalls.values()].filter(
      t => t.isRunning && !isInSealedBatch(t.id),
    );

    const tc: ToolCallState = {
      id,
      name,
      args: {},
      resultText: "",
      isError: false,
      isRunning: true,
      startTime: Date.now(),
      isParallel: running.length > 0,
    };
    if (running.length > 0) for (const rt of running) rt.isParallel = true;

    turn.toolCalls.set(id, tc);
    turn.segments.push({ type: "tool", toolCallId: id });

    if (running.length > 0) {
      if (!activeBatch) {
        activeBatch = new Set([...running.map(t => t.id), id]);
      } else {
        activeBatch.add(id);
      }
    }
    return tc;
  }

  /** Mirror of tool_execution_end + tickSealedBatches. */
  function endTool(id: string): void {
    simulateToolEnd(turn, id);
    // Tick sealed batches: finalize any whose tools are all done.
    for (let i = sealedBatches.length - 1; i >= 0; i--) {
      const sealed = sealedBatches[i];
      const allDone = [...sealed.toolIds].every(tid => !turn.toolCalls.get(tid)?.isRunning);
      if (allDone) {
        finalizedBatches.push([...sealed.toolIds]);
        sealedBatches.splice(i, 1);
      }
    }
  }

  beforeEach(() => {
    turn = createTurn();
    activeBatch = null;
    sealedBatches.length = 0;
    finalizedBatches = [];
  });

  it("narration between waves produces two distinct batches, not one merged batch", () => {
    // Wave 1
    startTool("A", "Read");
    startTool("B", "Bash");
    startTool("C", "Grep");
    expect(activeBatch!.size).toBe(3);

    // Narration boundary (agent says something mid-wave). All three still running.
    narrate();
    expect(activeBatch).toBeNull();
    expect(sealedBatches.length).toBe(1);
    expect(sealedBatches[0].toolIds.size).toBe(3);

    // Wave 2 — D, E arrive while A/B/C still running.
    const tcD = startTool("D", "Write");
    const tcE = startTool("E", "Edit");

    // D+E must live in their own fresh batch.
    expect(activeBatch).not.toBeNull();
    expect(activeBatch!.size).toBe(2);
    expect(activeBatch!.has("D")).toBe(true);
    expect(activeBatch!.has("E")).toBe(true);
    expect(activeBatch!.has("A")).toBe(false);
    expect(tcD.isParallel).toBe(true);
    expect(tcE.isParallel).toBe(true);

    // Sealed batch still contains A/B/C only.
    expect(sealedBatches[0].toolIds.has("A")).toBe(true);
    expect(sealedBatches[0].toolIds.has("D")).toBe(false);
  });

  it("sealed batch finalizes independently when its own tools finish", () => {
    startTool("A", "Read");
    startTool("B", "Bash");
    narrate();
    startTool("C", "Write");
    startTool("D", "Edit");

    // Finish the sealed batch first — should finalize as its own unit.
    endTool("A");
    expect(finalizedBatches.length).toBe(0);
    endTool("B");
    expect(finalizedBatches.length).toBe(1);
    expect(finalizedBatches[0].sort()).toEqual(["A", "B"]);

    // The active batch with C+D is still running.
    expect(activeBatch).not.toBeNull();
    expect(activeBatch!.size).toBe(2);
  });

  it("sealed tools are NOT re-absorbed into a new wave's batch", () => {
    startTool("A", "Read");
    startTool("B", "Bash");
    narrate();
    // A solo tool after narration — with A/B still running but sealed, D must
    // NOT be marked parallel against A/B.
    const tcD = startTool("D", "Write");
    expect(tcD.isParallel).toBe(false);
    expect(activeBatch).toBeNull();
  });

  it("narration after all tools are done finalizes instead of sealing", () => {
    startTool("A", "Read");
    startTool("B", "Bash");
    endTool("A");
    endTool("B");

    narrate();
    expect(sealedBatches.length).toBe(0);
    expect(finalizedBatches.length).toBe(1);
    expect(finalizedBatches[0].sort()).toEqual(["A", "B"]);
  });

  it("single tool in active batch is dropped on seal (no 1-tool sealed batch)", () => {
    // Only one tool — never actually a batch.
    startTool("A", "Read");
    expect(activeBatch).toBeNull();

    narrate();
    expect(sealedBatches.length).toBe(0);
    expect(finalizedBatches.length).toBe(0);
  });
});
