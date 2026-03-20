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
} from "../shared/types";

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
  details?: any;
  /** True when this tool executed concurrently with other tools */
  isParallel?: boolean;
}

/** A segment in the sequential stream — text, thinking, or tool call */
export type TurnSegment =
  | { type: "text"; chunks: string[] }
  | { type: "thinking"; chunks: string[] }
  | { type: "tool"; toolCallId: string };

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
  thinkingLevel: string;
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
  // Auto-mode progress data (null = not in auto-mode)
  autoProgress: AutoProgressData | null;
  // Timestamp of last auto_progress message (for stale-data guard)
  autoProgressLastUpdate: number;
  // Widget data from setWidget events (keyed by widget key)
  widgetData: Map<string, string[]>;
}

/** Tool categorization for icons & color accents */
export type ToolCategory = "file" | "shell" | "browser" | "search" | "agent" | "process" | "generic";

// ============================================================
// Shared mutable state
// ============================================================

export const state: AppState = {
  entries: [],
  isStreaming: false,
  isCompacting: false,
  isRetrying: false,
  model: null,
  thinkingLevel: "off",
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
  autoProgress: null,
  autoProgressLastUpdate: 0,
  widgetData: new Map(),
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
  state.thinkingLevel = "off";
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
  state.autoProgress = null;
  state.autoProgressLastUpdate = 0;
  state.widgetData.clear();
  entryIdCounter = 0;
}
