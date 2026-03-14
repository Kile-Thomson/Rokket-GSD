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
import * as fileHandling from "./file-handling";

// ============================================================
// Dependencies — set via init()
// ============================================================

let vscode: { postMessage(msg: unknown): void };
let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;
let promptInput: HTMLTextAreaElement;
let toolWatchdogTimers: Map<string, ReturnType<typeof setTimeout>>;

// Callbacks into index.ts UI functions
let updateAllUI: () => void;
let updateHeaderUI: () => void;
let updateFooterUI: () => void;
let updateInputUI: () => void;
let updateOverlayIndicators: () => void;
let updateWorkflowBadge: (wf: any) => void;
let autoResize: () => void;
let announceToScreenReader: (text: string) => void;
let startToolWatchdog: (toolCallId: string) => void;
let clearToolWatchdog: (toolCallId: string) => void;

export interface MessageHandlerDeps {
  vscode: { postMessage(msg: unknown): void };
  messagesContainer: HTMLElement;
  welcomeScreen: HTMLElement;
  promptInput: HTMLTextAreaElement;
  toolWatchdogTimers: Map<string, ReturnType<typeof setTimeout>>;
  updateAllUI: () => void;
  updateHeaderUI: () => void;
  updateFooterUI: () => void;
  updateInputUI: () => void;
  updateOverlayIndicators: () => void;
  updateWorkflowBadge: (wf: any) => void;
  autoResize: () => void;
  announceToScreenReader: (text: string) => void;
  startToolWatchdog: (toolCallId: string) => void;
  clearToolWatchdog: (toolCallId: string) => void;
}

