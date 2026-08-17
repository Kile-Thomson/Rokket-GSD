import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock vscode ─────────────────────────────────────────────────────────

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
  },
}));

// ── Mock state-parser ───────────────────────────────────────────────────

vi.mock("./state-parser", () => ({
  parseGsdWorkflowState: vi.fn().mockResolvedValue(null),
}));

// ── Mock fs (STATE.md mtime for gated workflow polling) ─────────────────
// The workflow poll stats .gsd/STATE.md to decide whether anything changed.
// A module-level mtime lets each test drive the gate deterministically.

let mockStateMtimeMs = 1_000;
let mockStatError: NodeJS.ErrnoException | null = null;
vi.mock("fs", () => ({
  promises: {
    stat: vi.fn(async () => {
      if (mockStatError) throw mockStatError;
      return { mtimeMs: mockStateMtimeMs };
    }),
  },
  statSync: vi.fn(() => {
    if (mockStatError) throw mockStatError;
    return { mtimeMs: mockStateMtimeMs };
  }),
}));

import {
  startStatsPolling,
  startHealthMonitoring,
  startWorkflowPolling,
  stopAllPolling,
  refreshWorkflowState,
  type PollingContext,
} from "./polling";
import type { SessionState } from "./session-state";
import { parseGsdWorkflowState } from "./state-parser";

// ── Helpers ─────────────────────────────────────────────────────────────

function createMockSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    client: null,
    webview: null,
    panel: null,
    statsTimer: null,
    healthTimer: null,
    workflowTimer: null,
    workflowStateMtimeMs: 0,
    activityTimer: null,
    promptWatchdog: null,
    slashWatchdog: null,
    gsdFallbackTimer: null,
    healthState: "responsive",
    autoModeState: null,
    gsdTurnStarted: false,
    lastEventTime: 0,
    lastAgentEndTime: 0,
    lastUserActionTime: 0,
    accumulatedCost: 0,
    isStreaming: false,
    isRestarting: false,
    autoProgressPoller: null,
    workflowProgressManager: null,
    workflowFsWatcher: null,
    launchPromise: null,
    messageHandlerDisposable: null,
    lastStartOptions: null,
    ...overrides,
  };
}

function createMockClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isRunning: true,
    getSessionStats: vi.fn().mockResolvedValue({ cost: 0.05, tokens: { total: 1000 } }),
    ping: vi.fn().mockResolvedValue(true),
    abort: vi.fn(),
    ...overrides,
  };
}

function createMockPollingContext(session: SessionState): PollingContext {
  return {
    getSession: vi.fn(() => session),
    postToWebview: vi.fn(),
    output: { appendLine: vi.fn() } as any,
    emitStatus: vi.fn(),
    applySessionCostFloor: vi.fn(),
    isWebviewVisible: vi.fn(() => true),
  };
}

const FAKE_WEBVIEW = {} as any;

// ── Tests ───────────────────────────────────────────────────────────────

