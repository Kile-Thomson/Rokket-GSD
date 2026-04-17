import type { ExtensionToWebviewMessage } from "../../shared/types";
type Msg<T extends ExtensionToWebviewMessage['type']> = Extract<ExtensionToWebviewMessage, { type: T }>;
import { state, nextId, type ToolCallState } from "../state";
import * as renderer from "../renderer";
import { scrollToBottom } from "../helpers";
import { BATCH_FINALIZE_DELAY_MS } from "../../shared/constants";
import { announceToScreenReader } from "../a11y";
import * as uiDialogs from "../ui-dialogs";
import {
  getDeps,
  getActiveBatchToolIds,
  setActiveBatchToolIds,
  getBatchFinalizeTimer,
  setBatchFinalizeTimer,
  getMessageParallelToolIds,
  setMessageParallelToolIds,
  getLastMessageUsage,
  setLastMessageUsage,
  getHasCostUpdateSource,
  removeSteerNotes,
  resolveContextWindow,
  addSystemEntry,
  confirmBackendActive,
} from "./handler-state";
import { flushToolEndQueue } from "./tool-execution-handlers";

export function handleAgentStart(msg: Msg<'agent_start'>): void {
  if (uiDialogs.hasPending()) {
    uiDialogs.expireAllPending("New turn started");
  }
  confirmBackendActive();
  state.isStreaming = true;
  const { updateInputUI } = getDeps();
  const isContinuation = !!msg.isContinuation && state.currentTurn === null;
  const lastEntry = state.entries[state.entries.length - 1];
  if (isContinuation && lastEntry?.type === "assistant" && lastEntry.turn) {
    state.currentTurn = lastEntry.turn;
    state.currentTurn.isComplete = false;
    renderer.resetStreamingState();
    updateInputUI();
    renderer.reattachTurnElement(lastEntry.id);
    announceToScreenReader("Assistant is continuing...");
  } else {
    state.currentTurn = {
      id: nextId(),
      segments: [],
      toolCalls: new Map(),
      isComplete: false,
      timestamp: Date.now(),
    };
    renderer.resetStreamingState();
    updateInputUI();
    renderer.ensureCurrentTurnElement();
    announceToScreenReader("Assistant is responding...");
  }
  removeSteerNotes();
}

export function handleAgentEnd(_msg: Msg<'agent_end'>): void {
  state.isStreaming = false;
  state.isPending = false;
  announceToScreenReader("Response complete.");
  state.processHealth = "responsive";
  flushToolEndQueue();
  if (uiDialogs.hasPending()) {
    uiDialogs.expireAllPending("Agent finished");
  }
  removeSteerNotes();
  const timer = getBatchFinalizeTimer();
  if (timer) { clearTimeout(timer); setBatchFinalizeTimer(null); }
  const batchIds = getActiveBatchToolIds();
  if (batchIds) { renderer.finalizeParallelBatch(getLastMessageUsage()); }
  setActiveBatchToolIds(null);
  setMessageParallelToolIds(null);
  renderer.clearActiveBatch();
  renderer.finalizeCurrentTurn();
  const { updateInputUI, updateOverlayIndicators, vscode } = getDeps();
  updateInputUI();
  updateOverlayIndicators();
  vscode.postMessage({ type: "get_session_stats" });
}

export function handleTurnStart(_msg: Msg<'turn_start'>): void {
  if (!state.currentTurn) {
    state.currentTurn = {
      id: nextId(),
      segments: [],
      toolCalls: new Map(),
      isComplete: false,
      timestamp: Date.now(),
    };
    renderer.resetStreamingState();
  }
}

export function handleTurnEnd(_msg: Msg<'turn_end'>): void {
  // No-op
}

export function handleMessageStart(_msg: Msg<'message_start'>): void {
  removeSteerNotes();
  setMessageParallelToolIds(null);
  setLastMessageUsage(null);
}

