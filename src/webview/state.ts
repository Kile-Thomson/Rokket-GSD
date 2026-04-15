// ============================================================
// Webview State — types, interfaces, and shared mutable state
// ============================================================

import type {
  ImageAttachment,
  FileAttachment,
  SessionStats,
  CommandInfo,
  ProcessStatus,
  ProcessHealthStatus,
  AutoProgressData,
  ThinkingLevel,
} from "../shared/types";
import { MAX_ENTRIES as MAX_ENTRIES_CONST } from "../shared/constants";

// ============================================================
// Types
// ============================================================

export interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  resultText: string;
  isError: boolean;
  isRunning: boolean;
  /** True when tool was skipped due to a steer/redirect */
  isSkipped?: boolean;
  startTime: number;
  endTime?: number;
  /** Structured details from tool (e.g. subagent per-agent results) */
  details?: Record<string, unknown>;
  /** True when this tool executed concurrently with other tools */
  isParallel?: boolean;
}

/** A segment in the sequential stream — text, thinking, tool call, or server-side tool */
export type TurnSegment =
  | { type: "text"; chunks: string[] }
  | { type: "thinking"; chunks: string[] }
  | { type: "tool"; toolCallId: string }
  | { type: "server_tool"; serverToolId: string; name: string; input?: unknown; results?: unknown; isComplete: boolean };

/** One assistant turn = ordered sequence of segments */
export interface AssistantTurn {
  id: string;
  /** Ordered segments in the sequence they arrived */
  segments: TurnSegment[];
  /** Quick lookup for tool calls by ID */
  toolCalls: Map<string, ToolCallState>;
  isComplete: boolean;
  timestamp: number;
  /** True when this turn was detected as a stale background job echo */
  isStaleEcho?: boolean;
}

export interface ChatEntry {
  id: string;
  type: "user" | "assistant" | "system";
  // For user
  text?: string;
  images?: ImageAttachment[];
  files?: FileAttachment[];
  /** True when this user message was a steer/interrupt sent during streaming */
  isSteer?: boolean;
  // For assistant — a turn with grouped content
  turn?: AssistantTurn;
  // For system
  systemText?: string;
  systemKind?: "info" | "error" | "warning";
  timestamp: number;
}

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  reasoning?: boolean;
  contextWindow?: number;
}

export interface AppState {
  entries: ChatEntry[];
  isStreaming: boolean;
  isCompacting: boolean;
  isRetrying: boolean;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage: string };
  model: { id: string; name: string; provider: string; contextWindow?: number } | null;
  thinkingLevel: ThinkingLevel | null;
  processStatus: ProcessStatus;
  images: ImageAttachment[];
  files: FileAttachment[];
  useCtrlEnterToSend: boolean;
  theme: string;
  cwd: string;
  version: string;
  extensionVersion: string;
  sessionStats: SessionStats;
  commands: CommandInfo[];
  commandsLoaded: boolean;
  availableModels: AvailableModel[];
  modelsLoaded: boolean;
  modelsRequested: boolean;
  // Track the current in-progress assistant turn
  currentTurn: AssistantTurn | null;
  // Process health state
  processHealth: ProcessHealthStatus;
  // Last exit detail for crash overlay diagnostic context
  lastExitDetail: string | null;
  lastExitCode: number | null;
  // Auto-mode progress data (null = not in auto-mode)
  autoProgress: AutoProgressData | null;
  // Timestamp of last auto_progress message (for stale-data guard)
  autoProgressLastUpdate: number;
  // Widget data from setWidget events (keyed by widget key)
  widgetData: Map<string, string[]>;
  // Skills loaded in this session (detected from read tool calls to SKILL.md files)
  loadedSkills: Set<string>;
}

/** Tool categorization for icons & color accents */
export type ToolCategory = "file" | "shell" | "browser" | "search" | "agent" | "process" | "generic";

