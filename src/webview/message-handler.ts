// ============================================================
// Message Handler — processes events from the extension host
// ============================================================

import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  ProcessStatus,
} from "../shared/types";
import {
  escapeHtml,
  formatMarkdownNotes,
  formatShortDate,
  scrollToBottom,
} from "./helpers";
import {
  state,
  nextId,
  pruneOldEntries,
  resetPrunedCount,
  type ChatEntry,
  type ToolCallState,
  type TurnSegment,
} from "./state";
import * as renderer from "./renderer";
import * as sessionHistory from "./session-history";
import * as slashMenu from "./slash-menu";
import * as modelPicker from "./model-picker";
import * as thinkingPicker from "./thinking-picker";
import * as uiDialogs from "./ui-dialogs";
import * as toasts from "./toasts";
import * as dashboard from "./dashboard";
import * as autoProgress from "./auto-progress";
import * as visualizer from "./visualizer";
import * as fileHandling from "./file-handling";
import { announceToScreenReader, createFocusTrap, restoreFocus } from "./a11y";
import { registerTimeout } from "./dispose";
import { setChangelogHandlers, getChangelogTriggerEl, dismissChangelog } from "./keyboard";

// ============================================================
// Dependencies — set via init()
// ============================================================

let vscode: { postMessage(msg: unknown): void };
let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;
let promptInput: HTMLTextAreaElement;

// Callbacks into index.ts UI functions
let updateAllUI: () => void;
let updateHeaderUI: () => void;
let updateFooterUI: () => void;
let updateInputUI: () => void;
let updateOverlayIndicators: () => void;
let updateWorkflowBadge: (wf: any) => void;
let handleModelRouted: (oldModel: any, newModel: any) => void;
let autoResize: () => void;

// Parallel batch tracking — tracks tool IDs in the current active batch
let activeBatchToolIds: Set<string> | null = null;
let batchFinalizeTimer: ReturnType<typeof setTimeout> | null = null;
// Definitive parallel tool IDs from the most recent message_end content blocks.
// All tool_use blocks in a single API message are parallel by definition.
let messageParallelToolIds: Set<string> | null = null;
// Per-turn usage from the most recent message_end or cost_update — fed into batch footer pills.
let lastMessageUsage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } } | null = null;
// Whether we've received cost_update events this session. When true, message_end
// token accumulation is skipped to avoid double-counting (cost_update is authoritative).
let hasCostUpdateSource = false;
// Previous cumulative totals from cost_update — used to compute per-turn deltas.
let prevCostTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
// Fallback context window sizes for well-known models when the backend doesn't
// report contextWindow via model selection. Keyed by model ID substring match.
// Order matters — first match wins, so put more specific patterns first.
const KNOWN_CONTEXT_WINDOWS: Array<[pattern: string, tokens: number]> = [
  // Anthropic Claude
  ["opus-4", 200_000],
  ["sonnet-4", 200_000],
  ["haiku-4", 200_000],
  ["claude-3.5", 200_000],
  ["claude-3-opus", 200_000],
  ["claude-3-sonnet", 200_000],
  ["claude-3-haiku", 200_000],
  // OpenAI
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-4.1", 1_000_000],
  ["gpt-4", 8_192],
  ["o1", 200_000],
  ["o3", 200_000],
  ["o4-mini", 200_000],
  // Google Gemini
  ["gemini-2", 1_000_000],
  ["gemini-1.5", 1_000_000],
  // Codex
  ["codex", 200_000],
  // DeepSeek
  ["deepseek", 128_000],
];

function resolveContextWindow(): number {
  // 1. Authoritative: contextWindow set explicitly by session_stats or state_update
  if (state.sessionStats.contextWindow) return state.sessionStats.contextWindow;
  // 2. From the model object (set by model selection / routing)
  if (state.model?.contextWindow) return state.model.contextWindow;
  // 3. Cross-reference the available models list (backend model registry)
  const modelId = state.model?.id || "";
  const provider = state.model?.provider || "";
  if (modelId && state.availableModels.length > 0) {
    const match = state.availableModels.find(
      (m) => m.id === modelId && (!provider || m.provider === provider)
    );
    if (match?.contextWindow) return match.contextWindow;
  }
  // 4. Fallback: match model ID against known windows
  if (modelId) {
    for (const [pattern, tokens] of KNOWN_CONTEXT_WINDOWS) {
      if (modelId.includes(pattern)) return tokens;
    }
  }
  return 0;
}

// Staggered tool-end queue — when multiple tool_execution_end events arrive in
// the same frame (common for fast parallel tools whose events batch in one stdout
// chunk), processing them all synchronously means the browser never repaints
// between updates. The queue spreads completion rendering across animation frames
// so each tool visibly transitions from spinner → checkmark individually.
const toolEndQueue: Array<Record<string, any>> = [];
let toolEndRafId: number | null = null;

/** Process one queued tool_execution_end per animation frame. */
function processToolEndQueue(): void {
  toolEndRafId = null;
  const data = toolEndQueue.shift();
  if (!data) return;

  renderToolEnd(data);

  if (toolEndQueue.length > 0) {
    toolEndRafId = requestAnimationFrame(processToolEndQueue);
  }
}

/** Flush all pending tool-end updates immediately (called on agent_end / turn finalization). */
function flushToolEndQueue(): void {
  if (toolEndRafId) {
    cancelAnimationFrame(toolEndRafId);
    toolEndRafId = null;
  }
  while (toolEndQueue.length > 0) {
    renderToolEnd(toolEndQueue.shift()!);
  }
}

/** Render a single tool_execution_end — updates DOM and parallel batch state. */
function renderToolEnd(data: Record<string, any>): void {
  // Data model was already updated eagerly in the case handler.
  // Just do DOM + batch updates here.
  renderer.updateToolSegmentElement(data.toolCallId);

  // Update parallel batch status
  if (activeBatchToolIds?.has(data.toolCallId)) {
    // Check if ALL tools in the batch (and in the known parallel set from
    // message_end) are done. This prevents premature finalization when fast
    // tools complete before slower tools' execution_start events arrive.
    const fullSet = messageParallelToolIds
      ? new Set([...activeBatchToolIds, ...messageParallelToolIds])
      : activeBatchToolIds;
    const allDone = [...fullSet].every(id => {
      const t = state.currentTurn?.toolCalls.get(id);
      return t && !t.isRunning;
    });
    console.debug(`[gsd:parallel] renderToolEnd: id=${data.toolCallId} batchSize=${activeBatchToolIds?.size} fullSetSize=${fullSet.size} allDone=${allDone}`);
    if (allDone) {
      if (batchFinalizeTimer) clearTimeout(batchFinalizeTimer);
      batchFinalizeTimer = setTimeout(() => {
        console.debug(`[gsd:parallel] batch FINALIZED (timer fired) — ${activeBatchToolIds?.size ?? 0} tools`);
        renderer.finalizeParallelBatch(lastMessageUsage);
        batchFinalizeTimer = null;
        // Clear batch tracking so subsequent sequential tools don't get pulled in
        activeBatchToolIds = null;
      }, 800);
    }
    renderer.updateParallelBatchStatus();
  } else if (renderer.isInSealedBatch(data.toolCallId)) {
    console.debug(`[gsd:parallel] renderToolEnd: id=${data.toolCallId} in sealed batch — ticking`);
  }
  // Tick all sealed batches: update their running/done labels and finalize
  // any whose tools have all finished. A sealed batch is one that was closed
  // to new additions (by narration between tool waves) but still had running
  // members at that moment.
  renderer.tickSealedBatches(lastMessageUsage);

  scrollToBottom(messagesContainer);
}

export interface MessageHandlerDeps {
  vscode: { postMessage(msg: unknown): void };
  messagesContainer: HTMLElement;
  welcomeScreen: HTMLElement;
  promptInput: HTMLTextAreaElement;
  updateAllUI: () => void;
  updateHeaderUI: () => void;
  updateFooterUI: () => void;
  updateInputUI: () => void;
  updateOverlayIndicators: () => void;
  updateWorkflowBadge: (wf: any) => void;
  handleModelRouted: (oldModel: any, newModel: any) => void;
  autoResize: () => void;
}

