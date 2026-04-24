// ============================================================
// Shared types between extension host and webview
// ============================================================

// --- Messages FROM webview TO extension ---

/**
 * Union of all messages the webview can send to the extension host via `postMessage()`.
 *
 * Each variant is discriminated by the `type` field. The extension's `message-dispatch.ts`
 * routes incoming messages to handlers based on this type. Key message types include:
 * - `"prompt"` / `"steer"` / `"follow_up"` — user text input to the agent
 * - `"get_state"` / `"get_session_stats"` — state polling requests
 * - `"switch_session"` / `"new_conversation"` — session lifecycle
 * - `"set_model"` / `"set_thinking_level"` — configuration changes
 */
export type WebviewToExtensionMessage =
  | { type: "launch_gsd"; cwd?: string }
  | { type: "prompt"; message: string; images?: ImageAttachment[] }
  | { type: "steer"; message: string; images?: ImageAttachment[] }
  | { type: "follow_up"; message: string; images?: ImageAttachment[] }
  | { type: "interrupt" }
  | { type: "cancel_request" }
  | { type: "new_conversation" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: ThinkingLevel }
  | { type: "get_state" }
  | { type: "get_session_stats" }
  | { type: "get_commands" }
  | { type: "get_available_models" }
  | { type: "cycle_thinking_level" }
  | { type: "compact_context" }
  | { type: "export_html" }
  | { type: "run_bash"; command: string }
  | { type: "extension_ui_response"; id: string; value?: string; values?: string[]; confirmed?: boolean; cancelled?: boolean }
  | { type: "copy_text"; text: string }
  | { type: "open_file"; path: string }
  | { type: "open_url"; url: string }
  | { type: "open_diff"; leftPath: string; rightPath: string }
  | { type: "ready" }
  | { type: "resume_last_session" }
  | { type: "get_session_list" }
  | { type: "switch_session"; path: string }
  | { type: "rename_session"; name: string }
  | { type: "delete_session"; path: string }
  | { type: "update_install"; downloadUrl: string }
  | { type: "update_dismiss"; version: string }
  | { type: "update_view_release"; htmlUrl: string }
  | { type: "set_auto_compaction"; enabled: boolean }
  | { type: "set_auto_retry"; enabled: boolean }
  | { type: "abort_retry" }
  | { type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
  | { type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
  | { type: "force_kill" }
  | { type: "force_restart" }
  | { type: "check_file_access"; paths: string[] }
  | { type: "save_temp_file"; name: string; data: string; mimeType: string }
  | { type: "attach_files" }
  | { type: "get_dashboard" }
  | { type: "get_changelog" }
  | { type: "set_theme"; theme: string }
  | { type: "ollama_action"; action: "load" | "unload" | "pull" | "remove"; model: string }
  | { type: "telegram_sync_toggle"; forceOff?: boolean }
  | { type: "telegram_setup" }
  | { type: "shutdown" };

// --- Messages FROM extension TO webview ---

/**
 * Union of all messages the extension host can send to the webview via `panel.webview.postMessage()`.
 *
 * Each variant is discriminated by the `type` field. The webview's `message-handler.ts`
 * dispatches incoming messages to update `AppState` and trigger re-renders. Key message types:
 * - `"state"` — full GsdState snapshot (model, streaming status, session info)
 * - `"message_start"` / `"message_update"` / `"message_end"` — streaming message lifecycle
 * - `"tool_execution_start"` / `"tool_execution_end"` — tool call progress
 * - `"error"` / `"process_exit"` — error and lifecycle notifications
 * - `"session_switched"` — session change with new state + messages
 */
export type ExtensionToWebviewMessage =
  | { type: "state"; data: GsdState }
  | { type: "session_stats"; data: SessionStats | null }
  | { type: "agent_start"; isContinuation?: boolean }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: AgentMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: StreamDelta }
  | { type: "message_end"; message: AgentMessage & { stopReason?: string; errorMessage?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { total?: number } } } }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: ToolResult }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: ToolResult; isError: boolean; durationMs?: number }
  | { type: "auto_compaction_start"; reason: string }
  | { type: "auto_compaction_end"; result: unknown; aborted: boolean }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  | { type: "extension_ui_request"; id: string; method: string; title?: string; message?: string; options?: string[]; allowMultiple?: boolean; placeholder?: string; prefill?: string; timeout?: number; notifyType?: string; statusKey?: string; statusText?: string; widgetKey?: string; widgetLines?: string[]; text?: string }
  | { type: "error"; message: string }
  | { type: "process_exit"; code: number | null; signal: string | null; detail?: string }
  | { type: "commands"; commands: CommandInfo[] }
  | { type: "available_models"; models: AvailableModelInfo[] }
  | { type: "bash_result"; result: BashResult }
  | { type: "thinking_level_changed"; level: ThinkingLevel }
  | { type: "config"; useCtrlEnterToSend: boolean; theme?: string; cwd?: string; version?: string; extensionVersion?: string }
  | { type: "process_status"; status: ProcessStatus }
  | { type: "process_health"; status: ProcessHealthStatus }
  | { type: "session_list"; sessions: SessionListItem[] }
  | { type: "session_switched"; state: GsdState; messages: AgentMessage[] }
  | { type: "session_list_error"; message: string }
  | { type: "update_available"; version: string; currentVersion: string; releaseNotes: string; downloadUrl: string; htmlUrl: string }
  | { type: "workflow_state"; state: WorkflowState | null }
  | { type: "file_access_result"; results: Array<{ path: string; readable: boolean }> }
  | { type: "temp_file_saved"; path: string; name: string }
  | { type: "files_attached"; paths: string[] }
  | { type: "dashboard_data"; data: DashboardData | null }
  | { type: "whats_new"; version: string; notes: string }
  | { type: "changelog"; entries: Array<{ version: string; notes: string; date: string }> }
  | { type: "auto_progress"; data: AutoProgressData | null }
  | { type: "model_routed"; oldModel: { id: string; provider: string } | null; newModel: { id: string; provider: string } | null }
  | { type: "fallback_provider_switch"; from: string; to: string; reason: string }
  | { type: "fallback_provider_restored"; provider: string; reason: string; model?: { id: string; name?: string; provider: string; contextWindow?: number } }
  | { type: "fallback_chain_exhausted"; reason: string; lastError?: string }
  | { type: "session_shutdown" }
  | { type: "extension_error"; extensionPath: string; event: string; error: string }
  | { type: "steer_persisted" }
  | { type: "async_subagent_progress"; toolCallId: string; mode: string; results: Array<{ agent: string; agentSource?: string; task: string; step?: number; exitCode: number; status: string; stopReason?: string; errorMessage?: string; usage?: Record<string, number>; model?: string }> }
  | { type: "cost_update"; runId: string; turnCost: number; cumulativeCost: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } }
  | { type: "execution_complete"; runId: string; status: string; stats?: unknown }
  | { type: "terminal_output"; data: string }
  | { type: "telegram_user_message"; text: string; images?: ImageAttachment[] };

