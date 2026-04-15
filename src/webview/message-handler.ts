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
import { registerCleanup } from "./dispose";
import {
  TOAST_SHORT_DURATION_MS,
  TOAST_MEDIUM_DURATION_MS,
  TOAST_LONG_DURATION_MS,
  NOTE_AUTO_DISMISS_MS,
  CSS_ANIMATION_SETTLE_MS,
} from "../shared/constants";
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
import { persistAttachments } from "./persist-attachments";
import { createFocusTrap, restoreFocus, announceToScreenReader } from "./a11y";
import { setChangelogHandlers, getChangelogTriggerEl, dismissChangelog } from "./keyboard";

// Handler sub-modules
import {
  initHandlerDeps,
  resetDerivedSessionTracking,
  resolveContextWindow,
  getHeaderVersion,
  getWidgetContainer,
  getGsdApp,
  getSettingsDropdown,
  removeSteerNotes,
  updateSkillPills,
  getActiveBatchToolIds,
  setActiveBatchToolIds,
  getBatchFinalizeTimer,
  setBatchFinalizeTimer,
  setMessageParallelToolIds,
  getLastMessageUsage,
  setLastMessageUsage,
  setHasCostUpdateSource,
  getPrevCostTotals,
  setPrevCostTotals,
} from "./handlers/handler-state";
export { addSystemEntry } from "./handlers/handler-state";
import { addSystemEntry } from "./handlers/handler-state";
import {
  handleAgentStart,
  handleAgentEnd,
  handleTurnStart,
  handleTurnEnd,
  handleMessageStart,
  handleMessageUpdate,
  handleMessageEnd,
  handleAsyncSubagentProgress,
} from "./handlers/streaming-handlers";
import {
  handleToolExecutionStart,
  handleToolExecutionUpdate,
  handleToolExecutionEnd,
  flushToolEndQueue,
} from "./handlers/tool-execution-handlers";

// ============================================================
// Dependencies — set via init()
// ============================================================

let vscode: { postMessage(msg: unknown): void };
let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;
let promptInput: HTMLTextAreaElement;

let updateAllUI: () => void;
let updateHeaderUI: () => void;
let updateFooterUI: () => void;
let updateInputUI: () => void;
let updateOverlayIndicators: () => void;
let updateWorkflowBadge: (wf: any) => void;
let handleModelRouted: (oldModel: any, newModel: any) => void;
let autoResize: () => void;

// ============================================================
// Public interface
// ============================================================

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

  initHandlerDeps(deps);
  resetDerivedSessionTracking();

  window.addEventListener("message", handleMessage);
  registerCleanup("message-handler", () => window.removeEventListener("message", handleMessage));
}

// ============================================================
// Main message handler
// ============================================================

