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
  };
}

const FAKE_WEBVIEW = {} as any;

// ── Tests ───────────────────────────────────────────────────────────────

describe("polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
      const session = createMockSession({ client: client as any });
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
      const session = createMockSession({ client: client as any });
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
      const session = createMockSession({ client: client as any });
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
      const session = createMockSession({ client: client as any });
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

    it("performs initial refresh and then polls every 30s", async () => {
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

      // Initial refresh is called immediately (async)
      await vi.advanceTimersByTimeAsync(0);
      expect(parseGsdWorkflowState).toHaveBeenCalledTimes(1);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "workflow_state" }),
      );

      // Poll at 30s
      await vi.advanceTimersByTimeAsync(30_000);
      expect(parseGsdWorkflowState).toHaveBeenCalledTimes(2);
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