export function handleMessageUpdate(msg: Msg<'message_update'>): void {
  confirmBackendActive();
  if (!state.currentTurn) return;
  const delta = msg.assistantMessageEvent;
  const { messagesContainer, updateHeaderUI } = getDeps();

  if (!delta) return;

  if (delta.type === "text_delta" && delta.delta) {
    let text = delta.delta as string;
    if (text.includes('"__async_subagent_progress"')) {
      text = text
        .split("\n")
        .filter((line: string) => !line.includes('"__async_subagent_progress"'))
        .join("\n")
        .trim();
      if (!text) return;
    }

    removeSteerNotes();
    const activeBatch = getActiveBatchToolIds();
    const msgParallel = getMessageParallelToolIds();
    const timer = getBatchFinalizeTimer();
    if (activeBatch && msgParallel && !timer) {
      const fullSet = new Set([...activeBatch, ...msgParallel]);
      const allDone = [...fullSet].every(id => {
        const t = state.currentTurn?.toolCalls.get(id);
        return t && !t.isRunning;
      });
      if (allDone) {
        console.debug(`[gsd:parallel] text_delta: finalizing batch (${fullSet.size} tools) — text arrived`);
        renderer.finalizeParallelBatch(getLastMessageUsage());
        setActiveBatchToolIds(null);
      }
    }
    renderer.appendToTextSegment("text", text);
  } else if (delta.type === "thinking_delta" && delta.delta) {
    if (!state.thinkingLevel) {
      state.thinkingLevel = "medium";
      updateHeaderUI();
    }
    renderer.appendToTextSegment("thinking", delta.delta);
  } else if (delta.type === "server_tool_use") {
    const partial = delta.partial;
    const content = partial?.content;
    const idx = delta.contentIndex;
    if (Array.isArray(content) && typeof idx === "number" && idx >= 0 && idx < content.length) {
      const block = content[idx];
      if (block && block.type === "serverToolUse") {
        renderer.appendServerToolSegment(block.id, block.name, block.input);
      }
    }
  } else if (delta.type === "web_search_result") {
    const partial = delta.partial;
    const content = partial?.content;
    const idx = delta.contentIndex;
    if (Array.isArray(content) && typeof idx === "number" && idx >= 0 && idx < content.length) {
      const block = content[idx];
      if (block && block.type === "webSearchResult") {
        renderer.completeServerToolSegment(block.toolUseId, block.content);
      }
    }
  } else if (delta.type === "toolcall_start") {
    const partial = delta.partial;
    const content = partial?.content;
    const idx = delta.contentIndex;
    let block: Record<string, unknown> | null = null;
    if (Array.isArray(content) && typeof idx === "number" && idx >= 0 && idx < content.length) {
      block = content[idx] as Record<string, unknown>;
    }
    if (!block && delta.toolCall) {
      block = delta.toolCall as Record<string, unknown>;
    }
    console.debug(`[gsd:parallel] toolcall_start: block=${block?.name || 'null'} id=${block?.id || 'null'} type=${block?.type || 'null'}`);
    if (block) {
      const isToolBlock = block.type === "toolCall" || block.type === "tool_use" || block.type === "tool-use";
      if (isToolBlock && block.id && block.name) {
        const turn = state.currentTurn;
        if (!turn) return;
        if (!turn.toolCalls.has(block.id)) {
          const tc: ToolCallState = {
            id: block.id,
            name: block.name,
            args: {},
            resultText: "",
            isError: false,
            isRunning: true,
            startTime: Date.now(),
            isParallel: false,
          };
          const prevSeg = turn.segments.length > 0 ? turn.segments[turn.segments.length - 1] : null;
          const adjacentToTool = prevSeg?.type === "tool";
          const streamingRunning: ToolCallState[] = [];
          if (adjacentToTool) {
            for (let i = turn.segments.length - 1; i >= 0; i--) {
              const s = turn.segments[i];
              if (s.type === "tool" && s.toolCallId) {
                const adj = turn.toolCalls.get(s.toolCallId);
                if (adj?.isRunning) streamingRunning.push(adj);
              } else break;
            }
          }
          const isStreamParallel = streamingRunning.length > 0 || adjacentToTool;

          if (isStreamParallel) {
            tc.isParallel = true;
            for (const rt of streamingRunning) {
              if (!rt.isParallel) {
                rt.isParallel = true;
                renderer.updateToolSegmentElement(rt.id);
              }
            }
          }

          turn.toolCalls.set(block.id, tc);
          const segIdx = turn.segments.length;
          turn.segments.push({ type: "tool", toolCallId: block.id });

          if (adjacentToTool) {
            for (let i = turn.segments.length - 2; i >= 0; i--) {
              const s = turn.segments[i];
              if (s.type === "tool" && s.toolCallId) {
                const adj = turn.toolCalls.get(s.toolCallId);
                if (adj && !adj.isParallel) {
                  adj.isParallel = true;
                  renderer.updateToolSegmentElement(adj.id);
                }
              } else break;
            }
          }

          renderer.appendToolSegmentElement(tc, segIdx);

          let activeBatch = getActiveBatchToolIds();
          if (isStreamParallel || activeBatch) {
            const batchTimer = getBatchFinalizeTimer();
            if (batchTimer) {
              clearTimeout(batchTimer);
              setBatchFinalizeTimer(null);
            }
            if (!activeBatch) {
              const batchIdList: string[] = [tc.id];
              for (const rt of streamingRunning) batchIdList.push(rt.id);
              if (adjacentToTool) {
                for (let i = turn.segments.length - 2; i >= 0; i--) {
                  const s = turn.segments[i];
                  if (s.type === "tool" && s.toolCallId && !batchIdList.includes(s.toolCallId)) {
                    batchIdList.push(s.toolCallId);
                  } else if (s.type !== "tool") break;
                }
              }
              activeBatch = new Set(batchIdList);
              setActiveBatchToolIds(activeBatch);
            } else {
              activeBatch.add(tc.id);
            }
            renderer.syncBatchState(activeBatch);
          }

          scrollToBottom(messagesContainer);
        }
      }
    }
  } else if (delta.type === "toolcall_end") {
    const tc2 = delta.toolCall;
    if (tc2?.id && tc2.externalResult && state.currentTurn) {
      const existing = state.currentTurn.toolCalls.get(tc2.id);
      if (existing) {
        if (tc2.arguments && typeof tc2.arguments === "object") {
          existing.args = tc2.arguments;
        }
        const resultContent = tc2.externalResult.content;
        if (Array.isArray(resultContent)) {
          const text = resultContent
            .map((c: Record<string, unknown>) => (c.text as string) || "")
            .filter(Boolean)
            .join("\n");
          const filtered = text
            ? text.split("\n").filter((l: string) => !l.includes('"__async_subagent_progress"')).join("\n").trim()
            : text;
          if (filtered) existing.resultText = filtered;
        }
        if (tc2.externalResult.details) existing.details = tc2.externalResult.details;
        if (tc2.externalResult.isError) existing.isError = true;
        existing.isRunning = false;
        existing.endTime = Date.now();
        renderer.updateToolSegmentElement(tc2.id);

        const activeBatch = getActiveBatchToolIds();
        if (activeBatch?.has(tc2.id)) {
          renderer.updateParallelBatchStatus();
        }

        scrollToBottom(messagesContainer);
      }
    } else if (tc2?.id && tc2.arguments && typeof tc2.arguments === "object" && state.currentTurn) {
      const existing = state.currentTurn.toolCalls.get(tc2.id);
      if (existing) {
        existing.args = tc2.arguments;
        renderer.updateToolSegmentElement(tc2.id);
      }
    }
  } else if (delta.type === "toolcall_delta"
              || delta.type === "thinking_start" || delta.type === "thinking_end"
              || delta.type === "text_start" || delta.type === "text_end") {
    // Known streaming delta types — no action needed
  }
}

