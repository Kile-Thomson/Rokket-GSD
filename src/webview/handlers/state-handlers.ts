import type { ExtensionToWebviewMessage, ProcessStatus } from "../../shared/types";
import { scrollToBottom } from "../helpers";
import {
  state,
  nextId,
  pruneOldEntries,
  resetPrunedCount,
  type ChatEntry,
  type ToolCallState,
  type TurnSegment,
} from "../state";
import * as renderer from "../renderer";
import * as sessionHistory from "../session-history";
import * as slashMenu from "../slash-menu";
import * as modelPicker from "../model-picker";
import * as thinkingPicker from "../thinking-picker";
import * as toasts from "../toasts";
import * as dashboard from "../dashboard";
import * as autoProgress from "../auto-progress";
import * as visualizer from "../visualizer";
import { persistAttachments } from "../persist-attachments";
import { announceToScreenReader } from "../a11y";
import { TOAST_SHORT_DURATION_MS } from "../../shared/constants";
import {
  getDeps,
  resetDerivedSessionTracking,
  resolveContextWindow,
  getHeaderVersion,
  updateSkillPills,
  setLastMessageUsage,
  setHasCostUpdateSource,
  getPrevCostTotals,
  setPrevCostTotals,
} from "./handler-state";
import { applyTheme } from "./ui-notification-handlers";

export function handleConfig(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
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
  deps.updateAllUI();
}

export function handleState(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = (msg as any).data;
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
      deps.vscode.postMessage({ type: "get_available_models" });
    }
    deps.updateAllUI();
  }
}

export function handleSessionStats(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = (msg as any).data;
  if (data) {
    if (data.autoCompactionEnabled != null) {
      state.sessionStats.autoCompactionEnabled = data.autoCompactionEnabled;
    }
    if (data.contextWindow) {
      state.sessionStats.contextWindow = data.contextWindow;
    }
    deps.updateHeaderUI();
    deps.updateFooterUI();
  }
}

export function handleProcessStatus(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
  const prevStatus = state.processStatus;
  state.processStatus = data.status as ProcessStatus;

  if (data.status === "running" && prevStatus !== "running") {
    state.isStreaming = false;
    state.isCompacting = false;
    state.lastExitDetail = null;
    state.commandsLoaded = false;
    state.commands = [];
    deps.vscode.postMessage({ type: "get_commands" });
  }

  deps.updateOverlayIndicators();
  dashboard.updateWelcomeScreen();
}

export function handleWorkflowState(msg: ExtensionToWebviewMessage): void {
  getDeps().updateWorkflowBadge((msg as any).state);
}

export function handleDashboardData(msg: ExtensionToWebviewMessage): void {
  if (visualizer.isVisible()) {
    visualizer.updateData((msg as any).data);
  } else {
    dashboard.renderDashboard((msg as any).data);
  }
}

export function handleAutoProgress(msg: ExtensionToWebviewMessage): void {
  autoProgress.update((msg as any).data);
}

export function handleModelRouted(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
  deps.handleModelRouted(data.oldModel, data.newModel);
  const oldName = data.oldModel?.id || "unknown";
  const newName = data.newModel?.id || "unknown";
  toasts.show(`Model routed: ${oldName} → ${newName}`, TOAST_SHORT_DURATION_MS);
  announceToScreenReader(`Model switched to ${newName}`);
}

export function handleCommands(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
  state.commands = data.commands || [];
  state.commandsLoaded = true;
  if (slashMenu.isVisible()) {
    const filter = deps.promptInput.value.slice(1).trim();
    slashMenu.show(filter);
  }
}

export function handleAvailableModels(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
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
      deps.updateHeaderUI();
      deps.updateFooterUI();
    }
  }
  if (modelPicker.isVisible()) {
    modelPicker.render();
  }
}

export function handleThinkingLevelChanged(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
  state.thinkingLevel = data.level || "off";
  deps.updateHeaderUI();
  deps.updateFooterUI();
  thinkingPicker.refresh();
  toasts.show(`Thinking: ${state.thinkingLevel}`);
}

export function handleSessionList(msg: ExtensionToWebviewMessage): void {
  sessionHistory.updateSessions((msg as any).sessions || []);
}

export function handleSessionListError(msg: ExtensionToWebviewMessage): void {
  sessionHistory.showError((msg as any).message);
}

export function handleSessionSwitched(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;

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
  deps.promptInput.value = '';

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
    renderHistoricalMessages(data.messages, deps.messagesContainer, deps.welcomeScreen);
  }

  if (data.state?.sessionId) {
    sessionHistory.setCurrentSessionId(data.state.sessionId as string);
  }

  sessionHistory.hide();

  deps.updateAllUI();
  scrollToBottom(deps.messagesContainer, true);
}

export function handleCostUpdate(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
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
  deps.updateHeaderUI();
  deps.updateFooterUI();
}

export function renderHistoricalMessages(
  messages: import("../../shared/types").AgentMessage[],
  messagesContainer: HTMLElement,
  welcomeScreen: HTMLElement,
): void {
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
