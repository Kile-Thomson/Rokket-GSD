import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: "/mock/cwd" } }] },
  extensions: { getExtension: () => ({ packageJSON: { version: "0.0.1-test" } }) },
  window: { showWarningMessage: vi.fn() },
  env: { openExternal: vi.fn() },
  Uri: { parse: (s: string) => s },
}));

vi.mock("../../update-checker", () => ({
  fetchRecentReleases: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../dashboard-parser", () => ({
  buildDashboardData: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../metrics-parser", () => ({
  loadMetricsLedger: vi.fn().mockResolvedValue(null),
  buildMetricsData: vi.fn().mockReturnValue(null),
}));

import {
  handleGetState,
  handleGetSessionStats,
  handleGetCommands,
  handleGetAvailableModels,
  handleGetDashboard,
  handleGetChangelog,
} from "../query-handlers";
import type { MessageDispatchContext } from "../../message-dispatch";

function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    isRunning: true,
    pid: 12345,
    getState: vi.fn().mockResolvedValue({
      model: { id: "test-model" },
      thinkingLevel: "off",
      isStreaming: false,
      isCompacting: false,
      sessionFile: null,
      sessionId: "s-new",
      messageCount: 0,
      autoCompactionEnabled: false,
    }),
    getSessionStats: vi.fn().mockResolvedValue({ cost: 0.01, tokens: { input: 100, output: 200, cacheRead: 0, cacheWrite: 0, total: 300 } }),
    getCommands: vi.fn().mockResolvedValue({ commands: [{ name: "/test" }] }),
    getAvailableModels: vi.fn().mockResolvedValue({ models: [] }),
    ...overrides,
  };
}

function createMockCtx(client: any = null): { ctx: MessageDispatchContext; webview: any } {
  const session = {
    client,
    webview: null,
    panel: null,
    statsTimer: null,
    healthTimer: null,
    workflowTimer: null,
    activityTimer: null,
    promptWatchdog: null,
    slashWatchdog: null,
    gsdFallbackTimer: null,
    healthState: "responsive" as const,
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
  };
  const webview = { postMessage: vi.fn() } as any;
  const ctx: MessageDispatchContext = {
    getSession: vi.fn(() => session),
    postToWebview: vi.fn(),
    output: { appendLine: vi.fn() } as any,
    emitStatus: vi.fn(),
    launchGsd: vi.fn().mockResolvedValue(undefined),
    applySessionCostFloor: vi.fn(),
    extensionContext: { globalState: { get: vi.fn(), update: vi.fn() } } as any,
    gsdVersion: "1.0.0-test",
    getUseCtrlEnter: vi.fn(() => false),
    getTheme: vi.fn(() => "dark"),
    checkWhatsNew: vi.fn().mockResolvedValue(undefined),
    cleanupTempFiles: vi.fn(),
    cleanupSession: vi.fn(),
    watchdogCtx: {
      getSession: vi.fn(() => session),
      postToWebview: vi.fn(),
      output: { appendLine: vi.fn() } as any,
      emitStatus: vi.fn(),
      nextPromptWatchdogNonce: vi.fn(() => 1),
    },
    commandFallbackCtx: {
      getSession: vi.fn(() => session),
      postToWebview: vi.fn(),
      output: { appendLine: vi.fn() } as any,
    } as any,
    fileOpsCtx: {
      postToWebview: vi.fn(),
      output: { appendLine: vi.fn() } as any,
      ensureTempDir: vi.fn(() => "/tmp/test"),
    },
  };
  return { ctx, webview };
}

const SID = "test-session-1";

