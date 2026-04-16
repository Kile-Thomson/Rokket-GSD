import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks — must precede all imports from the module under test ──

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: "/mock/cwd" } }] },
  extensions: { getExtension: () => ({ packageJSON: { version: "0.0.1-test" } }) },
  window: { showWarningMessage: vi.fn() },
  env: { openExternal: vi.fn() },
  Uri: { parse: (s: string) => s },
}));

vi.mock("./session-list-service", () => ({
  listSessions: vi.fn().mockResolvedValue([]),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  validateSessionPath: vi.fn(),
}));

vi.mock("./update-checker", () => ({
  downloadAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
  dismissUpdateVersion: vi.fn().mockResolvedValue(undefined),
  fetchRecentReleases: vi.fn().mockResolvedValue([]),
}));

vi.mock("./dashboard-parser", () => ({
  buildDashboardData: vi.fn().mockResolvedValue(null),
}));

vi.mock("./metrics-parser", () => ({
  loadMetricsLedger: vi.fn().mockResolvedValue(null),
  buildMetricsData: vi.fn().mockReturnValue(null),
}));

vi.mock("./watchdogs", () => ({
  startPromptWatchdog: vi.fn(),
  clearPromptWatchdog: vi.fn(),
  startSlashCommandWatchdog: vi.fn(),
  stopActivityMonitor: vi.fn(),
  abortAndPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./command-fallback", () => ({
  armGsdFallbackProbe: vi.fn(),
  startGsdFallbackTimer: vi.fn(),
}));

vi.mock("node:fs", () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./file-ops", () => ({
  handleOpenFile: vi.fn(),
  handleOpenDiff: vi.fn(),
  handleOpenUrl: vi.fn(),
  handleExportHtml: vi.fn().mockResolvedValue(undefined),
  handleSaveTempFile: vi.fn(),
  handleCheckFileAccess: vi.fn().mockResolvedValue(undefined),
  handleAttachFiles: vi.fn().mockResolvedValue(undefined),
  handleCopyText: vi.fn().mockResolvedValue(undefined),
  handleSetTheme: vi.fn().mockResolvedValue(undefined),
}));

import { handleWebviewMessage, type MessageDispatchContext } from "./message-dispatch";
import type { SessionState } from "./session-state";
import type { WebviewToExtensionMessage } from "../shared/types";

// ── Helpers ─────────────────────────────────────────────────────────────

function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    isRunning: true,
    pid: 12345,
    prompt: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(true),
    forceKill: vi.fn(),
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
    getMessages: vi.fn().mockResolvedValue({ messages: [{ role: "user", text: "hello" }] }),
    getCommands: vi.fn().mockResolvedValue({ commands: [{ name: "/test" }] }),
    getAvailableModels: vi.fn().mockResolvedValue({ models: [] }),
    getSessionStats: vi.fn().mockResolvedValue({ cost: 0.01, tokens: { input: 100, output: 200, cacheRead: 0, cacheWrite: 0, total: 300 } }),
    newSession: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn().mockResolvedValue(null),
    setModel: vi.fn().mockResolvedValue(undefined),
    setThinkingLevel: vi.fn().mockResolvedValue(undefined),
    setAutoRetry: vi.fn().mockResolvedValue(undefined),
    abortRetry: vi.fn().mockResolvedValue(undefined),
    setAutoCompaction: vi.fn().mockResolvedValue(undefined),
    setSteeringMode: vi.fn().mockResolvedValue(undefined),
    setFollowUpMode: vi.fn().mockResolvedValue(undefined),
    setSessionName: vi.fn().mockResolvedValue(undefined),
    cycleThinkingLevel: vi.fn().mockResolvedValue({ level: "medium" }),
    compact: vi.fn().mockResolvedValue(undefined),
    executeBash: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }),
    sendExtensionUiResponse: vi.fn(),
    ...overrides,
  };
}

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

function createMockDispatchContext(
  session?: SessionState,
): { ctx: MessageDispatchContext; session: SessionState; webview: any } {
  const sess = session ?? createMockSession();
  const webview = { postMessage: vi.fn() } as any;

  const ctx: MessageDispatchContext = {
    getSession: vi.fn(() => sess),
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
      getSession: vi.fn(() => sess),
      postToWebview: vi.fn(),
      output: { appendLine: vi.fn() } as any,
      emitStatus: vi.fn(),
      nextPromptWatchdogNonce: vi.fn(() => 1),
    },
    commandFallbackCtx: {
      getSession: vi.fn(() => sess),
      postToWebview: vi.fn(),
      output: { appendLine: vi.fn() } as any,
    } as any,
    fileOpsCtx: {
      postToWebview: vi.fn(),
      output: { appendLine: vi.fn() } as any,
      ensureTempDir: vi.fn(() => "/tmp/test"),
    },
  };

  return { ctx, session: sess, webview };
}

const SESSION_ID = "test-session-1";

// ── Tests ───────────────────────────────────────────────────────────────

