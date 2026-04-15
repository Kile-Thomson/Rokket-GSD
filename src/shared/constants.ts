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
export const UPDATE_CHECK_INTERVAL_MS = 3_600_000;
export const BUDGET_CEILING_TTL_MS = 30_000;

// ── Budget & Thresholds ──

export const BUDGET_ALERT_PERCENT = 80;
export const STALE_WORKER_THRESHOLD_MS = 30_000;
export const MIN_NODE_MAJOR_VERSION = 18;

// ── Display & Rendering ──

export const MAX_OUTPUT_LEN = 8_000;
export const MAX_ENTRIES = 300;
export const SHORT_TEXT_THRESHOLD = 200;
export const TURN_COALESCE_WINDOW_MS = 30_000;
export const PARALLEL_TIME_SAVED_THRESHOLD_MS = 500;
export const STALE_ECHO_WINDOW_MS = 1_500;
export const TASK_PREVIEW_MAX_CHARS = 120;
export const MAX_IMAGE_DIMENSION = 1_568;

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
