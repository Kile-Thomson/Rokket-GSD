// ── RPC & Process Lifecycle ──

export const MAX_STDOUT_BUFFER_BYTES = 10 * 1_024 * 1_024;
export const MAX_STDERR_BUFFER_BYTES = 2_048;
export const RPC_DEFAULT_TIMEOUT_MS = 60_000;
export const RPC_COMPACT_TIMEOUT_MS = 300_000;
export const RPC_INIT_TIMEOUT_MS = 3_000;
export const RPC_PING_TIMEOUT_MS = 10_000;
export const EXEC_TIMEOUT_MS = 5_000;
export const STOP_SIGTERM_DELAY_MS = 1_000;
export const STOP_FORCE_KILL_DELAY_MS = 5_000;
export const STOP_POST_KILL_SETTLE_MS = 500;

// ── Watchdogs ──

export const PROMPT_WATCHDOG_TIMEOUT_MS = 8_000;
export const SLASH_WATCHDOG_TIMEOUT_MS = 10_000;
export const ACTIVITY_CHECK_INTERVAL_MS = 30_000;
export const ACTIVITY_PING_TIMEOUT_MS = 15_000;
export const ABORT_SETTLE_DELAY_MS = 3_000;
export const ABORT_RETRY_DELAY_MS = 150;
export const ABORT_MAX_ATTEMPTS = 5;
export const COMMAND_FALLBACK_DELAY_MS = 500;

// ── Polling Intervals ──

export const STATS_POLL_INTERVAL_MS = 5_000;
export const HEALTH_CHECK_INTERVAL_MS = 30_000;
export const HEALTH_PING_TIMEOUT_MS = 10_000;
export const WORKFLOW_POLL_INTERVAL_MS = 30_000;
export const AUTO_PROGRESS_POLL_INTERVAL_MS = 3_000;
export const WORKFLOW_PROGRESS_POLL_INTERVAL_MS = 2_000;
/**
 * How often the proactive workflow filesystem watcher scans for run dirs.
 *
 * The watcher exists because the runtime delivers `tool_execution_start/end` for
 * a Workflow only in a single batch at turn end (verified: gsd-pi buffers tool
 * events and serializes them after the turn resolves), so the RPC-driven poller
 * can't render live. The watcher reads the on-disk journal directly — which IS
 * written live — independent of any RPC event. A 1s cadence keeps the live panel
 * responsive without hammering the disk.
 */
export const WORKFLOW_FS_WATCH_INTERVAL_MS = 1_000;
/** Grace period a completed run's live card stays up before it auto-dismisses. */
export const WORKFLOW_LIVE_DISMISS_MS = 6_000;
/**
 * A run is surfaced live only if its journal showed activity within this window
 * of the watcher starting. Without this, every old completed run on disk (one
 * per past workflow, across all prior conversations) would flood the panel at
 * session start. Mid-flight runs at startup have a fresh journal mtime and pass.
 */
export const WORKFLOW_FS_STARTUP_GRACE_MS = 15_000;
export const UPDATE_CHECK_INTERVAL_MS = 3_600_000;
export const BUDGET_CEILING_TTL_MS = 30_000;

// ── Budget & Thresholds ──

export const BUDGET_ALERT_PERCENT = 80;
export const STALE_WORKER_THRESHOLD_MS = 30_000;
/** Workflow run is flagged "stalled" when its journal stops growing for this long. */
export const STALE_WORKFLOW_THRESHOLD_MS = 45_000;
/** Hard cap on how long a single workflow run is polled before the poller gives up. */
export const WORKFLOW_POLL_MAX_RUNTIME_MS = 60 * 60_000;
export const MIN_NODE_MAJOR_VERSION = 18;
/**
 * A running Agent (subagent) block gains a "long-running" visual cue once its
 * elapsed wall-clock time passes this threshold. This is purely an elapsed-time
 * affordance to draw the eye to slow subagents — it is NOT stall detection. The
 * runtime emits no cost/token/progress events while a subagent runs (verified:
 * scripts/capture-subagent-events.mjs), so the extension cannot distinguish a
 * hung subagent from a working one; only wall-clock time is observable.
 */
export const AGENT_LONG_RUNNING_MS = 120_000;

// ── Display & Rendering ──

export const MAX_OUTPUT_LEN = 8_000;
export const MAX_ENTRIES = 300;
export const SHORT_TEXT_THRESHOLD = 200;
export const TURN_COALESCE_WINDOW_MS = 30_000;
export const STALE_ECHO_WINDOW_MS = 1_500;
export const TASK_PREVIEW_MAX_CHARS = 120;
export const MAX_IMAGE_DIMENSION = 1_568;
export const TOKEN_THRESHOLD_K = 1_000;
export const TOKEN_THRESHOLD_10K = 10_000;
export const TOKEN_THRESHOLD_M = 1_000_000;
export const TOKEN_THRESHOLD_10M = 10_000_000;
export const RELATIVE_TIME_5S_MS = 5_000;
export const RELATIVE_TIME_1M_MS = 60_000;
export const RELATIVE_TIME_1H_MS = 3_600_000;
export const RELATIVE_TIME_1D_MS = 86_400_000;

// ── UI Animation & Toasts ──

// Must match CSS transition-duration values in webview styles
export const CSS_ANIMATION_SETTLE_MS = 300;
export const TOAST_DEFAULT_DURATION_MS = 2_500;
export const TOAST_SHORT_DURATION_MS = 3_000;
export const TOAST_MEDIUM_DURATION_MS = 4_000;
export const TOAST_LONG_DURATION_MS = 5_000;
export const COPY_BUTTON_RESET_MS = 1_500;
export const DELAYED_STATE_REFRESH_MS = 500;
export const SEND_DEBOUNCE_MS = 300;
export const NOTE_AUTO_DISMISS_MS = 4_000;
export const STALE_ECHO_DEBOUNCE_MS = 1_000;