export function init(deps: MessageHandlerDeps): void {
  vscode = deps.vscode;
  messagesContainer = deps.messagesContainer;
  welcomeScreen = deps.welcomeScreen;
  promptInput = deps.promptInput;
  toolWatchdogTimers = deps.toolWatchdogTimers;
  updateAllUI = deps.updateAllUI;
  updateHeaderUI = deps.updateHeaderUI;
  updateFooterUI = deps.updateFooterUI;
  updateInputUI = deps.updateInputUI;
  updateOverlayIndicators = deps.updateOverlayIndicators;
  updateWorkflowBadge = deps.updateWorkflowBadge;
  autoResize = deps.autoResize;
  announceToScreenReader = deps.announceToScreenReader;
  startToolWatchdog = deps.startToolWatchdog;
  clearToolWatchdog = deps.clearToolWatchdog;

  window.addEventListener("message", handleMessage);
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
        state.thinkingLevel = data.thinkingLevel || "off";
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
        }
        updateAllUI();
      }
      break;
    }

    case "session_stats": {
      const data = msg.data;
      if (data) {
        state.sessionStats = {
          ...state.sessionStats,
          ...data,
        };
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
      dashboard.renderDashboard(msg.data);
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
      // Expire any pending UI dialogs from a previous turn — the backend's
      // abort signal has already auto-resolved them, so user interaction
      // would go nowhere.
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("New turn started");
      }
      state.isStreaming = true;
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
      break;
    }

    case "agent_end": {
      state.isStreaming = false;
      announceToScreenReader("Response complete.");
      state.processHealth = "responsive";
      // Clear all tool watchdog timers
      for (const [, timer] of toolWatchdogTimers) {
        clearTimeout(timer);
      }
      toolWatchdogTimers.clear();
      // Expire any pending UI dialogs — the backend's abort signal fires
      // on agent_end, auto-resolving all pending dialogs to defaults.
      // Mark them so the user sees they're no longer interactive.
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("Agent finished");
      }
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
      break;
    }

    case "message_update": {
      if (!state.currentTurn) break;
      const data = msg;
      const delta = data.assistantMessageEvent || data.delta;

      if (delta) {
        if (delta.type === "text_delta" && delta.delta) {
          renderer.appendToTextSegment("text", delta.delta);
        } else if (delta.type === "thinking_delta" && delta.delta) {
          renderer.appendToTextSegment("thinking", delta.delta);
        }
      }
      break;
    }

    case "message_end": {
      const endData = msg;
      const endMsg = endData.message;
      if (endMsg?.role === "assistant" && endMsg.usage) {
        const u = endMsg.usage;
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
        const contextTokens = (u.input || 0) + (u.cacheRead || 0);
        const contextWindow = state.model?.contextWindow || state.sessionStats.contextWindow || 0;
        if (contextWindow > 0 && contextTokens > 0) {
          state.sessionStats.contextTokens = contextTokens;
          state.sessionStats.contextWindow = contextWindow;
          state.sessionStats.contextPercent = (contextTokens / contextWindow) * 100;
        }
        updateHeaderUI();
        updateFooterUI();
      }
      break;
    }

    case "tool_execution_start": {
      if (!state.currentTurn) break;
      const data = msg;
      const tc: ToolCallState = {
        id: data.toolCallId,
        name: data.toolName,
        args: data.args || {},
        resultText: "",
        isError: false,
        isRunning: true,
        startTime: Date.now(),
      };
      state.currentTurn.toolCalls.set(data.toolCallId, tc);
      const segIdx = state.currentTurn.segments.length;
      state.currentTurn.segments.push({ type: "tool", toolCallId: data.toolCallId });
      renderer.appendToolSegmentElement(tc, segIdx);
      // Start watchdog timer for this tool
      startToolWatchdog(data.toolCallId);
      scrollToBottom(messagesContainer);
      break;
    }

    case "tool_execution_update": {
      if (!state.currentTurn) break;
      const data = msg;
      const tc = state.currentTurn.toolCalls.get(data.toolCallId);
      if (tc && data.partialResult) {
        const text = data.partialResult.content
          ?.map((c: any) => c.text || "")
          .filter(Boolean)
          .join("\n");
        if (text) tc.resultText = text;
        renderer.updateToolSegmentElement(data.toolCallId);
        scrollToBottom(messagesContainer);
      }
      break;
    }

    case "tool_execution_end": {
      if (!state.currentTurn) break;
      const data = msg;
      // Clear watchdog — tool completed normally
      clearToolWatchdog(data.toolCallId);
      const tc = state.currentTurn.toolCalls.get(data.toolCallId);
      if (tc) {
        tc.isRunning = false;
        tc.isError = data.isError;
        tc.endTime = Date.now();
        if (data.durationMs) {
          tc.endTime = tc.startTime + data.durationMs;
        }
        if (data.result) {
          const text = data.result.content
            ?.map((c: any) => c.text || "")
            .filter(Boolean)
            .join("\n");
          if (text) tc.resultText = text;
        }
      }
      renderer.updateToolSegmentElement(data.toolCallId);
      scrollToBottom(messagesContainer);
      break;
    }

    case "auto_compaction_start": {
      state.isCompacting = true;
      updateOverlayIndicators();
      break;
    }

    case "auto_compaction_end": {
      state.isCompacting = false;
      updateOverlayIndicators();
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

    case "extension_error": {
      const data = msg;
      const extError = (data as any).error as string || "unknown error";
      addSystemEntry(`Command error: ${extError}`, "error");
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
      // Clear all tool watchdog timers
      for (const [, timer] of toolWatchdogTimers) {
        clearTimeout(timer);
      }
      toolWatchdogTimers.clear();
      // Expire any pending dialogs — the process is gone
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("Process exited");
      }
      // Reset command cache — the process that provided them is dead
      state.commandsLoaded = false;
      state.commands = [];
      renderer.resetStreamingState();
      updateInputUI();
      updateOverlayIndicators();

      // Build an informative error message including stderr detail
      const detail = (data as any).detail as string | undefined;
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

      // Apply the new state
      if (data.state) {
        state.model = data.state.model || null;
        state.thinkingLevel = data.state.thinkingLevel || "off";
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
  }

  } catch (err: any) {
    // Global error boundary — surface crashes visibly instead of silent failure
    const errorId = `GSD-ERR-${Date.now().toString(36).toUpperCase()}`;
    console.error(`[${errorId}] Message handler error for "${msg.type}":`, err);
    addSystemEntry(
      `Internal error processing "${msg.type}" (${errorId}). Check browser console for details. Please report this error code.`,
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
  // First pass: index tool results by toolCallId
  const toolResults = new Map<string, { text: string; isError: boolean }>();
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      const toolCallId = (msg as Record<string, unknown>).toolCallId as string | undefined;
      if (toolCallId) {
        toolResults.set(toolCallId, {
          text: extractMessageText(msg.content),
          isError: !!(msg as Record<string, unknown>).isError,
        });
      }
    }
  }

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
      renderer.renderNewEntry(entry);
    } else if (msg.role === "assistant") {
      const segments: TurnSegment[] = [];
      const turnToolCalls = new Map<string, ToolCallState>();

      // Parse content blocks into segments
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
          } else if (block.type === "tool_use" && block.name) {
            const toolId = (block.id as string) || nextId();
            const result = toolResults.get(toolId);
            const tc: ToolCallState = {
              id: toolId,
              name: block.name as string,
              args: (block.input as Record<string, unknown>) || {},
              resultText: result?.text || "",
              isError: result?.isError || false,
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
      renderer.renderNewEntry(entry);
    }
    // Skip toolResult (already indexed) and bashExecution
  }

  // Show messages area, hide welcome
  if (state.entries.length > 0) {
    welcomeScreen.style.display = "none";
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
  scrollToBottom(messagesContainer);
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
  scrollToBottom(messagesContainer);
}

/**
 * Show a full changelog panel inline in the chat.
 */
function showChangelog(entries: Array<{ version: string; notes: string; date: string }>): void {
  const existing = document.getElementById("gsd-changelog");
  if (existing) existing.remove();

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
  card.innerHTML = `
    <div class="gsd-changelog-header">
      <span class="gsd-changelog-title">📋 Changelog</span>
      <button class="gsd-changelog-close" title="Close">✕</button>
    </div>
    <div class="gsd-changelog-entries">
      ${entriesHtml}
    </div>
  `;

  card.querySelector(".gsd-changelog-close")?.addEventListener("click", () => {
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), 300);
  });

  messagesContainer.appendChild(card);
  scrollToBottom(messagesContainer, true);
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
  renderer.renderNewEntry(entry);
  scrollToBottom(messagesContainer);
}
