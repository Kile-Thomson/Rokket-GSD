import type { ExtensionToWebviewMessage } from "../../shared/types";
type Msg<T extends ExtensionToWebviewMessage['type']> = Extract<ExtensionToWebviewMessage, { type: T }>;
import { state, nextId, type ToolCallState } from "../state";
import * as renderer from "../renderer";
import { scrollToBottom } from "../helpers";
import { announceToScreenReader } from "../a11y";
import * as uiDialogs from "../ui-dialogs";
import {
  getDeps,
  setLastMessageUsage,
  getHasCostUpdateSource,
  removeSteerNotes,
  resolveContextWindow,
  addSystemEntry,
  confirmBackendActive,
  getPrevMessageEndUsage,
  setPrevMessageEndUsage,
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
  setLastMessageUsage(null);
}

export function handleMessageUpdate(msg: Msg<'message_update'>): void {
  confirmBackendActive();
  if (!state.currentTurn) return;
  const delta = msg.assistantMessageEvent;
  const { messagesContainer, updateHeaderUI } = getDeps();

  if (!delta) return;

  if (delta.type === "text_delta" && delta.delta) {
    const text = delta.delta as string;

    removeSteerNotes();
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

          // Parallelism is determined by actual runtime overlap — which other tools
          // are still running right now?
          const streamingRunning: ToolCallState[] = [];
          for (const other of turn.toolCalls.values()) {
            if (other.isRunning && other.id !== block.id) {
              streamingRunning.push(other);
            }
          }
          const isStreamParallel = streamingRunning.length > 0;

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

          renderer.appendToolSegmentElement(tc, segIdx);

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
          if (text) existing.resultText = text;
        }
        if (tc2.externalResult.details) existing.details = tc2.externalResult.details;
        if (tc2.externalResult.isError) existing.isError = true;
        existing.isRunning = false;
        existing.endTime = Date.now();
        renderer.updateToolSegmentElement(tc2.id);

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

export function handleMessageEnd(msg: Msg<'message_end'>): void {
  const endMsg = msg.message;
  const { updateHeaderUI, updateFooterUI } = getDeps();

  if (endMsg?.content && state.currentTurn) {
    const blocks = Array.isArray(endMsg.content) ? endMsg.content as Array<Record<string, unknown>> : [];
    const toolBlockTypes = new Set([
      "tool_use",
      "toolCall",
      "tool-use",
      "serverToolUse",
      "server_tool_use",
    ]);
    const toolIds = blocks
      .filter(b => toolBlockTypes.has(b.type as string))
      .map(b => b.id)
      .filter(Boolean) as string[];
    if (toolIds.length >= 2) {
      for (const toolId of toolIds) {
        const tc = state.currentTurn.toolCalls.get(toolId);
        if (tc && !tc.isParallel) {
          tc.isParallel = true;
          renderer.updateToolSegmentElement(toolId);
        }
      }
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

      // pi's claude-code-cli adapter exposes a `perCallUsage` field on the
      // assistant message carrying the *last* API call's usage snapshot
      // (input, output, cacheRead, cacheWrite, totalTokens). That is the
      // authoritative signal for context window pressure — `usage` is a
      // session-wide running aggregate, not per-call.
      const perCall = (endMsg as Record<string, unknown>).perCallUsage as
        | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number }
        | undefined;

      if (!getHasCostUpdateSource()) {
        // cost_update is the authoritative session-total source in v2.
        // When absent (older providers), mirror pi's session-stat behaviour:
        // `usage` here is already cumulative across the session for
        // assistant messages, so take monotonic-max rather than accumulate.
        const curIn = u.input || 0;
        const curOut = u.output || 0;
        const curCR = u.cacheRead || 0;
        const curCW = u.cacheWrite || 0;
        if (!state.sessionStats.tokens) {
          state.sessionStats.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
        }
        const t = state.sessionStats.tokens;
        t.input = Math.max(t.input, curIn);
        t.output = Math.max(t.output, curOut);
        t.cacheRead = Math.max(t.cacheRead, curCR);
        t.cacheWrite = Math.max(t.cacheWrite, curCW);
        t.total = t.input + t.output + t.cacheRead + t.cacheWrite;
        if (u.cost?.total) {
          state.sessionStats.cost = Math.max(state.sessionStats.cost || 0, u.cost.total);
        }
      }

      {
        // Context %: prefer perCallUsage.totalTokens (matches pi's own
        // calculateContextTokens exactly), fall back to the field sum.
        // Never delta-compute from `usage` — it's a session aggregate.
        const contextWindow = resolveContextWindow();
        if (contextWindow > 0) {
          state.sessionStats.contextWindow = contextWindow;
        }
        let contextTokens = 0;
        let source = "none";
        if (perCall && typeof perCall.totalTokens === "number" && perCall.totalTokens > 0) {
          contextTokens = perCall.totalTokens;
          source = "perCall.totalTokens";
        } else if (perCall) {
          contextTokens = (perCall.input || 0) + (perCall.output || 0) + (perCall.cacheRead || 0) + (perCall.cacheWrite || 0);
          if (contextTokens > 0) source = "perCall.sum";
        }
        if (contextTokens === 0) {
          // Fallback: usage is a session-cumulative aggregate, so compute
          // per-call tokens via delta from the previous message_end.
          const prev = getPrevMessageEndUsage();
          const dIn = (u.input || 0) - prev.input;
          const dOut = (u.output || 0) - prev.output;
          const dCR = (u.cacheRead || 0) - prev.cacheRead;
          const dCW = (u.cacheWrite || 0) - prev.cacheWrite;
          contextTokens = dIn + dOut + dCR + dCW;
          if (contextTokens > 0) source = "usage.delta";
        }
        // Always track cumulative usage for delta computation
        setPrevMessageEndUsage({
          input: u.input || 0,
          output: u.output || 0,
          cacheRead: u.cacheRead || 0,
          cacheWrite: u.cacheWrite || 0,
        });
        console.debug(`[gsd:context] ctx=${contextTokens}/${contextWindow} src=${source} perCall=${perCall ? JSON.stringify(perCall) : "n/a"}`);
        if (contextWindow > 0 && contextTokens > 0) {
          state.sessionStats.contextTokens = contextTokens;
          state.sessionStats.contextPercent = (contextTokens / contextWindow) * 100;
        }
      }
      updateHeaderUI();
      updateFooterUI();
    }
  }
}
