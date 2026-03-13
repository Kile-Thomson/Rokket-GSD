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
  | { type: "get_session_list" }
  | { type: "switch_session"; path: string }
  | { type: "rename_session"; name: string }
  | { type: "delete_session"; path: string }
  | { type: "update_install"; downloadUrl: string }
  | { type: "update_dismiss"; version: string }
  | { type: "update_view_release"; htmlUrl: string }
  | { type: "set_auto_compaction"; enabled: boolean }
  | { type: "copy_last_response" }
  | { type: "force_kill" }
  | { type: "force_restart" };

// --- Messages FROM extension TO webview ---

export type ExtensionToWebviewMessage =
  | { type: "state"; data: GsdState }
  | { type: "session_stats"; data: SessionStats }
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: AgentMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; delta: StreamDelta }
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
  | { type: "config"; useCtrlEnterToSend: boolean; cwd?: string; version?: string }
  | { type: "process_status"; status: ProcessStatus }
  | { type: "process_health"; status: ProcessHealthStatus }
  | { type: "session_list"; sessions: SessionListItem[] }
  | { type: "session_switched"; state: GsdState; messages: AgentMessage[] }
  | { type: "session_list_error"; message: string }
  | { type: "update_available"; version: string; currentVersion: string; releaseNotes: string; downloadUrl: string; htmlUrl: string }
  | { type: "workflow_state"; state: WorkflowState | null };

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

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface GsdState {
  model: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile: string | null;
  sessionId: string | null;
  messageCount: number;
  autoCompactionEnabled: boolean;
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