// --- Session List Types ---

export interface SessionListItem {
  /** Absolute path to the session JSONL file */
  path: string;
  /** Session UUID */
  id: string;
  /** User-defined display name */
  name?: string;
  /** First user message text (for preview) */
  firstMessage: string;
  /** ISO string — session creation time */
  created: string;
  /** ISO string — last activity time */
  modified: string;
  /** Total number of message entries */
  messageCount: number;
}

// --- Shared Data Types ---

/** Process lifecycle status reported by the extension's process watchdog. */
export type ProcessStatus = "starting" | "running" | "crashed" | "restarting" | "stopped";

/** Health status from the periodic ping-based health check. */
export type ProcessHealthStatus = "responsive" | "unresponsive" | "recovered";

/** A base64-encoded image attached to a user message. */
export interface ImageAttachment {
  type: "image";
  data: string; // base64
  mimeType: string;
}

/** A workspace file attached to a user message (not yet base64-encoded). */
export interface FileAttachment {
  type: "file";
  path: string;
  name: string;
  extension: string;
}

/** Thinking budget level controlling extended thinking depth. Maps to gsd-pi's thinking budget parameter. */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Core UI state sent from the extension to the webview via `{ type: "state" }` messages.
 *
 * Represents the authoritative snapshot of the current session: which model is active,
 * whether the agent is streaming, session identity, and user preferences. The webview
 * uses this to drive header displays, input state, and status indicators.
 */