export function handleAsyncSubagentProgress(msg: Msg<'async_subagent_progress'>): void {
  if (!msg.toolCallId) return;

  const allToolBlocks = document.querySelectorAll<HTMLElement>(`[data-tool-id]`);
  let toolBlock: HTMLElement | null = null;
  allToolBlocks.forEach(el => {
    if (el.dataset.toolId === msg.toolCallId) toolBlock = el;
  });

  let tc: ToolCallState | undefined;
  tc = state.currentTurn?.toolCalls.get(msg.toolCallId);
  if (!tc) {
    for (let i = state.entries.length - 1; i >= 0; i--) {
      tc = state.entries[i].turn?.toolCalls.get(msg.toolCallId);
      if (tc) break;
    }
  }

  if (tc) {
    tc.details = { ...(tc.details || {}), mode: msg.mode, results: msg.results };
    const done = msg.results?.filter(r => r.exitCode === 0).length || 0;
    const running = msg.results?.filter(r => r.exitCode === -1).length || 0;
    const failed = msg.results?.filter(r => r.exitCode > 0).length || 0;
    const total = msg.results?.length || 0;
    tc.resultText = `${done}/${total} done, ${running} running${failed ? `, ${failed} failed` : ""}`;
    tc.isRunning = running > 0;
    tc.isError = failed > 0;
  }

  if (toolBlock && tc) {
    renderer.patchToolBlock(toolBlock, tc);
  }
}