/** Reset per-session derived tracking state. Called on init, session switch, and process exit. */
function resetDerivedSessionTracking(): void {
  hasCostUpdateSource = false;
  prevCostTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  lastMessageUsage = null;
  if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
  activeBatchToolIds = null;
  messageParallelToolIds = null;
}

export function init(deps: MessageHandlerDeps): void {
  vscode = deps.vscode;
  messagesContainer = deps.messagesContainer;
  welcomeScreen = deps.welcomeScreen;
  promptInput = deps.promptInput;
  updateAllUI = deps.updateAllUI;
  updateHeaderUI = deps.updateHeaderUI;
  updateFooterUI = deps.updateFooterUI;
  updateInputUI = deps.updateInputUI;
  updateOverlayIndicators = deps.updateOverlayIndicators;
  updateWorkflowBadge = deps.updateWorkflowBadge;
  handleModelRouted = deps.handleModelRouted;
  autoResize = deps.autoResize;

  resetDerivedSessionTracking();

  window.addEventListener("message", handleMessage);
}

// ============================================================
// Skill pill tracker
// ============================================================

/** Update the skill pills display in the footer */
function updateSkillPills(): void {
  let container = document.getElementById("skillPills");
  if (!container) {
    // Append to footerStats so pills flow naturally after token counts
    const footerStats = document.getElementById("footerStats");
    if (!footerStats) return;
    container = document.createElement("span");
    container.id = "skillPills";
    container.className = "gsd-skill-pills";
    footerStats.insertAdjacentElement("afterend", container);
  }

  if (state.loadedSkills.size === 0) {
    container.classList.add("gsd-hidden");
    return;
  }

  container.classList.remove("gsd-hidden");
  const pills = Array.from(state.loadedSkills)
    .map((name) => `<span class="gsd-skill-pill" title="Skill loaded: ${escapeHtml(name)}">${escapeHtml(name)}</span>`)
    .join("");
  container.innerHTML = pills;
}

// ============================================================
// Main message handler
// ============================================================