describe("message-dispatch: handleWebviewMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── new_conversation ────────────────────────────────────────────────

  describe("new_conversation", () => {
    it("aborts streaming before new session when isStreaming=true", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: true });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "new_conversation" });

      expect(client.abort).toHaveBeenCalled();
      expect(client.newSession).toHaveBeenCalled();
    });

    it("does NOT call abort when not streaming", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: false });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "new_conversation" });

      expect(client.abort).not.toHaveBeenCalled();
      expect(client.newSession).toHaveBeenCalled();
    });

    it("resets accumulatedCost and refreshes state after new session", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, accumulatedCost: 10 });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "new_conversation" });

      expect(session.accumulatedCost).toBe(0);
      expect(ctx.emitStatus).toHaveBeenCalledWith({ cost: 0 });
      expect(client.getState).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "state" }),
      );
    });

    it("calls cleanupTempFiles on new conversation", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "new_conversation" });

      expect(ctx.cleanupTempFiles).toHaveBeenCalled();
    });

    it("clears watchdog timers when aborting streaming", async () => {
      const promptTimer = setTimeout(() => {}, 99999);
      const slashTimer = setTimeout(() => {}, 99999);
      const fallbackTimer = setTimeout(() => {}, 99999);
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        isStreaming: true,
        promptWatchdog: { timer: promptTimer, retried: false, nonce: 1, message: "test" },
        slashWatchdog: slashTimer,
        gsdFallbackTimer: fallbackTimer,
      });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "new_conversation" });

      expect(session.promptWatchdog).toBeNull();
      expect(session.slashWatchdog).toBeNull();
      expect(session.gsdFallbackTimer).toBeNull();
    });
  });

  // ── switch_session ──────────────────────────────────────────────────

  describe("switch_session", () => {
    it("aborts streaming before session switch when isStreaming=true", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: true });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/other.jsonl",
      } as WebviewToExtensionMessage);

      expect(client.abort).toHaveBeenCalled();
      expect(client.switchSession).toHaveBeenCalledWith("/sessions/other.jsonl");
    });

    it("does NOT abort when not streaming", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: false });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/other.jsonl",
      } as WebviewToExtensionMessage);

      expect(client.abort).not.toHaveBeenCalled();
      expect(client.switchSession).toHaveBeenCalled();
    });

    it("posts session_switched with state and messages after switch", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/other.jsonl",
      } as WebviewToExtensionMessage);

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "session_switched" }),
      );
    });

    it("respects cancelled switch result", async () => {
      const client = createMockClient({
        switchSession: vi.fn().mockResolvedValue({ cancelled: true }),
      });
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/other.jsonl",
      } as WebviewToExtensionMessage);

      expect(ctx.postToWebview).not.toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "session_switched" }),
      );
    });

    it("posts error when switchSession throws", async () => {
      const client = createMockClient({
        switchSession: vi.fn().mockRejectedValue(new Error("switch boom")),
      });
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/bad.jsonl",
      } as WebviewToExtensionMessage);

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error", message: expect.stringContaining("switch boom") }),
      );
    });
  });

  // ── ready ───────────────────────────────────────────────────────────

  describe("ready", () => {
    it("posts config message with theme, ctrl-enter, cwd, versions", async () => {
      const session = createMockSession();
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "ready" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({
          type: "config",
          useCtrlEnterToSend: false,
          theme: "dark",
        }),
      );
      expect(ctx.checkWhatsNew).toHaveBeenCalledWith(webview);
    });
  });

  // ── rename_session ──────────────────────────────────────────────────

  describe("rename_session", () => {
    it("calls client.setSessionName", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "rename_session",
        name: "New Name",
      } as WebviewToExtensionMessage);

      expect(client.setSessionName).toHaveBeenCalledWith("New Name");
    });
  });

  // ── force_kill ──────────────────────────────────────────────────────

  describe("force_kill", () => {
    it("calls client.forceKill()", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "force_kill" });

      expect(client.forceKill).toHaveBeenCalled();
    });
  });

  // ── top-level error handler ─────────────────────────────────────────

  describe("error handling", () => {
    it("catches unhandled errors and posts error message with errorId", async () => {
      const session = createMockSession();
      const { ctx, webview } = createMockDispatchContext(session);

      let callCount = 0;
      ctx.output = {
        appendLine: vi.fn(() => {
          callCount++;
          if (callCount === 1) { throw new Error("output crash"); }
        }),
      } as any;

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "ready" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("Internal error"),
        }),
      );
    });
  });

  // ── delete_session ──────────────────────────────────────────────────

  describe("delete_session", () => {
    it("deletes session and refreshes list", async () => {
      const { listSessions, deleteSession } = await import("./session-list-service");
      (listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
        { path: "/sessions/s1", id: "s1", name: "Session 1", firstMessage: "hi", created: new Date(), modified: new Date(), messageCount: 5 },
      ]);

      const { ctx, webview } = createMockDispatchContext();

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "delete_session",
        path: "/sessions/old",
      } as WebviewToExtensionMessage);

      expect(deleteSession).toHaveBeenCalledWith("/sessions/old");
      const listCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "session_list"
      );
      expect(listCalls.length).toBe(1);
    });

    it("posts error when delete fails", async () => {
      const { deleteSession } = await import("./session-list-service");
      (deleteSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ENOENT"));

      const { ctx, webview } = createMockDispatchContext();

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "delete_session",
        path: "/sessions/missing",
      } as WebviewToExtensionMessage);

      const errorCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "error"
      );
      expect(errorCalls.length).toBe(1);
    });
  });
});