export function handleMessageEnd(msg: Msg<'message_end'>): void {
  const endMsg = msg.message;
  const { updateHeaderUI, updateFooterUI } = getDeps();

  if (endMsg?.content && state.currentTurn) {
    const blocks = Array.isArray(endMsg.content) ? endMsg.content as Array<Record<string, unknown>> : [];
    console.debug(`[gsd:parallel] message_end: ${blocks.length} content blocks, types=[${blocks.map(b => b.type).join(",")}]`);
    const toolIds = blocks
      .filter(b => b.type === "tool_use" || b.type === "toolCall" || b.type === "tool-use")
      .map(b => b.id)
      .filter(Boolean) as string[];
    console.debug(`[gsd:parallel] message_end: ${toolIds.length} tool IDs found`);
    if (toolIds.length >= 2) {
      setMessageParallelToolIds(new Set(toolIds));
      for (const toolId of toolIds) {
        const tc = state.currentTurn.toolCalls.get(toolId);
        if (tc && !tc.isParallel) {
          tc.isParallel = true;
          renderer.updateToolSegmentElement(toolId);
        }
      }
      let activeBatch = getActiveBatchToolIds();
      if (!activeBatch) {
        activeBatch = new Set(toolIds);
        setActiveBatchToolIds(activeBatch);
      } else {
        for (const toolId of toolIds) {
          activeBatch.add(toolId);
        }
      }
      const timer = getBatchFinalizeTimer();
      if (timer) { clearTimeout(timer); setBatchFinalizeTimer(null); }
      renderer.syncBatchState(activeBatch);

      const allDone = [...activeBatch].every(id => {
        const t = state.currentTurn!.toolCalls.get(id);
        return t && !t.isRunning;
      });
      if (allDone) {
        setBatchFinalizeTimer(setTimeout(() => {
          console.debug(`[gsd:parallel] batch FINALIZED (post-message_end) — ${getActiveBatchToolIds()?.size ?? 0} tools`);
          renderer.finalizeParallelBatch(getLastMessageUsage());
          setBatchFinalizeTimer(null);
          setActiveBatchToolIds(null);
        }, BATCH_FINALIZE_DELAY_MS));
      }
    } else {
      setMessageParallelToolIds(null);
    }
  }
  if (endMsg?.role === "assistant") {
    if (endMsg.stopReason === "error" && endMsg.errorMessage) {
      addSystemEntry(endMsg.errorMessage, "error");
      announceToScreenReader(`Error: ${endMsg.errorMessage}`);
    }

    if (endMsg.usage) {
      const u = endMsg.usage;
      setLastMessageUsage(u);

      if (!getHasCostUpdateSource()) {
        if (!state.sessionStats.tokens) {
          state.sessionStats.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
        }
        const t = state.sessionStats.tokens;
        t.input += u.input || 0;
        t.output += u.output || 0;
        t.cacheRead += u.cacheRead || 0;
        t.cacheWrite += u.cacheWrite || 0;
        t.total = t.input + t.output + t.cacheRead + t.cacheWrite;
        if (u.cost?.total) {
          state.sessionStats.cost = (state.sessionStats.cost || 0) + u.cost.total;
        }
      }

      if (!getHasCostUpdateSource()) {
        const contextTokens = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
        const contextWindow = resolveContextWindow();
        if (contextWindow > 0 && contextTokens > 0) {
          state.sessionStats.contextTokens = contextTokens;
          state.sessionStats.contextWindow = contextWindow;
          state.sessionStats.contextPercent = (contextTokens / contextWindow) * 100;
          console.debug(`[gsd:context] message_end context%: ${(contextTokens / contextWindow * 100).toFixed(1)}% (tokens=${contextTokens}, window=${contextWindow})`);
        }
      }
      updateHeaderUI();
      updateFooterUI();
    }
  }
}