function handleMessage(event: MessageEvent): void {
  const raw = event.data as Record<string, unknown>;
  if (!raw || !raw.type) return;
  const msg = raw as ExtensionToWebviewMessage;

  try {


  switch (msg.type) {
    case "config": {
      const data = msg;
      state.useCtrlEnterToSend = data.useCtrlEnterToSend ?? false;
      if (data.theme) {
        state.theme = data.theme;
        try { applyTheme(data.theme); } catch (e) { console.warn("applyTheme error:", e); }
      }
      if (data.cwd) state.cwd = data.cwd;
      if (data.version) state.version = data.version;
      if (data.extensionVersion) {
        state.extensionVersion = data.extensionVersion;
        const headerVer = document.getElementById("headerVersion");
        if (headerVer) headerVer.textContent = `v${data.extensionVersion}`;
      }
      updateAllUI();
      break;
    }

    case "state": {
      const data = msg.data;
      if (data) {
        state.model = data.model || null;
        // Only update thinkingLevel if the backend actually reports it.
        // CC CLI omits this field — preserve whatever we already have.
        // Use `in` check so explicit null from backend clears the value.
        if ("thinkingLevel" in data) {
          state.thinkingLevel = data.thinkingLevel ?? null;
        }
        state.isStreaming = data.isStreaming || false;
        state.isCompacting = data.isCompacting || false;
        if (data.cwd) state.cwd = data.cwd;
        if (data.autoCompactionEnabled != null) {
          state.sessionStats.autoCompactionEnabled = data.autoCompactionEnabled;
        }
        if (data.model?.contextWindow) {
          state.sessionStats.contextWindow = data.model.contextWindow;
        }
        if (data.sessionId) {
          sessionHistory.setCurrentSessionId(data.sessionId);
        }
        if (state.processStatus !== "crashed") state.processStatus = "running";
        // Eagerly fetch available models if not loaded yet (debounce)
        if (!state.modelsLoaded && !state.modelsRequested) {
          state.modelsRequested = true;
          vscode.postMessage({ type: "get_available_models" });
          // Retry after 5s — providers like Ollama register asynchronously
          // and may not be available in the initial response.
          registerTimeout("models-retry", setTimeout(() => {
            vscode.postMessage({ type: "get_available_models" });
          }, 5000));
        }
        updateAllUI();
      }
      break;
    }

    case "session_stats": {
      const data = msg.data;
      if (data) {
        // Only take autoCompactionEnabled from session_stats.
        // GSD PI's getSessionStats() returns tokens/cost/message counts but NOT
        // contextWindow — that comes from model selection and resolveContextWindow().
        // When cost_update is the authoritative source, it handles tokens and cost;
        // session_stats would overwrite with stale/wrong values.
        if (data.autoCompactionEnabled != null) {
          state.sessionStats.autoCompactionEnabled = data.autoCompactionEnabled;
        }
        // Accept contextWindow if present (future-proofing — GSD PI may add it)
        if (data.contextWindow) {
          state.sessionStats.contextWindow = data.contextWindow;
        }
        updateHeaderUI();
        updateFooterUI();
      }
      break;
    }

    case "process_status": {
      const data = msg;
      const prevStatus = state.processStatus;
      state.processStatus = data.status as ProcessStatus;

      // When the process becomes "running" (fresh start or after crash/restart),
      // reset command cache so the slash menu re-fetches from the new process.
      if (data.status === "running" && prevStatus !== "running") {
        // Reset streaming state — if we're freshly running, we can't be streaming
        state.isStreaming = false;
        state.isCompacting = false;
        state.lastExitDetail = null;
        state.commandsLoaded = false;
        state.commands = [];
        // Eagerly fetch commands so they're ready when the user types /
        vscode.postMessage({ type: "get_commands" });
      }

      updateOverlayIndicators();
      dashboard.updateWelcomeScreen();
      break;
    }

    case "workflow_state": {
      updateWorkflowBadge(msg.state);
      break;
    }

    case "dashboard_data": {
      // If visualizer is open, only feed it — don't render inline dashboard
      if (visualizer.isVisible()) {
        visualizer.updateData(msg.data);
      } else {
        dashboard.renderDashboard(msg.data);
      }
      break;
    }

    case "auto_progress": {
      autoProgress.update(msg.data);
      break;
    }

    case "model_routed": {
      handleModelRouted(msg.oldModel, msg.newModel);
      const oldName = msg.oldModel?.id || "unknown";
      const newName = msg.newModel?.id || "unknown";
      toasts.show(`Model routed: ${oldName} → ${newName}`, 3000);
      break;
    }

    case "whats_new": {
      showWhatsNew(msg.version, msg.notes);
      break;
    }

    case "changelog": {
      showChangelog(msg.entries);
      break;
    }

    case "agent_start": {
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("New turn started");
      }
      state.isStreaming = true;
      const isContinuation = !!(msg as any).isContinuation && state.currentTurn === null;
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
      document.querySelectorAll(".gsd-steer-note").forEach((el) => el.remove());
      break;
    }

    case "agent_end": {
      state.isStreaming = false;
      announceToScreenReader("Response complete.");
      state.processHealth = "responsive";
      // Flush any pending staggered tool-end renders before finalizing the turn
      flushToolEndQueue();
      // Expire any pending UI dialogs — the backend's abort signal fires
      // on agent_end, auto-resolving all pending dialogs to defaults.
      // Mark them so the user sees they're no longer interactive.
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("Agent finished");
      }
      document.querySelectorAll(".gsd-steer-note").forEach((el) => el.remove());
      if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
      if (activeBatchToolIds) { renderer.finalizeParallelBatch(lastMessageUsage); }
      renderer.finalizeAllSealedBatches(lastMessageUsage);
      activeBatchToolIds = null;
      messageParallelToolIds = null;
      renderer.clearActiveBatch();
      renderer.finalizeCurrentTurn();
      updateInputUI();
      updateOverlayIndicators();
      vscode.postMessage({ type: "get_session_stats" });
      break;
    }

    case "turn_start": {
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
      break;
    }

    case "turn_end": {
      break;
    }

    case "message_start": {
      // Clear steer note — new LLM response means the steer was consumed
      // or is queued for the next tool boundary. Either way, "Redirecting
      // agent..." is no longer accurate once new content is flowing.
      document.querySelectorAll(".gsd-steer-note").forEach((el) => el.remove());
      // A new API message is a new thought cycle. Seal any active batch so
      // this message's tools (if any) open a fresh one rather than extending
      // the prior wave. If all prior tools are done, finalize; otherwise seal.
      if (activeBatchToolIds) {
        if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
        const allDone = [...activeBatchToolIds].every(id => {
          const t = state.currentTurn?.toolCalls.get(id);
          return t && !t.isRunning;
        });
        if (allDone) {
          console.debug(`[gsd:parallel] message_start: finalizing batch (${activeBatchToolIds.size} tools) — all done`);
          renderer.finalizeParallelBatch(lastMessageUsage);
        } else {
          console.debug(`[gsd:parallel] message_start: sealing batch (${activeBatchToolIds.size} tools) — some still running`);
          renderer.sealActiveBatch();
        }
        activeBatchToolIds = null;
      }
      // Reset per-message parallel tracking — each message gets its own set
      messageParallelToolIds = null;
      lastMessageUsage = null;
      break;
    }

    case "message_update": {
      if (!state.currentTurn) break;
      const data = msg as any;
      const delta = data.assistantMessageEvent;

      if (delta) {
        if (delta.type === "text_delta" && delta.delta) {
          // Filter out async_subagent_progress JSON that leaks into text deltas.
          // gsd-pi sometimes emits these as assistant text content rather than
          // as a separate stderr line. Strip any line containing the marker.
          let text = delta.delta as string;
          if (text.includes('"__async_subagent_progress"')) {
            text = text
              .split("\n")
              .filter((line: string) => !line.includes('"__async_subagent_progress"'))
              .join("\n")
              .trim();
            if (!text) break;
          }

          // Clear steer note on first text output — the agent is producing
          // content, so the steer has been consumed (or will be at the next
          // tool boundary). This catches cases where message_start fired
          // before the steer was sent, and no new message_start follows.
          const steerNote = messagesContainer.querySelector(".gsd-steer-note");
          if (steerNote) steerNote.remove();
          // Narration between tool waves = new thought cycle. Close the active
          // batch to new additions. If its tools are all done, finalize it now;
          // otherwise seal it so the still-running tools keep their spinner
          // inside that box and the batch auto-finalizes on its own when they
          // end. Any new tool wave starts a fresh batch below this narration.
          if (activeBatchToolIds) {
            if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
            const allDone = [...activeBatchToolIds].every(id => {
              const t = state.currentTurn?.toolCalls.get(id);
              return t && !t.isRunning;
            });
            if (allDone) {
              console.debug(`[gsd:parallel] text_delta: finalizing batch (${activeBatchToolIds.size} tools) — all done`);
              renderer.finalizeParallelBatch(lastMessageUsage);
            } else {
              console.debug(`[gsd:parallel] text_delta: sealing batch (${activeBatchToolIds.size} tools) — some still running`);
              renderer.sealActiveBatch();
            }
            activeBatchToolIds = null;
          }
          renderer.appendToTextSegment("text", text);
        } else if (delta.type === "thinking_delta" && delta.delta) {
          // Thinking is also a thought-cycle boundary — seal/finalize any
          // active batch so new tools after the thinking block open a fresh
          // one. Mirrors text_delta seal logic.
          if (activeBatchToolIds) {
            if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
            const allDone = [...activeBatchToolIds].every(id => {
              const t = state.currentTurn?.toolCalls.get(id);
              return t && !t.isRunning;
            });
            if (allDone) {
              console.debug(`[gsd:parallel] thinking_delta: finalizing batch (${activeBatchToolIds.size} tools) — all done`);
              renderer.finalizeParallelBatch(lastMessageUsage);
            } else {
              console.debug(`[gsd:parallel] thinking_delta: sealing batch (${activeBatchToolIds.size} tools) — some still running`);
              renderer.sealActiveBatch();
            }
            activeBatchToolIds = null;
          }
          // Detect thinking blocks — if we see one, thinking is active.
          // Only auto-set when we genuinely have no level info (null/undefined).
          // Never override an explicit user choice (including "off").
          if (!state.thinkingLevel) {
            state.thinkingLevel = "medium";
            updateHeaderUI();
          }
          renderer.appendToTextSegment("thinking", delta.delta);
        } else if (delta.type === "server_tool_use") {
          // Anthropic server-side tool (e.g. native web search, code execution).
          // These arrive as content blocks, not through tool_execution_start/end.
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
          // Result from Anthropic's server-side web search tool.
          // Find the matching server_tool segment and update it with results.
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
          // Tool call streaming — render a spinner immediately so the user
          // sees the tool appear while the LLM is still generating arguments.
          const partial = delta.partial;
          const content = partial?.content;
          const idx = delta.contentIndex;
          // Try content[idx] first, then delta.toolCall as fallback — some
          // backends provide the tool block directly rather than via content array.
          let block: any = null;
          if (Array.isArray(content) && typeof idx === "number" && idx >= 0 && idx < content.length) {
            block = content[idx];
          }
          if (!block && delta.toolCall) {
            block = delta.toolCall;
          }
          console.debug(`[gsd:parallel] toolcall_start: block=${block?.name || 'null'} id=${block?.id || 'null'} type=${block?.type || 'null'}`);
          if (block) {
            const isToolBlock = block.type === "toolCall" || block.type === "tool_use" || block.type === "tool-use";
            if (isToolBlock && block.id && block.name) {
              const turn = state.currentTurn!;
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
                // Parallelism is determined by actual runtime overlap: which
                // other tools are still running right now? Segment adjacency
                // is misleading — a long-finished neighbour shouldn't keep
                // marking new tools as parallel. Also skip tools that belong
                // to a sealed batch — they're a prior wave's leftovers and
                // shouldn't be pulled into this wave's batch.
                const streamingRunning: ToolCallState[] = [];
                for (const other of turn.toolCalls.values()) {
                  if (other.isRunning && other.id !== block.id && !renderer.isInSealedBatch(other.id)) {
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

                // Parallel batch grouping for streaming path.
                // Only group tools that are genuinely concurrent. If the
                // active batch is stale (all members already done, just
                // waiting on the finalize timer), close it out before
                // opening a new one so sequential waves don't merge.
                if (isStreamParallel) {
                  if (activeBatchToolIds) {
                    const hasRunningMember = [...activeBatchToolIds].some(id => {
                      const t = turn.toolCalls.get(id);
                      return t?.isRunning;
                    });
                    if (!hasRunningMember) {
                      if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
                      console.debug(`[gsd:parallel] toolcall_start: stale batch (${activeBatchToolIds.size} done) — finalizing before new wave`);
                      renderer.finalizeParallelBatch(lastMessageUsage);
                      activeBatchToolIds = null;
                    } else {
                      if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
                    }
                  }
                  if (!activeBatchToolIds) {
                    const batchIds: string[] = [tc.id];
                    for (const rt of streamingRunning) batchIds.push(rt.id);
                    activeBatchToolIds = new Set(batchIds);
                  } else {
                    activeBatchToolIds.add(tc.id);
                  }
                  renderer.syncBatchState(activeBatchToolIds);
                }

                scrollToBottom(messagesContainer);
              }
            }
          }
        } else if (delta.type === "toolcall_end") {
          // Tool call complete — may carry externalResult with the tool's output.
          // Render the result immediately so users see it while the model continues.
          const tc2 = delta.toolCall;
          if (tc2?.id && tc2.externalResult && state.currentTurn) {
            const existing = state.currentTurn.toolCalls.get(tc2.id);
            if (existing) {
              // Update args from the final toolCall payload
              if (tc2.arguments && typeof tc2.arguments === "object") {
                existing.args = tc2.arguments;
              }
              // Extract result text
              const resultContent = tc2.externalResult.content;
              if (Array.isArray(resultContent)) {
                const text = resultContent
                  .map((c: any) => c.text || "")
                  .filter(Boolean)
                  .join("\n");
                const filtered = text
                  ? text.split("\n").filter((l: string) => !l.includes('"__async_subagent_progress"')).join("\n").trim()
                  : text;
                if (filtered) existing.resultText = filtered;
              }
              if (tc2.externalResult.details) existing.details = tc2.externalResult.details;
              if (tc2.externalResult.isError) existing.isError = true;
              // Mark as complete — the tool_execution_end event is redundant after this
              existing.isRunning = false;
              existing.endTime = Date.now();
              renderer.updateToolSegmentElement(tc2.id);

              // Update parallel batch status — don't finalize during streaming
              // because more toolcall_start events may still arrive in this message.
              // Finalization is deferred to tool_execution_end or agent_end.
              if (activeBatchToolIds?.has(tc2.id)) {
                renderer.updateParallelBatchStatus();
              }

              scrollToBottom(messagesContainer);
            }
          } else if (tc2?.id && tc2.arguments && typeof tc2.arguments === "object" && state.currentTurn) {
            // toolcall_end without externalResult — just update args
            const existing = state.currentTurn.toolCalls.get(tc2.id);
            if (existing) {
              existing.args = tc2.arguments;
              renderer.updateToolSegmentElement(tc2.id);
            }
          }
        } else if (delta.type === "toolcall_delta"
                    || delta.type === "thinking_start" || delta.type === "thinking_end"
                    || delta.type === "text_start" || delta.type === "text_end") {
          // Known streaming delta types we don't need to act on — suppress log noise
        }
      }
      break;
    }

    // Async subagent live progress — update spawn cards in previous turns
    case "async_subagent_progress": {
      const data = msg;
      if (data.type !== "async_subagent_progress" || !data.toolCallId) break;

      // Find the tool block in the DOM
      const allToolBlocks = document.querySelectorAll<HTMLElement>(`[data-tool-id]`);
      let toolBlock: HTMLElement | null = null;
      allToolBlocks.forEach(el => {
        if (el.dataset.toolId === data.toolCallId) toolBlock = el;
      });

      // Update state
      let tc: ToolCallState | undefined;
      // Check current turn first (early progress before turn is finalized)
      tc = state.currentTurn?.toolCalls.get(data.toolCallId);
      if (!tc) {
        for (let i = state.entries.length - 1; i >= 0; i--) {
          tc = state.entries[i].turn?.toolCalls.get(data.toolCallId);
          if (tc) break;
        }
      }

      if (tc) {
        tc.details = { ...(tc.details || {}), mode: data.mode, results: data.results };
        const done = data.results?.filter((r: any) => r.exitCode === 0).length || 0;
        const running = data.results?.filter((r: any) => r.exitCode === -1).length || 0;
        const failed = data.results?.filter((r: any) => r.exitCode > 0).length || 0;
        const total = data.results?.length || 0;
        tc.resultText = `${done}/${total} done, ${running} running${failed ? `, ${failed} failed` : ""}`;
        tc.isRunning = running > 0;
        tc.isError = failed > 0;
      }

      // Re-render
      if (toolBlock && tc) {
        renderer.patchToolBlock(toolBlock, tc);
      }
      break;
    }

    case "message_end": {
      const endData = msg;
      const endMsg = endData.message;
      // Extract definitive parallel tool IDs from message content blocks.
      // All tool_use blocks in a single API message are parallel by definition.
      // Include `serverToolUse` (and SDK-native `server_tool_use`) blocks —
      // these represent server-executed tools such as the Agent/Task subagent
      // dispatch or web_search. They co-occur with regular tool_use blocks in
      // the same message and MUST participate in the parallel-batch set,
      // otherwise the visible tool count undercounts reality.
      if (endMsg?.content && state.currentTurn) {
        const blocks = Array.isArray(endMsg.content) ? endMsg.content : [];
        console.debug(`[gsd:parallel] message_end: ${blocks.length} content blocks, types=[${blocks.map((b: any) => b.type).join(",")}]`);
        const toolBlockTypes = new Set([
          "tool_use",
          "toolCall",
          "tool-use",
          "serverToolUse",
          "server_tool_use",
        ]);
        const toolIds = blocks
          .filter((b: any) => toolBlockTypes.has(b.type))
          .map((b: any) => b.id)
          .filter(Boolean) as string[];
        console.debug(`[gsd:parallel] message_end: ${toolIds.length} tool IDs found`);

        // Server-side tool blocks (Agent/Task, web_search, etc.) complete on
        // the provider side and never emit tool_execution_start/end locally.
        // Synthesize a tool segment here so the UI shows them as part of the
        // batch, otherwise a 5-Bash + 5-Agent wave renders as "5 tools" not 10.
        for (const block of blocks) {
          const bType = (block as any).type;
          if (bType !== "serverToolUse" && bType !== "server_tool_use") continue;
          const bId = (block as any).id as string | undefined;
          if (!bId || state.currentTurn.toolCalls.has(bId)) continue;
          const input = (block as any).input ?? (block as any).arguments ?? {};
          const tc: ToolCallState = {
            id: bId,
            name: String((block as any).name ?? "server_tool"),
            args: typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {},
            resultText: "",
            isError: false,
            isRunning: false,
            startTime: Date.now(),
            endTime: Date.now(),
            isParallel: toolIds.length >= 2,
          };
          state.currentTurn.toolCalls.set(bId, tc);
          const segIdx = state.currentTurn.segments.length;
          state.currentTurn.segments.push({ type: "tool", toolCallId: bId });
          renderer.appendToolSegmentElement(tc, segIdx);
        }
        // Filter out tools that already belong to a sealed batch (prior wave).
        // A single API message may contain multiple waves separated by text/thinking
        // blocks — those thought-cycle boundaries sealed the earlier waves, so we
        // must not pull their tools back into the current wave's batch.
        const postSealedToolIds = toolIds.filter(id => !renderer.isInSealedBatch(id));
        if (postSealedToolIds.length < toolIds.length) {
          console.debug(`[gsd:parallel] message_end: ${toolIds.length - postSealedToolIds.length} tools already in sealed batches — excluding from current wave`);
        }
        if (postSealedToolIds.length >= 2) {
          messageParallelToolIds = new Set(postSealedToolIds);
          // Mark tools in the current (post-narration) wave as parallel
          for (const toolId of postSealedToolIds) {
            const tc = state.currentTurn.toolCalls.get(toolId);
            if (tc && !tc.isParallel) {
              tc.isParallel = true;
              renderer.updateToolSegmentElement(toolId);
            }
          }
          // If the existing batch is stale (no running members and disjoint
          // from the new wave) finalize it before starting the new batch,
          // so sequential waves don't get merged.
          if (activeBatchToolIds) {
            const newIdSet = new Set(postSealedToolIds);
            const overlaps = [...activeBatchToolIds].some(id => newIdSet.has(id));
            const hasRunningMember = [...activeBatchToolIds].some(id => {
              const t = state.currentTurn!.toolCalls.get(id);
              return t?.isRunning;
            });
            if (!overlaps && !hasRunningMember) {
              if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
              console.debug(`[gsd:parallel] message_end: stale batch (${activeBatchToolIds.size} done, disjoint) — finalizing before new wave`);
              renderer.finalizeParallelBatch(lastMessageUsage);
              activeBatchToolIds = null;
            }
          }
          if (!activeBatchToolIds) {
            activeBatchToolIds = new Set(postSealedToolIds);
          } else {
            // Batch exists from streaming — add any missing post-seal tools
            for (const toolId of postSealedToolIds) {
              activeBatchToolIds.add(toolId);
            }
          }
          if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
          renderer.syncBatchState(activeBatchToolIds);
        } else {
          messageParallelToolIds = null;
        }
      }
      if (endMsg?.role === "assistant") {
        // Surface agent errors that arrive via stopReason:"error" on the message.
        // These are NOT delivered through message_update deltas, so the streaming
        // renderer never sees them. Without this, API errors, credential failures,
        // and other non-retryable errors are silently swallowed.
        const stopReason = (endMsg as any).stopReason as string | undefined;
        const errorMessage = (endMsg as any).errorMessage as string | undefined;
        if (stopReason === "error" && errorMessage) {
          addSystemEntry(errorMessage, "error");
        }

        if ((endMsg as any).usage) {
          const u = (endMsg as any).usage as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
          lastMessageUsage = u;

          // pi's claude-code-cli adapter exposes a `perCallUsage` field on the
          // assistant message carrying the *last* API call's usage snapshot
          // (input, output, cacheRead, cacheWrite, totalTokens). That is the
          // authoritative signal for context window pressure — `usage` is a
          // session-wide running aggregate and is NOT per-call.
          // See: gsd-pi partial-builder.js ZERO_USAGE + captureMessageStartUsage.
          const perCall = (endMsg as any).perCallUsage as
            | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number }
            | undefined;

          if (!hasCostUpdateSource) {
            // cost_update is the authoritative session-total source in v2.
            // When absent (older providers), mirror pi's session-stat behaviour:
            // `usage` here is already cumulative across the session for
            // assistant messages, so assign directly rather than accumulating.
            const curIn = u.input || 0;
            const curOut = u.output || 0;
            const curCR = u.cacheRead || 0;
            const curCW = u.cacheWrite || 0;
            if (!state.sessionStats.tokens) {
              state.sessionStats.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
            }
            const t = state.sessionStats.tokens;
            // Monotonic max guard — pi's session stats are non-decreasing, so
            // any apparent regression is a provider/stream reset, not a real
            // drop. Taking max prevents the header from visibly dipping.
            t.input = Math.max(t.input, curIn);
            t.output = Math.max(t.output, curOut);
            t.cacheRead = Math.max(t.cacheRead, curCR);
            t.cacheWrite = Math.max(t.cacheWrite, curCW);
            t.total = t.input + t.output + t.cacheRead + t.cacheWrite;
            if (u.cost?.total) {
              state.sessionStats.cost = Math.max(state.sessionStats.cost || 0, u.cost.total);
            }
          }

          // Context %: use perCallUsage.totalTokens when provided by pi
          // (preferred — exact match of pi's own calculateContextTokens()).
          // Fall back to perCall input+output+cacheRead+cacheWrite. Never
          // delta-compute from `usage` — it's a session-cumulative aggregate,
          // not a turn-local snapshot, so deltas across message_end events
          // yield nonsense context sizes.
          {
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
              const pIn = perCall.input || 0;
              const pOut = perCall.output || 0;
              const pCR = perCall.cacheRead || 0;
              const pCW = perCall.cacheWrite || 0;
              contextTokens = pIn + pOut + pCR + pCW;
              if (contextTokens > 0) source = "perCall.sum";
            }
            console.debug(`[gsd:context] ctx=${contextTokens}/${contextWindow} src=${source} perCall=${perCall ? JSON.stringify(perCall) : "n/a"} usage=${JSON.stringify({ input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite })}`);
            if (contextWindow > 0 && contextTokens > 0) {
              state.sessionStats.contextTokens = contextTokens;
              state.sessionStats.contextPercent = (contextTokens / contextWindow) * 100;
            }
          }
          updateHeaderUI();
          updateFooterUI();
        }
      }
      break;
    }

    case "tool_execution_start": {
      if (!state.currentTurn) break;
      const data = msg;
      console.debug(`[gsd:parallel] tool_exec_start: ${data.toolName} id=${data.toolCallId} existingTc=${!!state.currentTurn.toolCalls.get(data.toolCallId)} batchActive=${!!activeBatchToolIds} batchSize=${activeBatchToolIds?.size ?? 0} msgParallel=${messageParallelToolIds?.size ?? 0}`);

      // Detect skill loads: read calls targeting */skills/*/SKILL.md
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

      // Determine if this tool is part of a known parallel set from message_end
      const isKnownParallel = messageParallelToolIds?.has(data.toolCallId) ?? false;

      // If streaming already created this tool segment, update args and ensure
      // it's in the active batch. Streaming may have created the tool but the
      // batch might have finalized before this execution event arrived.
      const existingTc = state.currentTurn.toolCalls.get(data.toolCallId);
      if (existingTc) {
        existingTc.args = data.args || existingTc.args;
        existingTc.isRunning = true;
        if (isKnownParallel) existingTc.isParallel = true;
        // Parallelism is determined by what's actually running, not by segment
        // adjacency. A tool is parallel only if another tool is currently
        // running right now.
        if (!existingTc.isParallel) {
          for (const [, other] of state.currentTurn.toolCalls) {
            if (other.isRunning && other.id !== existingTc.id && !renderer.isInSealedBatch(other.id)) {
              existingTc.isParallel = true;
              break;
            }
          }
        }
        renderer.updateToolSegmentElement(existingTc.id);

        // Ensure tool joins the active batch if genuinely parallel.
        // If an existing batch has no running members it's stale (only alive
        // because of the finalize timer) — finalize it before starting a new
        // wave.
        if (isKnownParallel || existingTc.isParallel) {
          let batch = activeBatchToolIds;
          if (batch && !batch.has(existingTc.id)) {
            const hasRunningMember = [...batch].some(id => {
              const t = state.currentTurn!.toolCalls.get(id);
              return t?.isRunning && id !== existingTc.id;
            });
            if (!hasRunningMember) {
              if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
              renderer.finalizeParallelBatch(lastMessageUsage);
              activeBatchToolIds = null;
              batch = null;
            }
          }
          if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
          if (!batch) {
            batch = messageParallelToolIds ? new Set(messageParallelToolIds) : new Set<string>();
            activeBatchToolIds = batch;
          }
          batch.add(existingTc.id);
          renderer.syncBatchState(batch);
        }

        break;
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

      // Parallel batch grouping — create or expand the visual batch container.
      // Stale batches (only alive because of the finalize timer) are finalized
      // before a new wave so sequential waves within one turn render as
      // separate batches.
      if (fallbackIsParallel) {
        let batch = activeBatchToolIds;
        if (batch && !batch.has(tc.id)) {
          const hasRunningMember = [...batch].some(id => {
            const t = state.currentTurn!.toolCalls.get(id);
            return t?.isRunning && id !== tc.id;
          });
          if (!hasRunningMember) {
            if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
            renderer.finalizeParallelBatch(lastMessageUsage);
            activeBatchToolIds = null;
            batch = null;
          }
        }
        if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
        if (!batch) {
          if (messageParallelToolIds) {
            batch = new Set(messageParallelToolIds);
            batch.add(tc.id);
          } else {
            batch = new Set([...runningTools.map(t => t.id), tc.id]);
          }
          activeBatchToolIds = batch;
        } else {
          batch.add(tc.id);
        }
        renderer.syncBatchState(batch);
      }

      scrollToBottom(messagesContainer);
      break;
    }

    case "tool_execution_update": {
      const data = msg;
      // Look up tool call in current turn first, then fall back to previous entries
      let tc = state.currentTurn?.toolCalls.get(data.toolCallId);
      if (!tc) {
        // Search previous turns — async_subagent updates arrive after the turn ends
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
          ?.map((c: any) => c.text || "")
          .filter(Boolean)
          .join("\n");
        // Strip async_subagent_progress JSON that may leak into tool results
        const filtered = text
          ? text.split("\n").filter((l: string) => !l.includes('"__async_subagent_progress"')).join("\n").trim()
          : text;
        if (filtered) tc.resultText = filtered;
        if (data.partialResult.details) tc.details = data.partialResult.details;
        renderer.updateToolSegmentElement(data.toolCallId);
        scrollToBottom(messagesContainer);
      }
      break;
    }

    case "tool_execution_end": {
      if (!state.currentTurn) break;
      console.debug(`[gsd:parallel] tool_exec_end: id=${msg.toolCallId} isError=${msg.isError} inBatch=${activeBatchToolIds?.has(msg.toolCallId) ?? false}`);
      // Queue the event and process one per animation frame. When multiple
      // tool_execution_end events arrive in the same IPC batch (common for fast
      // parallel tools), this gives the browser a repaint between each update
      // so the user sees spinners change to checkmarks individually.
      toolEndQueue.push(msg);
      // Update data model immediately so isRunning reflects reality for
      // any logic that checks state between frames (e.g. new tool_execution_start).
      const earlyTc = state.currentTurn.toolCalls.get(msg.toolCallId);
      if (earlyTc) {
        earlyTc.isRunning = false;
        earlyTc.isError = msg.isError;
        earlyTc.endTime = Date.now();
        if (msg.durationMs) earlyTc.endTime = earlyTc.startTime + msg.durationMs;
        if (msg.result) {
          const text = msg.result.content
            ?.map((c: any) => c.text || "")
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
      break;
    }

    case "auto_compaction_start": {
      state.isCompacting = true;
      updateOverlayIndicators();
      updateInputUI();
      break;
    }

    case "auto_compaction_end": {
      state.isCompacting = false;
      updateOverlayIndicators();
      updateInputUI();
      if (!msg.aborted) {
        toasts.show("Context compacted successfully");
      }
      break;
    }

    case "auto_retry_start": {
      const data = msg;
      state.isRetrying = true;
      state.retryInfo = {
        attempt: data.attempt,
        maxAttempts: data.maxAttempts,
        errorMessage: data.errorMessage || "",
      };
      updateOverlayIndicators();
      break;
    }

    case "auto_retry_end": {
      const data = msg;
      state.isRetrying = false;
      state.retryInfo = undefined;
      updateOverlayIndicators();
      if (!data.success && data.finalError) {
        addSystemEntry(data.finalError, "error");
      }
      break;
    }

    case "fallback_provider_switch": {
      const data = msg as any;
      const from = data.from || "unknown";
      const to = data.to || "unknown";
      const reason = data.reason || "rate limit";
      toasts.show(`⚠ Model switched: ${from} → ${to} (${reason})`, 5000);
      // Update model display if we can parse provider/id from the "to" field
      const parts = to.split("/");
      if (parts.length >= 2) {
        state.model = {
          id: parts.slice(1).join("/"),
          name: parts.slice(1).join("/"),
          provider: parts[0],
          contextWindow: state.model?.contextWindow,
        };
        updateHeaderUI();
      }
      addSystemEntry(`Provider fallback: ${from} → ${to} (${reason})`, "warning");
      break;
    }

    case "fallback_provider_restored": {
      const data = msg as any;
      const model = data.model;
      if (model) {
        toasts.show(`✓ Original provider restored: ${model.provider}/${model.id}`, 4000);
        state.model = {
          id: model.id,
          name: model.name || model.id,
          provider: model.provider,
          contextWindow: model.contextWindow,
        };
        updateHeaderUI();
      } else {
        toasts.show("✓ Original provider restored", 4000);
      }
      break;
    }

    case "fallback_chain_exhausted": {
      const data = msg as any;
      const lastError = data.lastError || "All providers failed";
      addSystemEntry(`All fallback providers exhausted: ${lastError}. Check your API keys or try again later.`, "error");
      toasts.show("⚠ All model providers failed", 5000);
      break;
    }

    case "session_shutdown": {
      state.isStreaming = false;
      state.isCompacting = false;
      state.processStatus = "stopped";
      // Clean up any in-progress turn
      flushToolEndQueue();
      if (batchFinalizeTimer) { clearTimeout(batchFinalizeTimer); batchFinalizeTimer = null; }
      if (activeBatchToolIds) { renderer.finalizeParallelBatch(lastMessageUsage); }
      renderer.finalizeAllSealedBatches(lastMessageUsage);
      activeBatchToolIds = null;
      messageParallelToolIds = null;
      renderer.clearActiveBatch();
      if (state.currentTurn) {
        renderer.finalizeCurrentTurn();
      }
      addSystemEntry("Session ended", "info");
      updateInputUI();
      updateOverlayIndicators();
      break;
    }

    case "extension_error": {
      const data = msg;
      const extError = (data as any).error as string || "unknown error";
      addSystemEntry(`Command error: ${extError}`, "error");
      break;
    }

    case "steer_persisted": {
      // Update the steer note to reflect durability, then auto-remove after 4s.
      // During auto-mode, no agent_start/agent_end fires between tasks, so
      // the note has no natural removal signal. The timeout ensures it clears.
      const note = document.querySelector(".gsd-steer-note");
      if (note) {
        note.textContent = "⚡ Override saved — applies to current and future tasks";
        setTimeout(() => note.remove(), 4000);
      }
      break;
    }

    case "extension_ui_request": {
      const data = msg;
      if (data.method === "notify" && data.message) {
        const notifyType = (data as any).notifyType as string || "info";
        const kind = notifyType === "error" ? "error" : notifyType === "warning" ? "warning" : "info";
        addSystemEntry(data.message as string, kind);
      } else if (data.method === "setStatus" && data.statusText) {
        // Status text — could update footer
      } else if (data.method === "setWidget") {
        renderWidget(
          (data as any).widgetKey as string,
          (data as any).widgetLines as string[] | undefined,
          (data as any).widgetPlacement as string | undefined,
        );
      } else if (data.method === "set_editor_text" && data.text) {
        promptInput.value = data.text;
        autoResize();
      } else if (data.method === "select" || data.method === "confirm" || data.method === "input") {
        uiDialogs.handleRequest(data);
      }
      break;
    }

    case "commands": {
      const data = msg;
      state.commands = data.commands || [];
      state.commandsLoaded = true;
      if (slashMenu.isVisible()) {
        const filter = promptInput.value.slice(1).trim();
        slashMenu.show(filter);
      }
      break;
    }

    case "available_models": {
      const data = msg;
      state.availableModels = (data.models || []).map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider,
        reasoning: m.reasoning || false,
        contextWindow: m.contextWindow,
      }));
      state.modelsLoaded = true;
      state.modelsRequested = false;
      // Backfill contextWindow on the current model if it was missing.
      // Models load asynchronously — the model may have been set before
      // available_models arrived, leaving contextWindow undefined.
      if (state.model && !state.model.contextWindow) {
        const match = state.availableModels.find(
          (m) => m.id === state.model!.id && m.provider === state.model!.provider
        );
        if (match?.contextWindow) {
          state.model.contextWindow = match.contextWindow;
          updateHeaderUI();
          updateFooterUI();
        }
      }
      if (modelPicker.isVisible()) {
        modelPicker.render();
      }
      break;
    }

    case "thinking_level_changed": {
      const data = msg;
      state.thinkingLevel = data.level || "off";
      updateHeaderUI();
      updateFooterUI();
      thinkingPicker.refresh();
      toasts.show(`Thinking: ${state.thinkingLevel}`);
      break;
    }

    case "bash_result": {
      const data = msg;
      const result = data.result;
      if (result) {
        const output = result.stdout || result.stderr || result.output || JSON.stringify(result);
        const isError = result.exitCode !== 0 || result.error;
        addSystemEntry(typeof output === "string" ? output : JSON.stringify(output, null, 2), isError ? "error" : "info");
      }
      break;
    }

    case "error": {
      const data = msg;
      // Clear steer note — if the steer RPC failed, the "Redirecting agent..."
      // indicator would otherwise stay forever since no agent_start will follow.
      document.querySelectorAll(".gsd-steer-note").forEach((el) => el.remove());
      addSystemEntry(data.message, "error");
      break;
    }

    case "process_exit": {
      const data = msg;
      state.isStreaming = false;
      state.isCompacting = false;
      state.isRetrying = false;
      state.processHealth = "responsive";
      state.currentTurn = null;
      // Clear steer note — process is gone, the steer won't be delivered
      document.querySelectorAll(".gsd-steer-note").forEach((el) => el.remove());
      // Clear auto-progress — process is gone
      autoProgress.update(null);
      // Expire any pending dialogs — the process is gone
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("Process exited");
      }
      // Reset command cache — the process that provided them is dead
      state.commandsLoaded = false;
      state.commands = [];
      renderer.resetStreamingState();
      resetDerivedSessionTracking();
      updateInputUI();
      updateOverlayIndicators();

      // Build an informative error message including stderr detail
      const detail = (data as any).detail as string | undefined;
      state.lastExitDetail = detail || null;
      state.lastExitCode = typeof data.code === "number" ? data.code : null;
      let message: string;
      if (detail) {
        message = detail;
      } else if (data.code === 0) {
        message = "GSD process exited.";
      } else {
        message = `GSD process exited (code: ${data.code}).`;
      }
      addSystemEntry(message, data.code === 0 ? "info" : "error");
      break;
    }

    case "process_health": {
      const data = msg;
      state.processHealth = data.status;
      if (data.status === "unresponsive") {
        updateOverlayIndicators();
      } else if (data.status === "recovered") {
        updateOverlayIndicators();
        addSystemEntry("GSD process recovered", "info");
      }
      break;
    }

    case "session_list": {
      const data = msg;
      sessionHistory.updateSessions(data.sessions || []);
      break;
    }

    case "session_list_error": {
      const data = msg;
      sessionHistory.showError(data.message);
      break;
    }

    case "file_access_result": {
      const data = msg;
      const denied = data.results.filter((r: { path: string; readable: boolean }) => !r.readable);
      if (denied.length > 0) {
        const names = denied.map((r: { path: string }) => {
          const parts = r.path.replace(/\\/g, "/").split("/");
          return parts[parts.length - 1] || r.path;
        });
        toasts.show(`⚠ No read access: ${names.join(", ")}`, 4000);
      }
      break;
    }

    case "temp_file_saved": {
      const data = msg;
      fileHandling.addFileAttachments([data.path], true);
      break;
    }

    case "files_attached": {
      const data = msg;
      if (data.paths.length > 0) {
        fileHandling.addFileAttachments(data.paths, true);
      }
      break;
    }

    case "update_available": {
      const data = msg;
      showUpdateCard(data.version, data.currentVersion, data.releaseNotes, data.downloadUrl);
      break;
    }

    case "session_switched": {
      const data = msg;

      // Clear current state
      state.entries = [];
      state.currentTurn = null;
      renderer.resetStreamingState();
      renderer.clearMessages();
      state.sessionStats = {};
      state.loadedSkills.clear();
      updateSkillPills();
      resetPrunedCount();

      resetDerivedSessionTracking();

      // Apply the new state
      if (data.state) {
        state.model = data.state.model || null;
        if ("thinkingLevel" in data.state) {
          state.thinkingLevel = data.state.thinkingLevel ?? null;
        }
        state.isStreaming = data.state.isStreaming || false;
        state.isCompacting = data.state.isCompacting || false;
        if (state.processStatus !== "crashed") state.processStatus = "running";
      }

      // Render historical messages
      if (data.messages && data.messages.length > 0) {
        renderHistoricalMessages(data.messages);
      }

      // Update session ID for the history panel
      if (data.state?.sessionId) {
        sessionHistory.setCurrentSessionId(data.state.sessionId as string);
      }

      // Hide history panel
      sessionHistory.hide();

      // Update all UI
      updateAllUI();
      scrollToBottom(messagesContainer, true);
      break;
    }

    // terminal_output: silently ignored — embedded terminal not used in this extension
    case "terminal_output":
      break;

    case "cost_update": {
      // v2 protocol: cumulative cost/token update from GSD PI.
      // GSD PI payload: { type, runId, turnCost, cumulativeCost, tokens: { input, output, cacheRead, cacheWrite } }
      hasCostUpdateSource = true;
      const cu = (msg as any).data || (msg as any);

      // GSD PI nests token counts under `tokens`, but some providers may use flat fields.
      const tok = cu.tokens || {};
      const totalInput = tok.input || cu.totalInput || 0;
      const totalOutput = tok.output || cu.totalOutput || 0;
      const totalCacheRead = tok.cacheRead || cu.totalCacheRead || 0;
      const totalCacheWrite = tok.cacheWrite || cu.totalCacheWrite || 0;

      // GSD PI sends `cumulativeCost`, some providers may send `totalCost`
      const costValue = cu.cumulativeCost ?? cu.totalCost;

      // Compute per-turn deltas from cumulative totals
      const turnInput = totalInput - prevCostTotals.input;
      const turnOutput = totalOutput - prevCostTotals.output;
      const turnCacheRead = totalCacheRead - prevCostTotals.cacheRead;
      const turnCacheWrite = totalCacheWrite - prevCostTotals.cacheWrite;
      const turnCost = typeof costValue === "number" ? costValue - prevCostTotals.cost : undefined;
      prevCostTotals = {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite,
        cost: typeof costValue === "number" ? costValue : prevCostTotals.cost,
      };

      // Session totals — use cumulative directly (not accumulated deltas)
      state.sessionStats.tokens = {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite,
        total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
      };

      // Feed per-turn usage into parallel batch footer pills
      lastMessageUsage = {
        input: turnInput,
        output: turnOutput,
        cacheRead: turnCacheRead,
        cacheWrite: turnCacheWrite,
        cost: typeof turnCost === "number" ? { total: turnCost } : undefined,
      };

      // Context % is NOT computed here. cost_update fires once per turn, so
      // its token deltas aggregate multiple API calls — inflating context%
      // quadratically on high-context models. message_end (per API call) is
      // the correct source for context window usage.

      if (typeof costValue === "number") {
        state.sessionStats.cost = costValue;
      }
      updateHeaderUI();
      updateFooterUI();
      break;
    }

    // execution_complete: workflow lifecycle — already handled by extension host
    case "execution_complete":
      break;
    // extensions_ready: extension lifecycle — already handled by extension host
    case "extensions_ready":
      break;

    default:
      console.warn("[gsd-webview] Unrecognized message type:", (msg as any).type);
      break;
  }

  } catch (err: any) {
    // Global error boundary — surface crashes visibly instead of silent failure
    const errorId = `GSD-ERR-${Date.now().toString(36).toUpperCase()}`;
    console.error(`[${errorId}] Message handler error for "${msg.type}":`, err);
    addSystemEntry(
      `Internal error processing "${msg.type}" (${errorId}): ${err?.message || err}. Check browser console for details.`,
      "error"
    );
  }
}

