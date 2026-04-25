import { escapeHtml, scrollToBottom } from "../helpers";
import { state, nextId, pruneOldEntries, type ChatEntry } from "../state";
import * as renderer from "../renderer";
import type { WorkflowState } from "../../shared/types";

// ============================================================
// Dependencies — set via initHandlerDeps()
// ============================================================

export interface HandlerDeps {
  vscode: { postMessage(msg: unknown): void };
  messagesContainer: HTMLElement;
  welcomeScreen: HTMLElement;
  promptInput: HTMLTextAreaElement;
  updateAllUI: () => void;
  updateHeaderUI: () => void;
  updateFooterUI: () => void;
  updateInputUI: () => void;
  updateOverlayIndicators: () => void;
  updateWorkflowBadge: (wf: WorkflowState | null) => void;
  handleModelRouted: (oldModel: { id: string; provider: string } | null, newModel: { id: string; provider: string } | null) => void;
  autoResize: () => void;
}

let _deps: HandlerDeps | null = null;

export function initHandlerDeps(d: HandlerDeps): void {
  _deps = d;
}

export function getDeps(): HandlerDeps {
  if (!_deps) {
    throw new Error("Handler dependencies have not been initialised — call initHandlerDeps() first");
  }
  return _deps;
}

// ============================================================
// Mutable state — getter/setter for cross-module access
// ============================================================

export type MessageUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
} | null;

let lastMessageUsage: MessageUsage = null;
let hasCostUpdateSource = false;
let prevCostTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
let prevMessageEndUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function getLastMessageUsage(): MessageUsage { return lastMessageUsage; }
export function setLastMessageUsage(v: MessageUsage): void { lastMessageUsage = v; }

export function getHasCostUpdateSource(): boolean { return hasCostUpdateSource; }
export function setHasCostUpdateSource(v: boolean): void { hasCostUpdateSource = v; }

export function getPrevCostTotals() { return prevCostTotals; }
export function setPrevCostTotals(v: typeof prevCostTotals): void { prevCostTotals = v; }

export function getPrevMessageEndUsage() { return prevMessageEndUsage; }
export function setPrevMessageEndUsage(v: typeof prevMessageEndUsage): void { prevMessageEndUsage = v; }

// ============================================================
// Pending → Streaming transition
// ============================================================

export function confirmBackendActive(): void {
  if (state.isPending) {
    state.isPending = false;
    state.isStreaming = true;
    getDeps().updateInputUI();
  }
}

// ============================================================
// Reset per-session derived tracking state
// ============================================================

export function resetDerivedSessionTracking(): void {
  hasCostUpdateSource = false;
  prevCostTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  prevMessageEndUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  lastMessageUsage = null;
}

// ============================================================
// Context window resolution
// ============================================================

const KNOWN_CONTEXT_WINDOWS: Array<[pattern: string, tokens: number]> = [
  ["opus-4", 200_000],
  ["sonnet-4", 200_000],
  ["haiku-4", 200_000],
  ["claude-3.5", 200_000],
  ["claude-3-opus", 200_000],
  ["claude-3-sonnet", 200_000],
  ["claude-3-haiku", 200_000],
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-4.1", 1_000_000],
  ["gpt-4", 8_192],
  ["o1", 200_000],
  ["o3", 200_000],
  ["o4-mini", 200_000],
  ["gemini-2", 1_000_000],
  ["gemini-1.5", 1_000_000],
  ["codex", 200_000],
  ["deepseek", 128_000],
];

export function resolveContextWindow(): number {
  if (state.sessionStats.contextWindow) return state.sessionStats.contextWindow;
  if (state.model?.contextWindow) return state.model.contextWindow;
  const modelId = state.model?.id || "";
  const provider = state.model?.provider || "";
  if (modelId && state.availableModels.length > 0) {
    const match = state.availableModels.find(
      (m) => m.id === modelId && (!provider || m.provider === provider)
    );
    if (match?.contextWindow) return match.contextWindow;
  }
  if (modelId) {
    for (const [pattern, tokens] of KNOWN_CONTEXT_WINDOWS) {
      if (modelId.includes(pattern)) return tokens;
    }
  }
  return 0;
}

// ============================================================
// Cached DOM refs — queried lazily, survive for webview lifetime
// ============================================================

let cachedHeaderVersion: HTMLElement | null | undefined;
let cachedWidgetContainer: HTMLElement | null | undefined;
let cachedGsdApp: Element | null | undefined;
let cachedSettingsDropdown: HTMLElement | null | undefined;

export function getHeaderVersion(): HTMLElement | null {
  if (cachedHeaderVersion === undefined) {
    cachedHeaderVersion = document.getElementById("headerVersion");
  }
  return cachedHeaderVersion;
}

export function getWidgetContainer(): HTMLElement | null {
  if (cachedWidgetContainer === undefined) {
    cachedWidgetContainer = document.getElementById("widgetContainer");
  }
  return cachedWidgetContainer;
}

export function getGsdApp(): Element | null {
  if (cachedGsdApp === undefined) {
    cachedGsdApp = document.querySelector(".gsd-app");
  }
  return cachedGsdApp;
}

export function getSettingsDropdown(): HTMLElement | null {
  if (cachedSettingsDropdown === undefined) {
    cachedSettingsDropdown = document.getElementById("settingsDropdown");
  }
  return cachedSettingsDropdown;
}

// ============================================================
// Steer-note removal
// ============================================================

export function removeSteerNotes(): void {
  document.querySelectorAll(".gsd-steer-note").forEach((el) => el.remove());
}

// ============================================================
// Skill pill tracker
// ============================================================

let cachedSkillPills: HTMLElement | null = null;
let cachedFooterStats: HTMLElement | null | undefined;

export function updateSkillPills(): void {
  let container = cachedSkillPills || document.getElementById("skillPills");
  if (!container) {
    if (cachedFooterStats === undefined) {
      cachedFooterStats = document.getElementById("footerStats");
    }
    if (!cachedFooterStats) return;
    container = document.createElement("span");
    container.id = "skillPills";
    container.className = "gsd-skill-pills";
    cachedFooterStats.insertAdjacentElement("afterend", container);
  }
  cachedSkillPills = container;

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
// System entry helper — shared across handler modules
// ============================================================

export function addSystemEntry(text: string, kind: "info" | "error" | "warning" = "info"): void {
  const { messagesContainer } = getDeps();
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