export function handleMessage(event: MessageEvent): void {
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
        const headerVer = getHeaderVersion();
        if (headerVer) headerVer.textContent = `v${data.extensionVersion}`;
      }
      updateAllUI();
      break;
    }

    case "state": {
      const data = msg.data;
      if (data) {
        state.model = data.model || null;
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
        if (!state.modelsLoaded && !state.modelsRequested) {
          state.modelsRequested = true;
          vscode.postMessage({ type: "get_available_models" });
        }
        updateAllUI();
      }
      break;
    }

    case "session_stats": {
      const data = msg.data;
      if (data) {
        if (data.autoCompactionEnabled != null) {
          state.sessionStats.autoCompactionEnabled = data.autoCompactionEnabled;
        }
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

      if (data.status === "running" && prevStatus !== "running") {
        state.isStreaming = false;
        state.isCompacting = false;
        state.lastExitDetail = null;
        state.commandsLoaded = false;
        state.commands = [];
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
      toasts.show(`Model routed: ${oldName} → ${newName}`, TOAST_SHORT_DURATION_MS);
      announceToScreenReader(`Model switched to ${newName}`);
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

    // ── Streaming/turn lifecycle (delegated) ──────────────────

    case "agent_start": {
      handleAgentStart(msg);
      break;
    }

    case "agent_end": {
      handleAgentEnd(msg);
      break;
    }

    case "turn_start": {
      handleTurnStart(msg);
      break;
    }

    case "turn_end": {
      handleTurnEnd(msg);
      break;
    }

    case "message_start": {
      handleMessageStart(msg);
      break;
    }

    case "message_update": {
      handleMessageUpdate(msg);
      break;
    }

    case "async_subagent_progress": {
      handleAsyncSubagentProgress(msg);
      break;
    }

    case "message_end": {
      handleMessageEnd(msg);
      break;
    }

    // ── Tool execution (delegated) ────────────────────────────

    case "tool_execution_start": {
      handleToolExecutionStart(msg);
      break;
    }

    case "tool_execution_update": {
      handleToolExecutionUpdate(msg);
      break;
    }

    case "tool_execution_end": {
      handleToolExecutionEnd(msg);
      break;
    }

    // ── Remaining inline cases ────────────────────────────────

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
      toasts.show(`⚠ Model switched: ${from} → ${to} (${reason})`, TOAST_LONG_DURATION_MS);
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
        toasts.show(`✓ Original provider restored: ${model.provider}/${model.id}`, TOAST_MEDIUM_DURATION_MS);
        state.model = {
          id: model.id,
          name: model.name || model.id,
          provider: model.provider,
          contextWindow: model.contextWindow,
        };
        updateHeaderUI();
      } else {
        toasts.show("✓ Original provider restored", TOAST_MEDIUM_DURATION_MS);
      }
      break;
    }

    case "fallback_chain_exhausted": {
      const data = msg as any;
      const lastError = data.lastError || "All providers failed";
      addSystemEntry(`All fallback providers exhausted: ${lastError}. Check your API keys or try again later.`, "error");
      toasts.show("⚠ All model providers failed", TOAST_LONG_DURATION_MS);
      break;
    }

    case "session_shutdown": {
      state.isStreaming = false;
      state.isCompacting = false;
      state.processStatus = "stopped";
      flushToolEndQueue();
      const timer = getBatchFinalizeTimer();
      if (timer) { clearTimeout(timer); setBatchFinalizeTimer(null); }
      const batchIds = getActiveBatchToolIds();
      if (batchIds) { renderer.finalizeParallelBatch(getLastMessageUsage()); }
      setActiveBatchToolIds(null);
      setMessageParallelToolIds(null);
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
      announceToScreenReader(`Error: ${extError}`);
      break;
    }

    case "steer_persisted": {
      const note = document.querySelector(".gsd-steer-note");
      if (note) {
        note.textContent = "⚡ Override saved — applies to current and future tasks";
        setTimeout(() => note.isConnected && note.remove(), NOTE_AUTO_DISMISS_MS);
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
      removeSteerNotes();
      addSystemEntry(data.message, "error");
      announceToScreenReader(`Error: ${data.message}`);
      break;
    }

    case "process_exit": {
      const data = msg;
      state.isStreaming = false;
      state.isCompacting = false;
      state.isRetrying = false;
      state.processHealth = "responsive";
      state.currentTurn = null;
      removeSteerNotes();
      autoProgress.update(null);
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("Process exited");
      }
      state.commandsLoaded = false;
      state.commands = [];
      renderer.resetStreamingState();
      resetDerivedSessionTracking();
      updateInputUI();
      updateOverlayIndicators();

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
        toasts.show(`⚠ No read access: ${names.join(", ")}`, TOAST_MEDIUM_DURATION_MS);
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

      state.entries = [];
      state.currentTurn = null;
      renderer.resetStreamingState();
      renderer.clearMessages();
      state.sessionStats = {};
      state.loadedSkills.clear();
      updateSkillPills();
      resetPrunedCount();

      state.images = [];
      state.files = [];
      persistAttachments();
      promptInput.value = '';

      resetDerivedSessionTracking();

      if (data.state) {
        state.model = data.state.model || null;
        if ("thinkingLevel" in data.state) {
          state.thinkingLevel = data.state.thinkingLevel ?? null;
        }
        state.isStreaming = data.state.isStreaming || false;
        state.isCompacting = data.state.isCompacting || false;
        if (state.processStatus !== "crashed") state.processStatus = "running";
      }

      if (data.messages && data.messages.length > 0) {
        renderHistoricalMessages(data.messages);
      }

      if (data.state?.sessionId) {
        sessionHistory.setCurrentSessionId(data.state.sessionId as string);
      }

      sessionHistory.hide();

      updateAllUI();
      scrollToBottom(messagesContainer, true);
      break;
    }

    case "terminal_output":
      break;

    case "cost_update": {
      setHasCostUpdateSource(true);
      const cu = (msg as any).data || (msg as any);

      const tok = cu.tokens || {};
      const totalInput = tok.input || cu.totalInput || 0;
      const totalOutput = tok.output || cu.totalOutput || 0;
      const totalCacheRead = tok.cacheRead || cu.totalCacheRead || 0;
      const totalCacheWrite = tok.cacheWrite || cu.totalCacheWrite || 0;

      const costValue = cu.cumulativeCost ?? cu.totalCost;

      const prev = getPrevCostTotals();
      const turnInput = totalInput - prev.input;
      const turnOutput = totalOutput - prev.output;
      const turnCacheRead = totalCacheRead - prev.cacheRead;
      const turnCacheWrite = totalCacheWrite - prev.cacheWrite;
      const turnCost = typeof costValue === "number" ? Math.max(0, costValue - prev.cost) : undefined;
      setPrevCostTotals({
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite,
        cost: typeof costValue === "number" ? costValue : prev.cost,
      });

      state.sessionStats.tokens = {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite,
        total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
      };

      setLastMessageUsage({
        input: turnInput,
        output: turnOutput,
        cacheRead: turnCacheRead,
        cacheWrite: turnCacheWrite,
        cost: typeof turnCost === "number" ? { total: turnCost } : undefined,
      });

      const turnContextTokens = turnInput + turnCacheRead + turnCacheWrite;
      const contextWindow = resolveContextWindow();
      if (contextWindow > 0 && turnContextTokens > 0) {
        state.sessionStats.contextTokens = turnContextTokens;
        state.sessionStats.contextWindow = contextWindow;
        state.sessionStats.contextPercent = (turnContextTokens / contextWindow) * 100;
        console.debug(`[gsd:context] cost_update context%: ${(turnContextTokens / contextWindow * 100).toFixed(1)}% (turn tokens=${turnContextTokens}, window=${contextWindow})`);
      }

      if (typeof costValue === "number") {
        state.sessionStats.cost = costValue;
      }
      updateHeaderUI();
      updateFooterUI();
      break;
    }

    case "execution_complete":
      break;
    case "extensions_ready":
      break;

    default:
      console.warn("[gsd-webview] Unrecognized message type:", (msg as any).type);
      break;
  }

  } catch (err: any) {
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

function renderHistoricalMessages(messages: import("../shared/types").AgentMessage[]): void {
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
  }

  if (state.entries.length > 0) {
    welcomeScreen.classList.add("gsd-hidden");
  }
}

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
  const app = getGsdApp();
  if (app) {
    app.setAttribute("data-theme", theme);
  }
  const dropdown = getSettingsDropdown();
  if (dropdown) {
    dropdown.querySelectorAll(".gsd-settings-option").forEach(el => {
      const isActive = (el as HTMLElement).dataset.theme === theme;
      el.classList.toggle("active", isActive);
      el.setAttribute("aria-checked", String(isActive));
    });
  }
}

