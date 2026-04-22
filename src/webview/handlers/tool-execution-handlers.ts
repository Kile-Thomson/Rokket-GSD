import type { ExtensionToWebviewMessage } from "../../shared/types";
type Msg<T extends ExtensionToWebviewMessage['type']> = Extract<ExtensionToWebviewMessage, { type: T }>;
import { state, type ToolCallState } from "../state";
import * as renderer from "../renderer";
import { scrollToBottom } from "../helpers";
import { BATCH_FINALIZE_DELAY_MS } from "../../shared/constants";
import {
  getDeps,
  getActiveBatchToolIds,
  setActiveBatchToolIds,
  getBatchFinalizeTimer,
  setBatchFinalizeTimer,
  getMessageParallelToolIds,
  getLastMessageUsage,
  updateSkillPills,
} from "./handler-state";

// ============================================================
// Staggered tool-end queue
// ============================================================

const toolEndQueue: Array<Msg<'tool_execution_end'>> = [];
let toolEndRafId: number | null = null;

function processToolEndQueue(): void {
  toolEndRafId = null;
  const data = toolEndQueue.shift();
  if (!data) return;

  renderToolEnd(data);

  if (toolEndQueue.length > 0) {
    toolEndRafId = requestAnimationFrame(processToolEndQueue);
  }
}

export function flushToolEndQueue(): void {
  if (toolEndRafId) {
    cancelAnimationFrame(toolEndRafId);
    toolEndRafId = null;
  }
  while (toolEndQueue.length > 0) {
    renderToolEnd(toolEndQueue.shift()!);
  }
}

function renderToolEnd(data: Msg<'tool_execution_end'>): void {
  renderer.updateToolSegmentElement(data.toolCallId);
  const { messagesContainer } = getDeps();

  const activeBatch = getActiveBatchToolIds();
  if (activeBatch?.has(data.toolCallId)) {
    const msgParallel = getMessageParallelToolIds();
    const fullSet = msgParallel
      ? new Set([...activeBatch, ...msgParallel])
      : activeBatch;
    const allDone = [...fullSet].every(id => {
      const t = state.currentTurn?.toolCalls.get(id);
      return t && !t.isRunning;
    });
    console.debug(`[gsd:parallel] renderToolEnd: id=${data.toolCallId} batchSize=${activeBatch?.size} fullSetSize=${fullSet.size} allDone=${allDone} hasMessageEnd=${!!msgParallel}`);
    if (allDone && msgParallel) {
      const timer = getBatchFinalizeTimer();
      if (timer) clearTimeout(timer);
      setBatchFinalizeTimer(setTimeout(() => {
        const batchIds = getActiveBatchToolIds();
        console.debug(`[gsd:parallel] batch FINALIZED (timer fired) — ${batchIds?.size ?? 0} tools`);
        renderer.finalizeParallelBatch(getLastMessageUsage());
        setBatchFinalizeTimer(null);
        setActiveBatchToolIds(null);
      }, BATCH_FINALIZE_DELAY_MS));
    }
    renderer.updateParallelBatchStatus();
  } else if (renderer.isInSealedBatch(data.toolCallId)) {
    // Tool belongs to a sealed batch (parented elsewhere than the active batch).
    // tickSealedBatches updates labels and finalizes any sealed batch whose tools have all finished.
  }
  renderer.tickSealedBatches(getLastMessageUsage());

  scrollToBottom(messagesContainer);
}

// ============================================================
// Tool execution handlers
// ============================================================