// ============================================================
// Helper functions
// ============================================================

/**
 * Render historical messages from a switched session.
 * Converts the raw AgentMessage array into ChatEntry objects and renders them.
 *
 * Strategy: First pass collects tool results keyed by toolCallId. Second pass
 * builds entries, attaching tool results to their assistant turn's tool calls.
 */
function renderHistoricalMessages(messages: import("../shared/types").AgentMessage[]): void {
  // Historical messages strip tool result content to keep payload light.
  // The assistant's own text between tool calls already summarizes outcomes.
  // Tool calls are shown as names only (no args, no output).

  // Second pass: render user and assistant messages
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = extractMessageText(msg.content);
      if (!text) continue;
      const entry: ChatEntry = {
        id: nextId(),
        type: "user",
        text,
        timestamp: msg.timestamp || Date.now(),
      };
      state.entries.push(entry);
      pruneOldEntries(messagesContainer);
      renderer.renderNewEntry(entry);
    } else if (msg.role === "assistant") {
      const segments: TurnSegment[] = [];
      const turnToolCalls = new Map<string, ToolCallState>();

      // Parse content blocks into segments — tool calls keep name only, no result content
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as Array<Record<string, unknown>>) {
          if (block.type === "thinking" && block.thinking) {
            segments.push({ type: "thinking", chunks: [block.thinking as string] });
          } else if (block.type === "text" && block.text) {
            const lastSeg = segments.length > 0 ? segments[segments.length - 1] : null;
            if (lastSeg && lastSeg.type === "text") {
              lastSeg.chunks.push(block.text as string);
            } else {
              segments.push({ type: "text", chunks: [block.text as string] });
            }
          } else if ((block.type === "tool_use" || block.type === "toolCall") && block.name) {
            const toolId = (block.id as string) || nextId();
            const tc: ToolCallState = {
              id: toolId,
              name: block.name as string,
              args: {},
              resultText: "",
              isError: false,
              isRunning: false,
              startTime: msg.timestamp || Date.now(),
              endTime: msg.timestamp || Date.now(),
            };
            turnToolCalls.set(toolId, tc);
            segments.push({ type: "tool", toolCallId: toolId });
          }
        }
      } else if (typeof msg.content === "string" && msg.content) {
        segments.push({ type: "text", chunks: [msg.content] });
      }

      if (segments.length === 0) continue;

      const turn = {
        id: nextId(),
        segments,
        toolCalls: turnToolCalls,
        isComplete: true,
        timestamp: msg.timestamp || Date.now(),
      };
      const entry: ChatEntry = {
        id: nextId(),
        type: "assistant",
        turn,
        timestamp: msg.timestamp || Date.now(),
      };
      state.entries.push(entry);
      pruneOldEntries(messagesContainer);
      renderer.renderNewEntry(entry);
    }
    // Skip toolResult and bashExecution — not needed for history replay
  }

  // Show messages area, hide welcome
  if (state.entries.length > 0) {
    welcomeScreen.classList.add("gsd-hidden");
  }
}