function showUpdateCard(
  version: string,
  currentVersion: string,
  releaseNotes: string,
  downloadUrl: string
): void {
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

  card.querySelector('[data-action="install"]')?.addEventListener("click", () => {
    vscode.postMessage({ type: "update_install", downloadUrl } as WebviewToExtensionMessage);
    card.remove();
  });

  card.querySelector('[data-action="dismiss"]')?.addEventListener("click", () => {
    vscode.postMessage({ type: "update_dismiss", version } as WebviewToExtensionMessage);
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), CSS_ANIMATION_SETTLE_MS);
  });

  messagesContainer.insertBefore(card, messagesContainer.firstChild?.nextSibling || null);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
    setTimeout(() => card.remove(), CSS_ANIMATION_SETTLE_MS);
  });

  messagesContainer.insertBefore(card, messagesContainer.firstChild?.nextSibling || null);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

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

  const trapHandler = createFocusTrap(card);
  card.addEventListener("keydown", trapHandler);

  const navHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      card.removeEventListener("keydown", trapHandler);
      card.removeEventListener("keydown", navHandler);
      setChangelogHandlers(null, null);
      card.classList.add("dismissing");
      setTimeout(() => card.remove(), CSS_ANIMATION_SETTLE_MS);
      restoreFocus(getChangelogTriggerEl());
    }
  };
  card.addEventListener("keydown", navHandler);

  setChangelogHandlers(trapHandler, navHandler);

  const closeBtn = card.querySelector<HTMLElement>(".gsd-changelog-close");
  closeBtn?.addEventListener("click", () => {
    card.removeEventListener("keydown", trapHandler);
    card.removeEventListener("keydown", navHandler);
    setChangelogHandlers(null, null);
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), CSS_ANIMATION_SETTLE_MS);
    restoreFocus(getChangelogTriggerEl());
  });

  messagesContainer.appendChild(card);
  scrollToBottom(messagesContainer, true);

  if (closeBtn) {
    closeBtn.focus();
  } else {
    card.focus();
  }
}

// ============================================================
// Widget rendering — persistent status bars from setWidget events
// ============================================================

const widgetElements = new Map<string, HTMLElement>();

function renderWidget(key: string, lines: string[] | undefined, _placement?: string): void {
  const container = getWidgetContainer();
  if (!container) return;

  if (!lines || lines.length === 0) {
    state.widgetData.delete(key);
    const existing = widgetElements.get(key);
    if (existing) {
      existing.remove();
      widgetElements.delete(key);
    }
    return;
  }

  state.widgetData.set(key, lines);

  let el = widgetElements.get(key);
  if (!el) {
    el = document.createElement("div");
    el.className = "gsd-widget";
    el.dataset.widgetKey = key;
    container.appendChild(el);
    widgetElements.set(key, el);
  }

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