describe("polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockStateMtimeMs = 1_000;
    mockStatError = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── startStatsPolling ───────────────────────────────────────────────

  describe("startStatsPolling", () => {
    it("sets statsTimer on the session", () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockPollingContext(session);

      startStatsPolling(ctx, FAKE_WEBVIEW, "s1");
      expect(session.statsTimer).not.toBeNull();
    });

    it("performs an immediate first poll", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: true });
      const ctx = createMockPollingContext(session);

      startStatsPolling(ctx, FAKE_WEBVIEW, "s1");

      // Allow the immediate async poll() to resolve
      await vi.advanceTimersByTimeAsync(0);

      expect(client.getSessionStats).toHaveBeenCalledTimes(1);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "session_stats" }),
      );
      expect(ctx.applySessionCostFloor).toHaveBeenCalled();
    });

    it("polls every 5 seconds", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: true });
      const ctx = createMockPollingContext(session);

      startStatsPolling(ctx, FAKE_WEBVIEW, "s1");

      // Immediate poll
      await vi.advanceTimersByTimeAsync(0);
      expect(client.getSessionStats).toHaveBeenCalledTimes(1);

      // First interval tick at 5s
      await vi.advanceTimersByTimeAsync(5000);
      expect(client.getSessionStats).toHaveBeenCalledTimes(2);

      // Second interval tick at 10s
      await vi.advanceTimersByTimeAsync(5000);
      expect(client.getSessionStats).toHaveBeenCalledTimes(3);
    });

    it("does not poll when client is not running", async () => {
      const client = createMockClient({ isRunning: false });
      const session = createMockSession({ client: client as any });
      const ctx = createMockPollingContext(session);

      startStatsPolling(ctx, FAKE_WEBVIEW, "s1");
      await vi.advanceTimersByTimeAsync(5000);

      expect(client.getSessionStats).not.toHaveBeenCalled();
    });

    it("silently ignores stats fetch errors", async () => {
      const client = createMockClient({
        getSessionStats: vi.fn().mockRejectedValue(new Error("connection lost")),
      });
      const session = createMockSession({ client: client as any });
      const ctx = createMockPollingContext(session);

      startStatsPolling(ctx, FAKE_WEBVIEW, "s1");
      // Should not throw
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.postToWebview).not.toHaveBeenCalled();
    });

    it("clears existing timer when called again", () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockPollingContext(session);

      startStatsPolling(ctx, FAKE_WEBVIEW, "s1");
      const firstTimer = session.statsTimer;

      startStatsPolling(ctx, FAKE_WEBVIEW, "s1");
      expect(session.statsTimer).not.toBe(firstTimer);
    });
  });

  // ── startHealthMonitoring ───────────────────────────────────────────

  describe("startHealthMonitoring", () => {
    it("sets healthTimer on the session", () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockPollingContext(session);

      startHealthMonitoring(ctx, FAKE_WEBVIEW, "s1");
      expect(session.healthTimer).not.toBeNull();
    });

    it("sets initial healthState to responsive", () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockPollingContext(session);

      startHealthMonitoring(ctx, FAKE_WEBVIEW, "s1");
      expect(session.healthState).toBe("responsive");
    });

    it("posts unresponsive status when ping fails", async () => {
      const client = createMockClient({ ping: vi.fn().mockResolvedValue(false) });
      const session = createMockSession({ client: client as any, isStreaming: true });
      const ctx = createMockPollingContext(session);

      startHealthMonitoring(ctx, FAKE_WEBVIEW, "s1");

      // First check at 30s
      await vi.advanceTimersByTimeAsync(30_000);

      expect(session.healthState).toBe("unresponsive");
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "process_health", status: "unresponsive" }),
      );
    });

    it("posts recovered status when ping succeeds after failure", async () => {
      const pingFn = vi.fn()
        .mockResolvedValueOnce(false) // first: fail
        .mockResolvedValueOnce(true); // second: recover
      const client = createMockClient({ ping: pingFn });
      const session = createMockSession({ client: client as any, isStreaming: true });
      const ctx = createMockPollingContext(session);

      startHealthMonitoring(ctx, FAKE_WEBVIEW, "s1");

      // First check: unresponsive
      await vi.advanceTimersByTimeAsync(30_000);
      expect(session.healthState).toBe("unresponsive");

      // Second check: recovered
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "process_health", status: "recovered" }),
      );
      expect(session.healthState).toBe("responsive");
    });

    it("does not check when client is not running", async () => {
      const client = createMockClient({ isRunning: false });
      const session = createMockSession({ client: client as any });
      const ctx = createMockPollingContext(session);

      startHealthMonitoring(ctx, FAKE_WEBVIEW, "s1");
      await vi.advanceTimersByTimeAsync(30_000);

      expect(client.ping).not.toHaveBeenCalled();
    });
  });

  // ── startWorkflowPolling ────────────────────────────────────────────

  describe("startWorkflowPolling", () => {
    it("sets workflowTimer on the session", () => {
      const session = createMockSession();
      const ctx = createMockPollingContext(session);

      startWorkflowPolling(ctx, FAKE_WEBVIEW, "s1");
      expect(session.workflowTimer).not.toBeNull();
    });

    it("performs initial refresh, then re-polls only when STATE.md mtime changes", async () => {
      const session = createMockSession({ autoModeState: "auto" });
      const ctx = createMockPollingContext(session);

      vi.mocked(parseGsdWorkflowState).mockResolvedValue({
        milestone: { id: "M001", title: "Setup" },
        slice: null,
        task: null,
        phase: "executing",
        autoMode: null,
      });

      startWorkflowPolling(ctx, FAKE_WEBVIEW, "s1");

      // Initial refresh is called immediately (async), unconditionally.
      await vi.advanceTimersByTimeAsync(0);
      expect(parseGsdWorkflowState).toHaveBeenCalledTimes(1);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "workflow_state" }),
      );

      // Tick with STATE.md mtime unchanged — gated poll skips the re-parse.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(parseGsdWorkflowState).toHaveBeenCalledTimes(1);

      // STATE.md changes — next tick re-parses and re-posts.
      mockStateMtimeMs = 2_000;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(parseGsdWorkflowState).toHaveBeenCalledTimes(2);
    });

    it("skips the gated poll when the webview is hidden", async () => {
      const session = createMockSession({ autoModeState: "auto" });
      const ctx = createMockPollingContext(session);
      vi.mocked(ctx.isWebviewVisible).mockReturnValue(false);

      startWorkflowPolling(ctx, FAKE_WEBVIEW, "s1");

      // Initial refresh still fires (unconditional), priming the badge.
      await vi.advanceTimersByTimeAsync(0);
      expect(parseGsdWorkflowState).toHaveBeenCalledTimes(1);

      // Even with a changed mtime, a hidden webview gets no re-post.
      mockStateMtimeMs = 5_000;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(parseGsdWorkflowState).toHaveBeenCalledTimes(1);
    });

    it("retries on the next tick when a refresh fails (mtime not cached prematurely)", async () => {
      const session = createMockSession({ autoModeState: "auto" });
      const ctx = createMockPollingContext(session);

      startWorkflowPolling(ctx, FAKE_WEBVIEW, "s1");
      await vi.advanceTimersByTimeAsync(0); // initial unconditional refresh
      vi.mocked(parseGsdWorkflowState).mockClear();

      // STATE.md changed and the refresh throws — cache must NOT advance.
      mockStateMtimeMs = 2_000;
      vi.mocked(parseGsdWorkflowState).mockRejectedValueOnce(new Error("read failed"));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(parseGsdWorkflowState).toHaveBeenCalledTimes(1);
      expect(session.workflowStateMtimeMs).not.toBe(2_000); // not cached on failure

      // Same mtime, refresh now succeeds — the retry goes through.
      vi.mocked(parseGsdWorkflowState).mockResolvedValueOnce({
        milestone: null, slice: null, task: null, phase: "executing", autoMode: null,
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(parseGsdWorkflowState).toHaveBeenCalledTimes(2);
      expect(session.workflowStateMtimeMs).toBe(2_000); // cached after success
    });

    it("logs a non-ENOENT stat error and does not cache it as unchanged", async () => {
      const session = createMockSession({ autoModeState: "auto" });
      const ctx = createMockPollingContext(session);

      startWorkflowPolling(ctx, FAKE_WEBVIEW, "s1");
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(parseGsdWorkflowState).mockClear();

      const err: NodeJS.ErrnoException = new Error("permission denied");
      err.code = "EACCES";
      mockStatError = err;
      await vi.advanceTimersByTimeAsync(30_000);

      // No refresh (stat failed), but the error is surfaced to the output channel.
      expect(parseGsdWorkflowState).not.toHaveBeenCalled();
      expect(ctx.output.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("permission denied"),
      );
    });

    it("silently ignores ENOENT (STATE.md not present yet)", async () => {
      const session = createMockSession({ autoModeState: "auto" });
      const ctx = createMockPollingContext(session);

      startWorkflowPolling(ctx, FAKE_WEBVIEW, "s1");
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(parseGsdWorkflowState).mockClear();
      vi.mocked(ctx.output.appendLine).mockClear();

      const err: NodeJS.ErrnoException = new Error("no such file");
      err.code = "ENOENT";
      mockStatError = err;
      await vi.advanceTimersByTimeAsync(30_000);

      expect(parseGsdWorkflowState).not.toHaveBeenCalled();
      expect(ctx.output.appendLine).not.toHaveBeenCalled();
    });

    it("clears existing timer when called again", () => {
      const session = createMockSession();
      const ctx = createMockPollingContext(session);

      startWorkflowPolling(ctx, FAKE_WEBVIEW, "s1");
      const firstTimer = session.workflowTimer;

      startWorkflowPolling(ctx, FAKE_WEBVIEW, "s1");
      expect(session.workflowTimer).not.toBe(firstTimer);
    });
  });

  // ── refreshWorkflowState ────────────────────────────────────────────

  describe("refreshWorkflowState", () => {
    it("posts workflow state to webview", async () => {
      const session = createMockSession();
      const ctx = createMockPollingContext(session);

      vi.mocked(parseGsdWorkflowState).mockResolvedValue({
        milestone: { id: "M001", title: "Test" },
        slice: null,
        task: null,
        phase: "planning",
        autoMode: null,
      });

      await refreshWorkflowState(ctx, FAKE_WEBVIEW, "s1");

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({
          type: "workflow_state",
          state: expect.objectContaining({ phase: "planning" }),
        }),
      );
    });

    it("sets autoMode from session state", async () => {
      const session = createMockSession({ autoModeState: "auto" });
      const ctx = createMockPollingContext(session);

      vi.mocked(parseGsdWorkflowState).mockResolvedValue({
        milestone: null,
        slice: null,
        task: null,
        phase: "executing",
        autoMode: null,
      });

      await refreshWorkflowState(ctx, FAKE_WEBVIEW, "s1");

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({
          type: "workflow_state",
          state: expect.objectContaining({ autoMode: "auto" }),
        }),
      );
    });

    it("posts null state when parser returns null", async () => {
      const session = createMockSession();
      const ctx = createMockPollingContext(session);

      vi.mocked(parseGsdWorkflowState).mockResolvedValue(null);

      await refreshWorkflowState(ctx, FAKE_WEBVIEW, "s1");

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "workflow_state", state: null }),
      );
    });
  });

  // ── stopAllPolling ──────────────────────────────────────────────────

  describe("stopAllPolling", () => {
    it("clears all three timers", () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockPollingContext(session);

      // Start all polling
      startStatsPolling(ctx, FAKE_WEBVIEW, "s1");
      startHealthMonitoring(ctx, FAKE_WEBVIEW, "s1");
      startWorkflowPolling(ctx, FAKE_WEBVIEW, "s1");

      expect(session.statsTimer).not.toBeNull();
      expect(session.healthTimer).not.toBeNull();
      expect(session.workflowTimer).not.toBeNull();

      stopAllPolling(ctx, "s1");

      expect(session.statsTimer).toBeNull();
      expect(session.healthTimer).toBeNull();
      expect(session.workflowTimer).toBeNull();
    });

    it("resets healthState to responsive", () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, healthState: "unresponsive" });
      const ctx = createMockPollingContext(session);

      stopAllPolling(ctx, "s1");
      expect(session.healthState).toBe("responsive");
    });

    it("is safe to call when no timers are running", () => {
      const session = createMockSession();
      const ctx = createMockPollingContext(session);

      // Should not throw
      stopAllPolling(ctx, "s1");
      expect(session.statsTimer).toBeNull();
      expect(session.healthTimer).toBeNull();
      expect(session.workflowTimer).toBeNull();
    });
  });
});