/**
 * Extract text from a message content field (string or content array).
 */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: Record<string, unknown>) => block.type === "text")
      .map((block: Record<string, unknown>) => block.text as string)
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// ============================================================
// Theme
// ============================================================

function applyTheme(theme: string): void {
  const app = document.querySelector(".gsd-app");
  if (app) {
    app.setAttribute("data-theme", theme);
  }
  // Update active state in settings dropdown
  const dropdown = document.getElementById("settingsDropdown");
  if (dropdown) {
    dropdown.querySelectorAll(".gsd-settings-option").forEach(el => {
      const isActive = (el as HTMLElement).dataset.theme === theme;
      el.classList.toggle("active", isActive);
      el.setAttribute("aria-checked", String(isActive));
    });
  }
}

/**
 * Show an inline update card in the chat with release notes and action buttons.
 */
function showUpdateCard(
  version: string,
  currentVersion: string,
  releaseNotes: string,
  downloadUrl: string
): void {
  // Remove any existing update card
  const existing = document.getElementById("gsd-update-card");
  if (existing) existing.remove();

  const card = document.createElement("div");
  card.id = "gsd-update-card";
  card.className = "gsd-update-card";
  card.innerHTML = `
    <div class="gsd-update-card-header">
      <span class="gsd-update-icon">🚀</span>
      <span class="gsd-update-title">Rokket GSD v${escapeHtml(version)} Available</span>
      <span class="gsd-update-current">You have v${escapeHtml(currentVersion)}</span>
    </div>
    <div class="gsd-update-notes">
      ${formatMarkdownNotes(releaseNotes)}
    </div>
    <div class="gsd-update-actions">
      <button class="gsd-update-btn primary" data-action="install">Update Now</button>
      <button class="gsd-update-btn dismiss" data-action="dismiss">Dismiss</button>
    </div>
  `;

  // Wire up button handlers
  card.querySelector('[data-action="install"]')?.addEventListener("click", () => {
    vscode.postMessage({ type: "update_install", downloadUrl } as WebviewToExtensionMessage);
    card.remove();
  });

  card.querySelector('[data-action="dismiss"]')?.addEventListener("click", () => {
    vscode.postMessage({ type: "update_dismiss", version } as WebviewToExtensionMessage);
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), 300);
  });

  // Insert at the top of the messages area, after any welcome screen
  messagesContainer.insertBefore(card, messagesContainer.firstChild?.nextSibling || null);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Show a "What's New" card on first launch after an update.
 */
