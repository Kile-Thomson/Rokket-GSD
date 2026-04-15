// ============================================================
// Message Handler — thin router delegating to handler sub-modules
// ============================================================

import type { ExtensionToWebviewMessage } from "../shared/types";
import { registerCleanup } from "./dispose";

// Handler sub-modules
import { initHandlerDeps, resetDerivedSessionTracking, addSystemEntry } from "./handlers/handler-state";
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
} from "./handlers/tool-execution-handlers";
import {
  handleConfig,
  handleState,
  handleSessionStats,
  handleProcessStatus,
  handleWorkflowState,
  handleDashboardData,
  handleAutoProgress,
  handleModelRouted,
  handleCommands,
  handleAvailableModels,
  handleThinkingLevelChanged,
  handleSessionList,
  handleSessionListError,
  handleSessionSwitched,
  handleCostUpdate,
} from "./handlers/state-handlers";
import {
  handleWhatsNew,
  handleChangelog,
  handleUpdateAvailable,
  handleExtensionError,
  handleSteerPersisted,
  handleExtensionUiRequest,
  handleBashResult,
  handleError,
  handleProcessExit,
  handleProcessHealth,
  handleFileAccessResult,
  handleTempFileSaved,
  handleFilesAttached,
  handleAutoCompactionStart,
  handleAutoCompactionEnd,
  handleAutoRetryStart,
  handleAutoRetryEnd,
  handleFallbackProviderSwitch,
  handleFallbackProviderRestored,
  handleFallbackChainExhausted,
  handleSessionShutdown,
} from "./handlers/ui-notification-handlers";

// Re-exports for external consumers
export { addSystemEntry } from "./handlers/handler-state";

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
  initHandlerDeps(deps);
  resetDerivedSessionTracking();

  window.addEventListener("message", handleMessage);
  registerCleanup("message-handler", () => window.removeEventListener("message", handleMessage));
}

// ============================================================
// Main message handler — routing switch
// ============================================================

export function handleMessage(event: MessageEvent): void {
  const raw = event.data as Record<string, unknown>;
  if (!raw || !raw.type) return;
  const msg = raw as ExtensionToWebviewMessage;

  try {

  switch (msg.type) {
    // ── State/session/config ─────────────────────────────────
    case "config":                  { handleConfig(msg); break; }
    case "state":                   { handleState(msg); break; }
    case "session_stats":           { handleSessionStats(msg); break; }
    case "process_status":          { handleProcessStatus(msg); break; }
    case "workflow_state":          { handleWorkflowState(msg); break; }
    case "dashboard_data":          { handleDashboardData(msg); break; }
    case "auto_progress":           { handleAutoProgress(msg); break; }
    case "model_routed":            { handleModelRouted(msg); break; }
    case "commands":                { handleCommands(msg); break; }
    case "available_models":        { handleAvailableModels(msg); break; }
    case "thinking_level_changed":  { handleThinkingLevelChanged(msg); break; }
    case "session_list":            { handleSessionList(msg); break; }
    case "session_list_error":      { handleSessionListError(msg); break; }
    case "session_switched":        { handleSessionSwitched(msg); break; }
    case "cost_update":             { handleCostUpdate(msg); break; }
    case "terminal_output":         break;
    case "execution_complete":      break;
    case "extensions_ready":        break;

    // ── Streaming/turn lifecycle ─────────────────────────────
    case "agent_start":             { handleAgentStart(msg); break; }
    case "agent_end":               { handleAgentEnd(msg); break; }
    case "turn_start":              { handleTurnStart(msg); break; }
    case "turn_end":                { handleTurnEnd(msg); break; }
    case "message_start":           { handleMessageStart(msg); break; }
    case "message_update":          { handleMessageUpdate(msg); break; }
    case "async_subagent_progress": { handleAsyncSubagentProgress(msg); break; }
    case "message_end":             { handleMessageEnd(msg); break; }

    // ── Tool execution ───────────────────────────────────────
    case "tool_execution_start":    { handleToolExecutionStart(msg); break; }
    case "tool_execution_update":   { handleToolExecutionUpdate(msg); break; }
    case "tool_execution_end":      { handleToolExecutionEnd(msg); break; }

    // ── UI notifications ─────────────────────────────────────
    case "whats_new":               { handleWhatsNew(msg); break; }
    case "changelog":               { handleChangelog(msg); break; }
    case "update_available":        { handleUpdateAvailable(msg); break; }
    case "extension_error":         { handleExtensionError(msg); break; }
    case "steer_persisted":         { handleSteerPersisted(); break; }
    case "extension_ui_request":    { handleExtensionUiRequest(msg); break; }
    case "bash_result":             { handleBashResult(msg); break; }
    case "error":                   { handleError(msg); break; }
    case "process_exit":            { handleProcessExit(msg); break; }
    case "process_health":          { handleProcessHealth(msg); break; }
    case "file_access_result":      { handleFileAccessResult(msg); break; }
    case "temp_file_saved":         { handleTempFileSaved(msg); break; }
    case "files_attached":          { handleFilesAttached(msg); break; }
    case "auto_compaction_start":   { handleAutoCompactionStart(); break; }
    case "auto_compaction_end":     { handleAutoCompactionEnd(msg); break; }
    case "auto_retry_start":        { handleAutoRetryStart(msg); break; }
    case "auto_retry_end":          { handleAutoRetryEnd(msg); break; }
    case "fallback_provider_switch":    { handleFallbackProviderSwitch(msg); break; }
    case "fallback_provider_restored":  { handleFallbackProviderRestored(msg); break; }
    case "fallback_chain_exhausted":    { handleFallbackChainExhausted(msg); break; }
    case "session_shutdown":        { handleSessionShutdown(); break; }

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