// ============================================================
// Entry cap — maximum number of entries kept in state/DOM
// ============================================================

export const MAX_ENTRIES = MAX_ENTRIES_CONST;

/** Running total of entries pruned during this session (for the indicator) */
let totalPrunedCount = 0;

/**
 * Enforce the entry cap by removing oldest entries from both state and DOM.
 * Adjusts container.scrollTop to preserve the user's visual scroll position.
 * Returns the number of entries pruned (0 if under cap).
 */
export function pruneOldEntries(container: HTMLElement): number {
  if (state.entries.length <= MAX_ENTRIES) return 0;

  const excess = state.entries.length - MAX_ENTRIES;
  const removed = state.entries.splice(0, excess);

  let totalPrunedHeight = 0;
  for (const entry of removed) {
    const el = container.querySelector(`[data-entry-id="${entry.id}"]`) as HTMLElement | null;
    if (el) {
      totalPrunedHeight += el.offsetHeight;
      el.remove();
    }
  }

  // Adjust scroll position to prevent visual jump
  container.scrollTop -= totalPrunedHeight;

  // Update running total and show/update indicator
  totalPrunedCount += excess;
  let indicator = container.querySelector(".gsd-pruned-indicator") as HTMLElement | null;
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "gsd-pruned-indicator";
    container.insertBefore(indicator, container.firstChild);
  }
  indicator.textContent = `${totalPrunedCount} earlier messages removed to improve performance`;

  console.warn(`GSD: Pruned ${excess} oldest entries to maintain ${MAX_ENTRIES}-entry cap`);
  return excess;
}

/** Reset the pruned-entries count and remove the indicator. Call on session switch. */
export function resetPrunedCount(): void {
  totalPrunedCount = 0;
  document.querySelector(".gsd-pruned-indicator")?.remove();
}

// ============================================================
// Shared mutable state
// ============================================================

export const state: AppState = {
  entries: [],
  isStreaming: false,
  isCompacting: false,
  isRetrying: false,
  model: null,
  thinkingLevel: null,
  processStatus: "stopped",
  images: [],
  files: [],
  useCtrlEnterToSend: false,
  theme: "forge",
  cwd: "",
  version: "",
  extensionVersion: "",
  sessionStats: {},
  commands: [],
  commandsLoaded: false,
  availableModels: [],
  modelsLoaded: false,
  modelsRequested: false,
  currentTurn: null,
  processHealth: "responsive",
  lastExitDetail: null,
  lastExitCode: null,
  autoProgress: null,
  autoProgressLastUpdate: 0,
  widgetData: new Map(),
  loadedSkills: new Set(),
};

// ============================================================
// ID generation
// ============================================================

let entryIdCounter = 0;

export function nextId(): string {
  return `e-${++entryIdCounter}`;
}

/**
 * Reset all shared mutable state to initial values.
 * Intended for test isolation — call between test cases to prevent state leakage.
 * @internal — exported for testing
 */
export function resetState(): void {
  state.entries = [];
  state.isStreaming = false;
  state.isCompacting = false;
  state.isRetrying = false;
  state.retryInfo = undefined;
  state.model = null;
  state.thinkingLevel = null;
  state.processStatus = "stopped";
  state.images = [];
  state.files = [];
  state.useCtrlEnterToSend = false;
  state.theme = "forge";
  state.cwd = "";
  state.version = "";
  state.extensionVersion = "";
  state.sessionStats = {};
  state.commands = [];
  state.commandsLoaded = false;
  state.availableModels = [];
  state.modelsLoaded = false;
  state.modelsRequested = false;
  state.currentTurn = null;
  state.processHealth = "responsive";
  state.lastExitDetail = null;
  state.lastExitCode = null;
  state.autoProgress = null;
  state.autoProgressLastUpdate = 0;
  state.widgetData.clear();
  state.loadedSkills.clear();
  entryIdCounter = 0;
  resetPrunedCount();
}
