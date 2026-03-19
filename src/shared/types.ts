// ============================================================
// Shared types between extension host and webview
// ============================================================

// --- Messages FROM webview TO extension ---

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
  | { type: "fork_conversation"; entryId: string }
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
  | { type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
  | { type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
  | { type: "force_kill" }
  | { type: "force_restart" }
  | { type: "check_file_access"; paths: string[] }
  | { type: "save_temp_file"; name: string; data: string; mimeType: string }
  | { type: "attach_files" }
  | { type: "get_dashboard" }
  | { type: "get_changelog" }
  | { type: "set_theme"; theme: string };

// --- Messages FROM extension TO webview ---

export type ExtensionToWebviewMessage =
  | { type: "state"; data: GsdState }
  | { type: "session_stats"; data: SessionStats }
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: AgentMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: StreamDelta }
  | { type: "message_end"; message: AgentMessage }
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
  | { type: "fallback_provider_restored"; provider: string; reason: string }
  | { type: "fallback_chain_exhausted"; reason: string }
  | { type: "session_shutdown" }
  | { type: "extension_error"; extensionPath: string; event: string; error: string };

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

export type ProcessStatus = "starting" | "running" | "crashed" | "restarting" | "stopped";

export type ProcessHealthStatus = "responsive" | "unresponsive" | "recovered";

export interface ImageAttachment {
  type: "image";
  data: string; // base64
  mimeType: string;
}

export interface FileAttachment {
  type: "file";
  path: string;
  name: string;
  extension: string;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

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
}

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

  // Legacy fields (kept for compat)
  contextUsed?: number;
  contextTotal?: number;
  totalTokensIn?: number;
  totalTokensOut?: number;
  turnCount?: number;
  duration?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
}

export interface AgentMessage {
  role: "user" | "assistant" | "toolResult" | "bashExecution";
  content: unknown;
  timestamp?: number;
  [key: string]: unknown;
}

export interface StreamDelta {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface ToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  details: Record<string, unknown>;
}

export interface CommandInfo {
  name: string;
  description?: string;
  source: string;
  location?: string;
  path?: string;
}

export interface AvailableModelInfo {
  id: string;
  name?: string;
  provider: string;
  reasoning?: boolean;
  contextWindow?: number;
}

export interface BashResult {
  stdout?: string;
  stderr?: string;
  output?: string;
  exitCode?: number;
  error?: boolean;
}

// --- RPC response types ---

export interface RpcCommandsResult {
  commands?: CommandInfo[];
}

export interface RpcModelsResult {
  models?: AvailableModelInfo[];
}

export interface RpcThinkingResult {
  level?: ThinkingLevel;
}

export interface RpcExportResult {
  path?: string;
}

export interface RpcStateResult {
  model?: ModelInfo;
  thinkingLevel?: ThinkingLevel;
  isStreaming?: boolean;
  isCompacting?: boolean;
  autoCompactionEnabled?: boolean;
  cwd?: string;
  [key: string]: unknown;
}

// --- Dashboard Data (parsed from .gsd/ project files) ---

export interface DashboardSlice {
  id: string;
  title: string;
  done: boolean;
  risk: string;
  active: boolean;
  tasks: DashboardTask[];
  taskProgress?: { done: number; total: number };
}

export interface DashboardTask {
  id: string;
  title: string;
  done: boolean;
  active: boolean;
  estimate?: string;
}

export interface MilestoneRegistryEntry {
  id: string;
  title: string;
  done: boolean;
  active: boolean;
}

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

export interface WorkflowStateRef {
  id: string;
  title: string;
}

export interface WorkflowState {
  milestone: WorkflowStateRef | null;
  slice: WorkflowStateRef | null;
  task: WorkflowStateRef | null;
  phase: string;
  autoMode: string | null;
}

// --- Parallel Worker Progress ---

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