export function handleToolExecutionStart(msg: Msg<'tool_execution_start'>): void {
  if (!state.currentTurn) return;
  const data = msg;
  const activeBatch = getActiveBatchToolIds();
  const msgParallel = getMessageParallelToolIds();
  console.debug(`[gsd:parallel] tool_exec_start: ${data.toolName} id=${data.toolCallId} existingTc=${!!state.currentTurn.toolCalls.get(data.toolCallId)} batchActive=${!!activeBatch} batchSize=${activeBatch?.size ?? 0} msgParallel=${msgParallel?.size ?? 0}`);

  if (data.toolName?.toLowerCase() === "read" && typeof data.args?.path === "string") {
    const skillMatch = data.args.path.replace(/\\/g, "/").match(/(^|\/)skills\/([^/]+)\/SKILL\.md$/i);
    if (skillMatch) {
      const skillName = skillMatch[2];
      if (!state.loadedSkills.has(skillName)) {
        state.loadedSkills.add(skillName);
        updateSkillPills();
      }
    }
  }
  if (data.toolName?.toLowerCase() === "skill" && typeof data.args?.skill === "string") {
    const skillName = data.args.skill;
    if (!state.loadedSkills.has(skillName)) {
      state.loadedSkills.add(skillName);
      updateSkillPills();
    }
  }

  const isKnownParallel = msgParallel?.has(data.toolCallId) ?? false;

  const existingTc = state.currentTurn.toolCalls.get(data.toolCallId);
  if (existingTc) {
    existingTc.args = data.args || existingTc.args;
    existingTc.isRunning = true;
    if (isKnownParallel) existingTc.isParallel = true;
    if (!existingTc.isParallel) {
      // Only treat as parallel if another tool is actually running right now.
      // Segment adjacency would mark tools parallel even when their "neighbour"
      // in the list finished ages ago. Sealed-batch tools are also excluded so
      // a new wave after narration doesn't claim them.
      for (const [, other] of state.currentTurn.toolCalls) {
        if (other.isRunning && other.id !== existingTc.id && !renderer.isInSealedBatch(other.id)) {
          existingTc.isParallel = true;
          break;
        }
      }
    }
    renderer.updateToolSegmentElement(existingTc.id);

    if (isKnownParallel || existingTc.isParallel) {
      let batch = activeBatch;
      // If there's an existing batch but all its tools are already done
      // (it's only alive because of the finalize timer), flush it now rather
      // than extending it with a new wave.
      if (batch && !batch.has(existingTc.id)) {
        const hasRunningMember = [...batch].some(id => {
          const t = state.currentTurn!.toolCalls.get(id);
          return t?.isRunning && id !== existingTc.id;
        });
        if (!hasRunningMember) {
          const staleTimer = getBatchFinalizeTimer();
          if (staleTimer) { clearTimeout(staleTimer); setBatchFinalizeTimer(null); }
          console.debug(`[gsd:parallel] tool_exec_start: stale batch (${batch.size} done) — finalizing before new wave`);
          renderer.finalizeParallelBatch(getLastMessageUsage());
          setActiveBatchToolIds(null);
          batch = null;
        }
      }
      const timer = getBatchFinalizeTimer();
      if (timer) { clearTimeout(timer); setBatchFinalizeTimer(null); }
      if (!batch) {
        batch = msgParallel ? new Set(msgParallel) : new Set<string>();
        setActiveBatchToolIds(batch);
      }
      batch.add(existingTc.id);
      renderer.syncBatchState(batch);
    }

    return;
  }

  // Fallback: tool wasn't seen in streaming — create segment now.
  // Parallelism is determined by what's actually running, not by segment adjacency.
  // Sealed-batch tools are excluded so a new wave after narration doesn't absorb them.
  const runningTools: ToolCallState[] = [];
  for (const [, existing] of state.currentTurn.toolCalls) {
    if (existing.isRunning && !renderer.isInSealedBatch(existing.id)) runningTools.push(existing);
  }

  const fallbackIsParallel = isKnownParallel || runningTools.length > 0;

  const tc: ToolCallState = {
    id: data.toolCallId,
    name: data.toolName,
    args: data.args || {},
    resultText: "",
    isError: false,
    isRunning: true,
    startTime: Date.now(),
    isParallel: fallbackIsParallel,
  };

  if (fallbackIsParallel) {
    for (const rt of runningTools) {
      if (!rt.isParallel) {
        rt.isParallel = true;
        renderer.updateToolSegmentElement(rt.id);
      }
    }
  }

  state.currentTurn.toolCalls.set(data.toolCallId, tc);
  const segIdx = state.currentTurn.segments.length;
  state.currentTurn.segments.push({ type: "tool", toolCallId: data.toolCallId });

  renderer.appendToolSegmentElement(tc, segIdx);

  if (fallbackIsParallel) {
    let batch = activeBatch;
    if (batch && !batch.has(tc.id)) {
      const hasRunningMember = [...batch].some(id => {
        const t = state.currentTurn!.toolCalls.get(id);
        return t?.isRunning && id !== tc.id;
      });
      if (!hasRunningMember) {
        const staleTimer = getBatchFinalizeTimer();
        if (staleTimer) { clearTimeout(staleTimer); setBatchFinalizeTimer(null); }
        console.debug(`[gsd:parallel] tool_exec_start fallback: stale batch (${batch.size} done) — finalizing before new wave`);
        renderer.finalizeParallelBatch(getLastMessageUsage());
        setActiveBatchToolIds(null);
        batch = null;
      }
    }
    const timer = getBatchFinalizeTimer();
    if (timer) { clearTimeout(timer); setBatchFinalizeTimer(null); }
    if (!batch) {
      if (msgParallel) {
        batch = new Set(msgParallel);
        batch.add(tc.id);
      } else {
        batch = new Set([...runningTools.map(t => t.id), tc.id]);
      }
      setActiveBatchToolIds(batch);
    } else {
      batch.add(tc.id);
    }
    renderer.syncBatchState(batch);
  }

  const { messagesContainer } = getDeps();
  scrollToBottom(messagesContainer);
}