export interface GsdState {
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile: string | null;
  sessionId: string | null;
  sessionName?: string;
  messageCount: number;
  pendingMessageCount?: number;
  autoCompactionEnabled: boolean;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  cwd?: string;
  /** Whether extension loading has completed (gsd-pi 2.44+). */
  extensionsReady?: boolean;
  /** Whether an auto-retry is currently in progress (gsd-pi 2.44+). */
  retryInProgress?: boolean;
  /** Current retry attempt number (gsd-pi 2.44+). */
  retryAttempt?: number;
  /** Whether auto-retry is enabled (gsd-pi 2.44+). */
  autoRetryEnabled?: boolean;
  telegramSyncActive?: boolean;
}

/**
 * Session cost, token usage, and context metrics — merged from `getSessionStats()`
 * and `getContextUsage()` RPC responses.
 *
 * The extension merges data from two RPC calls into this single structure before
 * sending it to the webview. Fields from `getContextUsage()` are prefixed with `context*`.
 * Legacy fields (`contextUsed`, `totalTokensIn`, etc.) are kept for backward compatibility.
 */
export interface SessionStats {
  // From getSessionStats() RPC response
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost?: number;

  // From getContextUsage() — merged in by the extension
  contextTokens?: number | null;
  contextWindow?: number;
  contextPercent?: number | null;
  autoCompactionEnabled?: boolean;
  autoRetryEnabled?: boolean;

  // Legacy fields (kept for compat)
  contextUsed?: number;
  contextTotal?: number;
  totalTokensIn?: number;
  totalTokensOut?: number;
  turnCount?: number;
  duration?: number;
}

/** Model identity and metadata used for display and context window calculations. */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
}

/**
 * A single conversation entry — user prompt, assistant response, tool result, or bash execution.
 *
 * The `content` field is intentionally `unknown` because its shape varies by role:
 * - `"user"`: string or array of content blocks (text + images)
 * - `"assistant"`: array of content blocks (text, thinking, tool_use)
 * - `"toolResult"`: tool execution output
 * - `"bashExecution"`: bash command + result
 */
export interface AgentMessage {
  role: "user" | "assistant" | "toolResult" | "bashExecution";
  content: unknown;
  timestamp?: number;
  [key: string]: unknown;
}

export interface TextBlock { type: "text"; text: string; [key: string]: unknown; }
export interface ToolUseBlock { type: "tool_use" | "toolCall" | "tool-use"; id: string; name: string; input?: unknown; arguments?: Record<string, unknown>; [key: string]: unknown; }
export interface ThinkingBlock { type: "thinking"; thinking: string; [key: string]: unknown; }
export type ContentBlock = TextBlock | ToolUseBlock | ThinkingBlock | { type: string; [key: string]: unknown };

/**
 * A streaming update delta received during an assistant turn.
 *
 * Emitted as `"message_update"` events during streaming. The `type` field indicates
 * the kind of delta (e.g. `"text"`, `"thinking"`, `"tool_use"`), and `delta` contains
 * the incremental text content. Tool call deltas include the `toolCall` field with
 * the tool's name and partial arguments.
 */
export interface StreamDelta {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    externalResult?: { content: unknown; details?: Record<string, unknown>; isError?: boolean };
  };
  partial?: { content?: unknown[] };
  [key: string]: unknown;
}

/** Tool execution output — an array of content blocks (text, images, etc.) with metadata. */
export interface ToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  details: Record<string, unknown>;
}

/** Metadata for a slash command available in the agent. */
export interface CommandInfo {
  name: string;
  description?: string;
  source: string;
  location?: string;
  path?: string;
}

/** A model available for selection, as returned by `get_available_models` RPC. */
export interface AvailableModelInfo {
  id: string;
  name?: string;
  provider: string;
  reasoning?: boolean;
  contextWindow?: number;
}