describe("query-handlers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleGetState", () => {
    it("fetches state from client and posts it to webview", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleGetState(ctx, webview, SID, { type: "get_state" });

      expect(client.getState).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "state" }),
      );
    });

    it("posts error when getState throws", async () => {
      const client = createMockClient({
        getState: vi.fn().mockRejectedValue(new Error("state err")),
      });
      const { ctx, webview } = createMockCtx(client);

      await handleGetState(ctx, webview, SID, { type: "get_state" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error" }),
      );
    });
  });

  describe("handleGetSessionStats", () => {
    it("fetches stats and posts them", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleGetSessionStats(ctx, webview, SID, { type: "get_session_stats" });

      expect(client.getSessionStats).toHaveBeenCalled();
      expect(ctx.applySessionCostFloor).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "session_stats" }),
      );
    });
  });

  describe("handleGetCommands", () => {
    it("fetches commands and posts them to webview", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleGetCommands(ctx, webview, SID, { type: "get_commands" });

      expect(client.getCommands).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "commands" }),
      );
    });

    it("sends empty commands array when getCommands errors", async () => {
      const client = createMockClient({
        getCommands: vi.fn().mockRejectedValue(new Error("rpc fail")),
      });
      const { ctx, webview } = createMockCtx(client);

      await handleGetCommands(ctx, webview, SID, { type: "get_commands" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "commands", commands: [] }),
      );
    });
  });

  describe("handleGetAvailableModels", () => {
    it("fetches models and posts them", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleGetAvailableModels(ctx, webview, SID, { type: "get_available_models" });

      expect(client.getAvailableModels).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "available_models" }),
      );
    });
  });

  describe("handleGetDashboard", () => {
    it("builds and sends dashboard data", async () => {
      const { buildDashboardData } = await import("../../dashboard-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockResolvedValue({
        hasProject: true,
        hasMilestone: true,
        slices: [{ id: "S01", done: false }],
      });

      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleGetDashboard(ctx, webview, SID, { type: "get_dashboard" });

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
      expect((dashboardCalls[0][1] as Record<string, unknown>).data).toBeTruthy();
    });

    it("merges session stats into dashboard data", async () => {
      const { buildDashboardData } = await import("../../dashboard-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockResolvedValue({
        hasProject: true,
        hasMilestone: true,
        slices: [],
      });

      const client = createMockClient({
        getSessionStats: vi.fn().mockResolvedValue({
          cost: 0.42,
          tokens: { input: 500, output: 300, cacheRead: 10, cacheWrite: 5, total: 815 },
          toolCalls: 12,
          userMessages: 3,
        }),
      });
      const { ctx, webview } = createMockCtx(client);

      await handleGetDashboard(ctx, webview, SID, { type: "get_dashboard" });

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
      const data = (dashboardCalls[0][1] as any).data;
      expect(data.stats).toBeDefined();
      expect(data.stats.cost).toBe(0.42);
      expect(data.stats.toolCalls).toBe(12);
    });

    it("sends null data when buildDashboardData throws", async () => {
      const { buildDashboardData } = await import("../../dashboard-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("parse error"));

      const { ctx, webview } = createMockCtx();

      await handleGetDashboard(ctx, webview, SID, { type: "get_dashboard" });

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
      expect((dashboardCalls[0][1] as any).data).toBeNull();
    });

    it("sends dashboard data even when session stats fail", async () => {
      const { buildDashboardData } = await import("../../dashboard-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockResolvedValue({
        hasProject: true,
        hasMilestone: true,
        slices: [],
      });

      const client = createMockClient({
        getSessionStats: vi.fn().mockRejectedValue(new Error("stats unavailable")),
      });
      const { ctx, webview } = createMockCtx(client);

      await handleGetDashboard(ctx, webview, SID, { type: "get_dashboard" });

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
      expect((dashboardCalls[0][1] as any).data).toBeTruthy();
      expect((dashboardCalls[0][1] as any).data.stats).toBeUndefined();
    });

    it("merges metrics when ledger is available", async () => {
      const { buildDashboardData } = await import("../../dashboard-parser");
      const { loadMetricsLedger, buildMetricsData } = await import("../../metrics-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockResolvedValue({
        hasProject: true,
        hasMilestone: true,
        slices: [{ id: "S01", done: false }, { id: "S02", done: true }],
      });
      (loadMetricsLedger as ReturnType<typeof vi.fn>).mockResolvedValue({
        units: [{ slice: "S01", duration: 120 }],
      });
      (buildMetricsData as ReturnType<typeof vi.fn>).mockReturnValue({
        avgSliceDuration: 120,
        eta: 120,
      });

      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleGetDashboard(ctx, webview, SID, { type: "get_dashboard" });

      expect(loadMetricsLedger).toHaveBeenCalled();
      expect(buildMetricsData).toHaveBeenCalledWith(
        expect.objectContaining({ units: expect.any(Array) }),
        1,
      );
      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect((dashboardCalls[0][1] as any).data.metrics).toBeDefined();
    });

    it("sends dashboard when no client is running", async () => {
      const { buildDashboardData } = await import("../../dashboard-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockResolvedValue({
        hasProject: true,
        hasMilestone: true,
        slices: [],
      });

      const { ctx, webview } = createMockCtx(null);

      await handleGetDashboard(ctx, webview, SID, { type: "get_dashboard" });

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
      expect((dashboardCalls[0][1] as any).data.stats).toBeUndefined();
    });
  });

  describe("handleGetChangelog", () => {
    it("fetches and sends changelog entries", async () => {
      const { fetchRecentReleases } = await import("../../update-checker");
      (fetchRecentReleases as ReturnType<typeof vi.fn>).mockResolvedValue([
        { version: "1.0.0", body: "Initial release" },
      ]);

      const { ctx, webview } = createMockCtx();

      await handleGetChangelog(ctx, webview, SID, { type: "get_changelog" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "changelog" }),
      );
    });

    it("sends empty entries when fetch fails", async () => {
      const { fetchRecentReleases } = await import("../../update-checker");
      (fetchRecentReleases as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

      const { ctx, webview } = createMockCtx();

      await handleGetChangelog(ctx, webview, SID, { type: "get_changelog" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "changelog", entries: [] }),
      );
    });
  });
});
