import type { ExtensionToWebviewMessage } from "../../shared/types";
type Msg<T extends ExtensionToWebviewMessage['type']> = Extract<ExtensionToWebviewMessage, { type: T }>;
import { state, type ToolCallState } from "../state";
import * as renderer from "../renderer";
import { scrollToBottom } from "../helpers";
import {
  getDeps,
  updateSkillPills,
} from "./handler-state";

// ============================================================
// Staggered tool-end queue
// ============================================================

const toolEndQueue: Array<Msg<'tool_execution_end'>> = [];
let toolEndQueueHead = 0;
let toolEndRafId: number | null = null;

function processToolEndQueue(): void {
  toolEndRafId = null;
  if (toolEndQueueHead >= toolEndQueue.length) return;

  const data = toolEndQueue[toolEndQueueHead++];
  renderToolEnd(data);

  if (toolEndQueueHead < toolEndQueue.length) {
    toolEndRafId = requestAnimationFrame(processToolEndQueue);
  } else {
    // All items consumed — reset to avoid holding references
    toolEndQueue.length = 0;
    toolEndQueueHead = 0;
  }
}

export function flushToolEndQueue(): void {
  if (toolEndRafId) {
    cancelAnimationFrame(toolEndRafId);
    toolEndRafId = null;
  }
  while (toolEndQueueHead < toolEndQueue.length) {
    renderToolEnd(toolEndQueue[toolEndQueueHead++]);
  }
  toolEndQueue.length = 0;
  toolEndQueueHead = 0;
}

function renderToolEnd(data: Msg<'tool_execution_end'>): void {
  renderer.updateToolSegmentElement(data.toolCallId);
  const { messagesContainer } = getDeps();
  scrollToBottom(messagesContainer);
}

// ============================================================
// Tool execution handlers
// ============================================================

export function handleToolExecutionStart(msg: Msg<'tool_execution_start'>): void {
  if (!state.currentTurn) return;
  const data = msg;

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

  const existingTc = state.currentTurn.toolCalls.get(data.toolCallId);
  if (existingTc) {
    existingTc.args = data.args || existingTc.args;
    if (!existingTc.resultText) existingTc.isRunning = true;
    if (!existingTc.isParallel) {
      for (const [, other] of state.currentTurn.toolCalls) {
        if (other.isRunning && other.id !== existingTc.id) {
          existingTc.isParallel = true;
          break;
        }
      }
    }
    renderer.updateToolSegmentElement(existingTc.id);
    return;
  }

  // Fallback: tool wasn't seen in streaming — create segment now.
  const runningTools: ToolCallState[] = [];
  for (const [, existing] of state.currentTurn.toolCalls) {
    if (existing.isRunning) runningTools.push(existing);
  }

  const fallbackIsParallel = runningTools.length > 0;

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
    if (text) tc.resultText = text;
    if (data.partialResult.details) tc.details = data.partialResult.details;
    renderer.updateToolSegmentElement(data.toolCallId);
    const { messagesContainer } = getDeps();
    scrollToBottom(messagesContainer);
  }
}

export function handleToolExecutionEnd(msg: Msg<'tool_execution_end'>): void {
  if (!state.currentTurn) return;
  console.debug(`[gsd:parallel] tool_exec_end: id=${msg.toolCallId} isError=${msg.isError}`);
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
      if (text) earlyTc.resultText = text;
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