/** Result of a `run_bash` command execution returned to the webview. */
export interface BashResult {
  stdout?: string;
  stderr?: string;
  output?: string;
  exitCode?: number;
  error?: boolean;
}

// --- RPC response types ---

/** RPC response payload for the `get_commands` method. */
export interface RpcCommandsResult {
  commands?: CommandInfo[];
}

/** RPC response payload for the `get_available_models` method. */
export interface RpcModelsResult {
  models?: AvailableModelInfo[];
}

/** RPC response payload for `cycle_thinking_level`. */
export interface RpcThinkingResult {
  level?: ThinkingLevel;
}

/**
 * Raw RPC response from `get_state` — the unstructured state payload from gsd-pi.
 *
 * This is the "loose" shape before conversion. Use `toGsdState()` to convert it
 * into the structured `GsdState` the webview expects. The index signature allows
 * for additional fields that gsd-pi may add without requiring a types.ts update.
 */
export interface RpcStateResult {
  model?: ModelInfo;
  thinkingLevel?: ThinkingLevel;
  isStreaming?: boolean;
  isCompacting?: boolean;
  autoCompactionEnabled?: boolean;
  /** Whether extension loading has completed — commands may be incomplete until true. (gsd-pi 2.44+) */
  extensionsReady?: boolean;
  /** Whether an auto-retry is currently in progress. (gsd-pi 2.44+) */
  retryInProgress?: boolean;
  /** Current retry attempt number (0-based). (gsd-pi 2.44+) */
  retryAttempt?: number;
  /** Whether auto-retry is enabled. (gsd-pi 2.44+) */
  autoRetryEnabled?: boolean;
  cwd?: string;
  [key: string]: unknown;
}

/** Convert loose RPC state to the structured GsdState the webview expects */
export function toGsdState(rpc: RpcStateResult): GsdState {
  return {
    model: rpc.model || null,
    thinkingLevel: (rpc.thinkingLevel || "off") as ThinkingLevel,
    isStreaming: rpc.isStreaming || false,
    isCompacting: rpc.isCompacting || false,
    sessionFile: (rpc.sessionFile as string) || null,
    sessionId: (rpc.sessionId as string) || null,
    sessionName: rpc.sessionName as string | undefined,
    messageCount: (rpc.messageCount as number) || 0,
    pendingMessageCount: rpc.pendingMessageCount as number | undefined,
    autoCompactionEnabled: rpc.autoCompactionEnabled || false,
    steeringMode: rpc.steeringMode as GsdState["steeringMode"],
    followUpMode: rpc.followUpMode as GsdState["followUpMode"],
    cwd: rpc.cwd,
    extensionsReady: rpc.extensionsReady as boolean | undefined,
    retryInProgress: rpc.retryInProgress as boolean | undefined,
    retryAttempt: rpc.retryAttempt as number | undefined,
    autoRetryEnabled: rpc.autoRetryEnabled as boolean | undefined,
  };
}

// --- Dashboard Data (parsed from .gsd/ project files) ---

/** A slice within a milestone, with its tasks and completion state. */
export interface DashboardSlice {
  id: string;
  title: string;
  done: boolean;
  risk: string;
  active: boolean;
  tasks: DashboardTask[];
  taskProgress?: { done: number; total: number };
}

/** A task within a slice, with completion state and optional time estimate. */
export interface DashboardTask {
  id: string;
  title: string;
  done: boolean;
  active: boolean;
  estimate?: string;
}

/** An entry in the milestone registry — tracks all milestones across the project. */
export interface MilestoneRegistryEntry {
  id: string;
  title: string;
  done: boolean;
  active: boolean;
}

/**
 * Complete dashboard payload parsed from `.gsd/` project files and sent to the webview.
 *
 * Includes milestone/slice/task hierarchy, progress counters, blockers, and
 * optionally merged session stats and per-unit metrics.
 */
