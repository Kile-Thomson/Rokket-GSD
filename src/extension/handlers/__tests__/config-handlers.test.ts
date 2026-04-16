import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: "/mock/cwd" } }] },
  extensions: { getExtension: () => ({ packageJSON: { version: "0.0.1-test" } }) },
  window: { showWarningMessage: vi.fn() },
  env: { openExternal: vi.fn() },
  Uri: { parse: (s: string) => s },
}));

vi.mock("../../dashboard-parser", () => ({
  buildDashboardData: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../metrics-parser", () => ({
  loadMetricsLedger: vi.fn().mockResolvedValue(null),
  buildMetricsData: vi.fn().mockReturnValue(null),
}));

import {
  handleSetModel,
  handleSetThinkingLevel,
  handleCycleThinkingLevel,
  handleCompactContext,
  handleSetAutoCompaction,
  handleSetAutoRetry,
  handleAbortRetry,
  handleSetSteeringMode,
  handleSetFollowUpMode,
} from "../config-handlers";
import type { MessageDispatchContext } from "../../message-dispatch";

function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    isRunning: true,
    pid: 12345,
    setModel: vi.fn().mockResolvedValue(undefined),
    setThinkingLevel: vi.fn().mockResolvedValue(undefined),
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
    cycleThinkingLevel: vi.fn().mockResolvedValue({ level: "medium" }),
    compact: vi.fn().mockResolvedValue(undefined),
    setAutoCompaction: vi.fn().mockResolvedValue(undefined),
    setAutoRetry: vi.fn().mockResolvedValue(undefined),
    abortRetry: vi.fn().mockResolvedValue(undefined),
    setSteeringMode: vi.fn().mockResolvedValue(undefined),
    setFollowUpMode: vi.fn().mockResolvedValue(undefined),
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

describe("config-handlers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleSetModel", () => {
    it("calls client.setModel with provider and modelId", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleSetModel(ctx, webview, SID, { type: "set_model", provider: "anthropic", modelId: "claude-3-opus" });

      expect(client.setModel).toHaveBeenCalledWith("anthropic", "claude-3-opus");
    });

    it("posts error when setModel throws", async () => {
      const client = createMockClient({
        setModel: vi.fn().mockRejectedValue(new Error("model not found")),
      });
      const { ctx, webview } = createMockCtx(client);

      await handleSetModel(ctx, webview, SID, { type: "set_model", provider: "anthropic", modelId: "bad-model" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error", message: "model not found" }),
      );
    });
  });

  describe("handleSetThinkingLevel", () => {
    it("calls client.setThinkingLevel and sends confirmed level from getState", async () => {
      const client = createMockClient();
      client.getState.mockResolvedValueOnce({
        model: { id: "test-model" },
        thinkingLevel: "high",
        isStreaming: false,
        isCompacting: false,
        sessionFile: null,
        sessionId: "s-new",
        messageCount: 0,
        autoCompactionEnabled: false,
      });
      const { ctx, webview } = createMockCtx(client);

      await handleSetThinkingLevel(ctx, webview, SID, { type: "set_thinking_level", level: "high" } as any);

      expect(client.setThinkingLevel).toHaveBeenCalledWith("high");
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "thinking_level_changed", level: "high" }),
      );
    });
  });

  describe("handleCycleThinkingLevel", () => {
    it("calls cycleThinkingLevel and refreshes state", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleCycleThinkingLevel(ctx, webview, SID, { type: "cycle_thinking_level" });

      expect(client.cycleThinkingLevel).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "thinking_level_changed", level: "medium" }),
      );
      expect(client.getState).toHaveBeenCalled();
    });
  });

  describe("handleCompactContext", () => {
    it("posts auto_compaction_start, calls compact, then posts end", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleCompactContext(ctx, webview, SID, { type: "compact_context" });

      const calls = (ctx.postToWebview as any).mock.calls.map((c: any) => c[1].type);
      expect(calls).toContain("auto_compaction_start");
      expect(calls).toContain("auto_compaction_end");
      expect(client.compact).toHaveBeenCalled();
    });

    it("posts compaction end with aborted=true when compact throws", async () => {
      const client = createMockClient({
        compact: vi.fn().mockRejectedValue(new Error("compact fail")),
      });
      const { ctx, webview } = createMockCtx(client);

      await handleCompactContext(ctx, webview, SID, { type: "compact_context" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "auto_compaction_end", aborted: true }),
      );
    });
  });

  describe("handleSetAutoCompaction", () => {
    it("calls client.setAutoCompaction", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleSetAutoCompaction(ctx, webview, SID, { type: "set_auto_compaction", enabled: true });

      expect(client.setAutoCompaction).toHaveBeenCalledWith(true);
    });
  });

  describe("handleSetAutoRetry", () => {
    it("calls client.setAutoRetry(true) when enabled", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleSetAutoRetry(ctx, webview, SID, { type: "set_auto_retry", enabled: true });

      expect(client.setAutoRetry).toHaveBeenCalledWith(true);
    });

    it("calls client.setAutoRetry(false) when disabled", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleSetAutoRetry(ctx, webview, SID, { type: "set_auto_retry", enabled: false });

      expect(client.setAutoRetry).toHaveBeenCalledWith(false);
    });

    it("posts error when setAutoRetry throws", async () => {
      const client = createMockClient({
        setAutoRetry: vi.fn().mockRejectedValue(new Error("retry err")),
      });
      const { ctx, webview } = createMockCtx(client);

      await handleSetAutoRetry(ctx, webview, SID, { type: "set_auto_retry", enabled: true });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error", message: "retry err" }),
      );
    });
  });

  describe("handleAbortRetry", () => {
    it("calls client.abortRetry()", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleAbortRetry(ctx, webview, SID, { type: "abort_retry" });

      expect(client.abortRetry).toHaveBeenCalled();
    });
  });

  describe("handleSetSteeringMode", () => {
    it("calls client.setSteeringMode", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleSetSteeringMode(ctx, webview, SID, { type: "set_steering_mode", mode: "one-at-a-time" });

      expect(client.setSteeringMode).toHaveBeenCalledWith("one-at-a-time");
    });
  });

  describe("handleSetFollowUpMode", () => {
    it("calls client.setFollowUpMode", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);

      await handleSetFollowUpMode(ctx, webview, SID, { type: "set_follow_up_mode", mode: "all" });

      expect(client.setFollowUpMode).toHaveBeenCalledWith("all");
    });
  });
});