function showWhatsNew(version: string, notes: string): void {
  const existing = document.getElementById("gsd-whats-new");
  if (existing) existing.remove();

  const card = document.createElement("div");
  card.id = "gsd-whats-new";
  card.className = "gsd-whats-new";
  card.innerHTML = `
    <div class="gsd-whats-new-header">
      <span class="gsd-whats-new-icon">🚀</span>
      <span class="gsd-whats-new-title">What's New in v${escapeHtml(version)}</span>
      <button class="gsd-whats-new-close" title="Dismiss">✕</button>
    </div>
    <div class="gsd-whats-new-notes">
      ${formatMarkdownNotes(notes)}
    </div>
  `;

  card.querySelector(".gsd-whats-new-close")?.addEventListener("click", () => {
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), 300);
  });

  messagesContainer.insertBefore(card, messagesContainer.firstChild?.nextSibling || null);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Show a full changelog panel inline in the chat.
 */
function showChangelog(entries: Array<{ version: string; notes: string; date: string }>): void {
  dismissChangelog({ silent: true });

  const entriesHtml = entries.length > 0
    ? entries.map((e, i) => `
      <div class="gsd-changelog-entry${i === 0 ? " latest" : ""}">
        <div class="gsd-changelog-entry-header">
          <span class="gsd-changelog-version">v${escapeHtml(e.version)}</span>
          ${i === 0 ? '<span class="gsd-changelog-latest-badge">latest</span>' : ""}
          <span class="gsd-changelog-date">${formatShortDate(e.date)}</span>
        </div>
        <div class="gsd-changelog-entry-notes">${formatMarkdownNotes(e.notes)}</div>
      </div>
    `).join("")
    : '<div class="gsd-changelog-empty">No changelog entries found.</div>';

  const card = document.createElement("div");
  card.id = "gsd-changelog";
  card.className = "gsd-changelog";
  card.setAttribute("tabindex", "-1");
  card.innerHTML = `
    <div class="gsd-changelog-header">
      <span class="gsd-changelog-title">📋 Changelog</span>
      <button class="gsd-changelog-close" aria-label="Close changelog" title="Close">✕</button>
    </div>
    <div class="gsd-changelog-entries">
      ${entriesHtml}
    </div>
  `;

  // Focus management: trap + Escape handler
  const trapHandler = createFocusTrap(card);
  card.addEventListener("keydown", trapHandler);

  const navHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      card.removeEventListener("keydown", trapHandler);
      card.removeEventListener("keydown", navHandler);
      setChangelogHandlers(null, null);
      card.classList.add("dismissing");
      setTimeout(() => card.remove(), 300);
      restoreFocus(getChangelogTriggerEl());
    }
  };
  card.addEventListener("keydown", navHandler);

  // Sync handlers with keyboard.ts so dismissChangelog() can clean up properly
  setChangelogHandlers(trapHandler, navHandler);

  const closeBtn = card.querySelector<HTMLElement>(".gsd-changelog-close");
  closeBtn?.addEventListener("click", () => {
    card.removeEventListener("keydown", trapHandler);
    card.removeEventListener("keydown", navHandler);
    setChangelogHandlers(null, null);
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), 300);
    restoreFocus(getChangelogTriggerEl());
  });

  messagesContainer.appendChild(card);
  scrollToBottom(messagesContainer, true);

  // Focus the close button so keyboard users can immediately interact
  if (closeBtn) {
    closeBtn.focus();
  } else {
    card.focus();
  }
}