export interface DashboardData {
  hasProject: boolean;
  hasMilestone: boolean;
  milestone: { id: string; title: string } | null;
  slice: { id: string; title: string } | null;
  task: { id: string; title: string } | null;
  phase: string;
  slices: DashboardSlice[];
  milestoneRegistry: MilestoneRegistryEntry[];
  progress: {
    tasks: { done: number; total: number };
    slices: { done: number; total: number };
    milestones: { done: number; total: number };
  };
  blockers: string[];
  nextAction: string | null;
  /** Session cost/usage stats — merged in by the extension at send time */
  stats?: {
    cost?: number;
    tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    toolCalls?: number;
    userMessages?: number;
  };
  /** Per-unit metrics from .gsd/metrics.json — null when file doesn't exist */
  metrics?: DashboardMetrics | null;
}

// --- Metrics data for dashboard (from metrics.json) ---

/**
 * Aggregated metrics from `.gsd/metrics.json` — cost, tokens, and duration
 * broken down by phase, slice, and model. Used for the dashboard cost projections.
 */
export interface DashboardMetrics {
  totals: {
    units: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    duration: number;
    toolCalls: number;
    assistantMessages: number;
    userMessages: number;
  };
  byPhase: Array<{
    phase: string;
    units: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    duration: number;
  }>;
  bySlice: Array<{
    sliceId: string;
    units: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    duration: number;
  }>;
  byModel: Array<{
    model: string;
    units: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
  }>;
  projection: {
    projectedRemaining: number;
    avgCostPerSlice: number;
    remainingSlices: number;
    completedSlices: number;
  } | null;
  recentUnits: Array<{
    type: string;
    id: string;
    model: string;
    startedAt: number;
    finishedAt: number;
    cost: number;
    toolCalls: number;
  }>;
  elapsedMs: number;
}

// --- Workflow State (parsed from .gsd/STATE.md) ---

/** Reference to a workflow entity (milestone, slice, or task) by ID and title. */
export interface WorkflowStateRef {
  id: string;
  title: string;
}

/** Current workflow state parsed from `.gsd/STATE.md` — active milestone, slice, task, and phase. */
export interface WorkflowState {
  milestone: WorkflowStateRef | null;
  slice: WorkflowStateRef | null;
  task: WorkflowStateRef | null;
  phase: string;
  autoMode: string | null;
}

// --- Parallel Worker Progress ---

/** Progress data for a single parallel worker process in auto-mode. */
export interface WorkerProgress {
  /** Milestone ID this worker is executing */
  id: string;
  /** Worker process PID */
  pid: number;
  /** Worker state */
  state: "running" | "paused" | "stopped" | "error";
  /** Current unit being executed (null when idle) */
  currentUnit: { type: string; id: string } | null;
  /** Number of completed units */
  completedUnits: number;
  /** Cumulative cost for this worker */
  cost: number;
  /** Budget percentage (cost / budget_ceiling * 100), null when no ceiling */
  budgetPercent: number | null;
  /** Last heartbeat epoch ms */
  lastHeartbeat: number;
  /** True when heartbeat is older than staleness threshold */
  stale: boolean;
}

// --- Auto-Mode Progress Data ---

/**
 * Live auto-mode progress data sent to the webview for the progress overlay.
 *
 * Includes the current auto-mode state, active milestone/slice/task,
 * progress counters, optional parallel worker data, and budget alerts.
 */
export interface AutoProgressData {
  /** Auto-mode state: "auto" | "next" | "paused" */
  autoState: string;
  /** Current phase label */
  phase: string;
  /** Active milestone info */
  milestone: { id: string; title: string } | null;
  /** Active slice info */
  slice: { id: string; title: string } | null;
  /** Active task info */
  task: { id: string; title: string } | null;
  /** Slice progress */
  slices: { done: number; total: number };
  /** Task progress within the active slice */
  tasks: { done: number; total: number };
  /** Milestone progress */
  milestones: { done: number; total: number };
  /** When auto-mode started (epoch ms), or when this poll was taken */
  timestamp: number;
  /** Session cost so far */
  cost?: number;
  /** Current model info */
  model?: { id: string; provider: string } | null;
  /** Number of pending captures awaiting triage */
  pendingCaptures?: number;
  /** Parallel worker progress — null when no parallel data exists */
  workers?: WorkerProgress[] | null;
  /** True when any worker's budget exceeds 80% of budget_ceiling */
  budgetAlert?: boolean;
}