export function handleToolExecutionUpdate(msg: Msg<'tool_execution_update'>): void {
  const data = msg;
  let tc = state.currentTurn?.toolCalls.get(data.toolCallId);
  if (!tc) {
    for (let i = state.entries.length - 1; i >= 0; i--) {
      const entry = state.entries[i];
      if (entry.turn?.toolCalls.has(data.toolCallId)) {
        tc = entry.turn.toolCalls.get(data.toolCallId);
        break;
      }
    }
  }
  if (tc && data.partialResult) {
    const text = data.partialResult.content
      ?.map(c => c.text || "")
      .filter(Boolean)
      .join("\n");
    const filtered = text
      ? text.split("\n").filter((l: string) => !l.includes('"__async_subagent_progress"')).join("\n").trim()
      : text;
    if (filtered) tc.resultText = filtered;
    if (data.partialResult.details) tc.details = data.partialResult.details;
    renderer.updateToolSegmentElement(data.toolCallId);
    const { messagesContainer } = getDeps();
    scrollToBottom(messagesContainer);
  }
}

export function handleToolExecutionEnd(msg: Msg<'tool_execution_end'>): void {
  if (!state.currentTurn) return;
  console.debug(`[gsd:parallel] tool_exec_end: id=${msg.toolCallId} isError=${msg.isError} inBatch=${getActiveBatchToolIds()?.has(msg.toolCallId) ?? false}`);
  toolEndQueue.push(msg);
  const earlyTc = state.currentTurn.toolCalls.get(msg.toolCallId);
  if (earlyTc) {
    earlyTc.isRunning = false;
    earlyTc.isError = msg.isError;
    earlyTc.endTime = Date.now();
    if (msg.durationMs) earlyTc.endTime = earlyTc.startTime + msg.durationMs;
    if (msg.result) {
      const text = msg.result.content
        ?.map(c => c.text || "")
        .filter(Boolean)
        .join("\n");
      const filtered = text
        ? text.split("\n").filter((l: string) => !l.includes('"__async_subagent_progress"')).join("\n").trim()
        : text;
      if (filtered) earlyTc.resultText = filtered;
      if (msg.result.details) earlyTc.details = msg.result.details;
    }
    if (earlyTc.isError && earlyTc.resultText && /skipped due to queued user message/i.test(earlyTc.resultText)) {
      earlyTc.isSkipped = true;
      earlyTc.isError = false;
    }
  }
  if (!toolEndRafId) {
    toolEndRafId = requestAnimationFrame(processToolEndQueue);
  }
}