export function addSystemEntry(text: string, kind: "info" | "error" | "warning" = "info"): void {
  const entry: ChatEntry = {
    id: nextId(),
    type: "system",
    systemText: text,
    systemKind: kind,
    timestamp: Date.now(),
  };
  state.entries.push(entry);
  pruneOldEntries(messagesContainer);
  renderer.renderNewEntry(entry);
  scrollToBottom(messagesContainer);
}

// ============================================================
// Widget rendering — persistent status bars from setWidget events
// ============================================================

/** Active widget elements keyed by widget key */
const widgetElements = new Map<string, HTMLElement>();

/**
 * Render or update a widget from a setWidget extension_ui_request.
 * Widgets are persistent DOM elements that display ambient status info
 * (e.g. the gsd-health widget showing system status, budget, provider issues).
 *
 * When lines is undefined/empty, the widget is removed (cleanup signal).
 */
function renderWidget(key: string, lines: string[] | undefined, _placement?: string): void {
  const container = document.getElementById("widgetContainer");
  if (!container) return;

  // Remove signal
  if (!lines || lines.length === 0) {
    state.widgetData.delete(key);
    const existing = widgetElements.get(key);
    if (existing) {
      existing.remove();
      widgetElements.delete(key);
    }
    return;
  }

  // Store for visualizer access
  state.widgetData.set(key, lines);

  let el = widgetElements.get(key);
  if (!el) {
    el = document.createElement("div");
    el.className = "gsd-widget";
    el.dataset.widgetKey = key;
    container.appendChild(el);
    widgetElements.set(key, el);
  }

  // Parse the health widget's compact format for styled rendering.
  // The gsd-health widget sends lines like:
  //   "  ● System OK  │  Budget: $0.12/$5.00 (2%)  │  Env: 1 warning"
  // We split on │ and apply status-aware styling.
  const text = lines.join("\n").trim();
  if (key === "gsd-health" && text.includes("│")) {
    const parts = text.split("│").map(p => p.trim()).filter(Boolean);
    const spans = parts.map(part => {
      let cls = "gsd-widget-segment";
      if (/^[✗✘]/.test(part) || /error/i.test(part)) cls += " error";
      else if (/^⚠/.test(part) || /warning/i.test(part)) cls += " warning";
      else if (/^●/.test(part) && /OK/i.test(part)) cls += " ok";
      return `<span class="${cls}">${escapeHtml(part)}</span>`;
    });
    el.innerHTML = spans.join('<span class="gsd-widget-sep">│</span>');
  } else {
    el.textContent = text;
  }
}
