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
  TUI_ONLY_COMMAND_RE: /^\/ollama(?:\s|$)/i,
  handleTuiOnlyFallback: vi.fn(),
}));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
vi.mock("node:fs", () => ({
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
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

/** Create a mock RPC client with all methods as vi.fn() stubs. */
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

/** Create a minimal SessionState for testing. */
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

/**
 * Build a complete `MessageDispatchContext` mock.
 * Each test gets a fresh context via beforeEach — no shared mutable state.
 */
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
    mockReadFile.mockReset();
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockMkdir.mockReset().mockResolvedValue(undefined);
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

      // Should NOT post session_switched when cancelled
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

  // ── set_auto_retry / abort_retry ────────────────────────────────────

  describe("set_auto_retry", () => {
    it("calls client.setAutoRetry(true) when enabled", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "set_auto_retry",
        enabled: true,
      } as WebviewToExtensionMessage);

      expect(client.setAutoRetry).toHaveBeenCalledWith(true);
    });

    it("calls client.setAutoRetry(false) when disabled", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "set_auto_retry",
        enabled: false,
      } as WebviewToExtensionMessage);

      expect(client.setAutoRetry).toHaveBeenCalledWith(false);
    });

    it("posts error when setAutoRetry throws", async () => {
      const client = createMockClient({
        setAutoRetry: vi.fn().mockRejectedValue(new Error("retry err")),
      });
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "set_auto_retry",
        enabled: true,
      } as WebviewToExtensionMessage);

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error", message: "retry err" }),
      );
    });
  });

  describe("abort_retry", () => {
    it("calls client.abortRetry()", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "abort_retry",
      } as WebviewToExtensionMessage);

      expect(client.abortRetry).toHaveBeenCalled();
    });
  });

  // ── interrupt / cancel_request ──────────────────────────────────────

  describe("interrupt", () => {
    it("calls client.abort() and clears watchdog timers", async () => {
      const promptTimer = setTimeout(() => {}, 99999);
      const slashTimer = setTimeout(() => {}, 99999);
      const fallbackTimer = setTimeout(() => {}, 99999);
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        promptWatchdog: { timer: promptTimer, retried: false, nonce: 1, message: "test" },
        slashWatchdog: slashTimer,
        gsdFallbackTimer: fallbackTimer,
      });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "interrupt" });

      expect(client.abort).toHaveBeenCalled();
      expect(session.promptWatchdog).toBeNull();
      expect(session.slashWatchdog).toBeNull();
      expect(session.gsdFallbackTimer).toBeNull();
    });

    it("force-clears streaming state when abort throws", async () => {
      const client = createMockClient({
        abort: vi.fn().mockRejectedValue(new Error("abort failed")),
      });
      const session = createMockSession({ client: client as any, isStreaming: true, webview: {} as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "interrupt" });

      expect(session.isStreaming).toBe(false);
      expect(ctx.emitStatus).toHaveBeenCalledWith({ isStreaming: false });
    });

    it("cancel_request dispatches the same as interrupt", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "cancel_request" });

      expect(client.abort).toHaveBeenCalled();
    });
  });

  // ── set_model ───────────────────────────────────────────────────────

  describe("set_model", () => {
    it("calls client.setModel with provider and modelId", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "set_model",
        provider: "anthropic",
        modelId: "claude-3-opus",
      } as WebviewToExtensionMessage);

      expect(client.setModel).toHaveBeenCalledWith("anthropic", "claude-3-opus");
    });

    it("posts error when setModel throws", async () => {
      const client = createMockClient({
        setModel: vi.fn().mockRejectedValue(new Error("model not found")),
      });
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "set_model",
        provider: "anthropic",
        modelId: "bad-model",
      } as WebviewToExtensionMessage);

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error", message: "model not found" }),
      );
    });
  });

  // ── prompt ──────────────────────────────────────────────────────────

  describe("prompt", () => {
    it("sends prompt to running client and starts watchdog", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);
      const { startPromptWatchdog } = await import("./watchdogs");

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "Hello world",
      } as WebviewToExtensionMessage);

      expect(client.prompt).toHaveBeenCalledWith("Hello world", undefined);
      expect(startPromptWatchdog).toHaveBeenCalled();
    });

    it("starts slash command watchdog for / prefixed messages", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);
      const { startSlashCommandWatchdog } = await import("./watchdogs");

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "/status",
      } as WebviewToExtensionMessage);

      expect(startSlashCommandWatchdog).toHaveBeenCalled();
    });

    it("updates lastUserActionTime on prompt", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, lastUserActionTime: 0 });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "test",
      } as WebviewToExtensionMessage);

      expect(session.lastUserActionTime).toBeGreaterThan(0);
    });

    it("relaunches when client is not running and no prior client exists", async () => {
      const session = createMockSession({ client: null });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "hello",
      } as WebviewToExtensionMessage);

      expect(ctx.launchGsd).toHaveBeenCalledWith(webview, SESSION_ID);
    });

    it("posts error when prompt throws streaming error and falls back to steer", async () => {
      const client = createMockClient({
        prompt: vi.fn().mockRejectedValue(new Error("streaming in progress")),
        steer: vi.fn().mockResolvedValue(undefined),
      });
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "hello",
      } as WebviewToExtensionMessage);

      // Non-slash message with streaming error → falls back to steer
      expect(client.steer).toHaveBeenCalled();
    });
  });

  // ── steer ───────────────────────────────────────────────────────────

  describe("steer", () => {
    it("calls client.steer for non-slash messages", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as WebviewToExtensionMessage);

      expect(client.steer).toHaveBeenCalled();
    });

    it("calls abortAndPrompt for slash command steers", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);
      const { abortAndPrompt } = await import("./watchdogs");

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "/gsd auto",
      } as WebviewToExtensionMessage);

      expect(abortAndPrompt).toHaveBeenCalled();
    });

    it("posts error when no client is available", async () => {
      const session = createMockSession({ client: null as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as WebviewToExtensionMessage);

      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, {
        type: "error",
        message: expect.stringContaining("no active GSD session"),
      });
    });

    it("posts error with 'Steer failed' prefix when client.steer throws", async () => {
      const client = createMockClient();
      client.steer = vi.fn().mockRejectedValue(new Error("connection lost"));
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as WebviewToExtensionMessage);

      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, {
        type: "error",
        message: "Steer failed: connection lost",
      });
    });

    it("persists override to OVERRIDES.md during auto-mode and sends enhanced steer", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        autoModeState: "auto",
        lastStartOptions: { cwd: "/mock/project" },
      });
      const { ctx, webview } = createMockDispatchContext(session);
      mockReadFile.mockRejectedValue({ code: "ENOENT" });

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "Use Postgres instead of SQLite",
      } as WebviewToExtensionMessage);

      // Should write OVERRIDES.md
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("OVERRIDES.md"),
        expect.stringContaining("Use Postgres instead of SQLite"),
        "utf-8",
      );
      // Should notify webview of persistence
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, { type: "steer_persisted" });
      // Should send enhanced steer with override context
      expect(client.steer).toHaveBeenCalledWith(
        expect.stringContaining("USER OVERRIDE"),
        undefined,
      );
    });

    it("sends plain steer when not in auto-mode", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        autoModeState: null,
      });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as WebviewToExtensionMessage);

      // Should NOT write OVERRIDES.md
      expect(mockWriteFile).not.toHaveBeenCalled();
      // Should NOT notify of persistence
      expect(ctx.postToWebview).not.toHaveBeenCalledWith(webview, { type: "steer_persisted" });
      // Should send plain steer
      expect(client.steer).toHaveBeenCalledWith("change direction", undefined);
    });

    it("appends to existing OVERRIDES.md during auto-mode", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        autoModeState: "auto",
        lastStartOptions: { cwd: "/mock/project" },
      });
      const { ctx, webview } = createMockDispatchContext(session);
      mockReadFile.mockResolvedValue("# GSD Overrides\n\n---\n\n## Override: 2026-01-01\n\n**Change:** old\n");

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "No in-app messaging",
      } as WebviewToExtensionMessage);

      // Should append, not create fresh
      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("OVERRIDES.md"),
        expect.stringContaining("old"),
        "utf-8",
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("No in-app messaging"),
        "utf-8",
      );
    });

    it("still sends RPC steer even if OVERRIDES.md write fails", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        autoModeState: "auto",
        lastStartOptions: { cwd: "/mock/project" },
      });
      const { ctx, webview } = createMockDispatchContext(session);
      mockReadFile.mockRejectedValue(new Error("disk full"));

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as WebviewToExtensionMessage);

      // Override write failed, but steer should still go through
      expect(client.steer).toHaveBeenCalled();
    });
  });

  // ── get_state ───────────────────────────────────────────────────────

  describe("get_state", () => {
    it("fetches state from client and posts it to webview", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "get_state" });

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
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "get_state" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error" }),
      );
    });
  });

  // ── set_thinking_level ──────────────────────────────────────────────

  describe("set_thinking_level", () => {
    it("calls client.setThinkingLevel and sends confirmed level from getState", async () => {
      const client = createMockClient();
      // After setThinkingLevel, getState returns the confirmed level
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
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "set_thinking_level",
        level: "high",
      } as WebviewToExtensionMessage);

      expect(client.setThinkingLevel).toHaveBeenCalledWith("high");
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "thinking_level_changed", level: "high" }),
      );
      expect(client.getState).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "state" }),
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

  // ── set_auto_compaction ─────────────────────────────────────────────

  describe("set_auto_compaction", () => {
    it("calls client.setAutoCompaction", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "set_auto_compaction",
        enabled: true,
      } as WebviewToExtensionMessage);

      expect(client.setAutoCompaction).toHaveBeenCalledWith(true);
    });
  });

  // ── cycle_thinking_level ────────────────────────────────────────────

  describe("cycle_thinking_level", () => {
    it("calls cycleThinkingLevel and refreshes state", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "cycle_thinking_level" });

      expect(client.cycleThinkingLevel).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "thinking_level_changed", level: "medium" }),
      );
      expect(client.getState).toHaveBeenCalled();
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

      // The first thing the try block does is ctx.output.appendLine.
      // Make it throw only on the FIRST call (inside try) but succeed
      // on subsequent calls (inside catch).
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

  // ── follow_up ───────────────────────────────────────────────────────

  describe("follow_up", () => {
    it("calls client.followUp and updates lastUserActionTime", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, lastUserActionTime: 0 });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "follow_up",
        message: "tell me more",
      } as WebviewToExtensionMessage);

      expect(client.followUp).toHaveBeenCalled();
      expect(session.lastUserActionTime).toBeGreaterThan(0);
    });
  });

  // ── get_commands ────────────────────────────────────────────────────

  describe("get_commands", () => {
    it("fetches commands and posts them to webview", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "get_commands" });

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
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "get_commands" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "commands", commands: [] }),
      );
    });
  });

  // ── compact_context ─────────────────────────────────────────────────

  describe("compact_context", () => {
    it("posts auto_compaction_start, calls compact, then posts end", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "compact_context" });

      const calls = (ctx.postToWebview as any).mock.calls.map((c: any) => c[1].type);
      expect(calls).toContain("auto_compaction_start");
      expect(calls).toContain("auto_compaction_end");
      expect(client.compact).toHaveBeenCalled();
    });

    it("posts compaction end with aborted=true when compact throws", async () => {
      const client = createMockClient({
        compact: vi.fn().mockRejectedValue(new Error("compact fail")),
      });
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, { type: "compact_context" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "auto_compaction_end", aborted: true }),
      );
    });
  });

  // ── set_steering_mode / set_follow_up_mode ──────────────────────────

  describe("set_steering_mode", () => {
    it("calls client.setSteeringMode", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "set_steering_mode",
        mode: "one-at-a-time",
      } as WebviewToExtensionMessage);

      expect(client.setSteeringMode).toHaveBeenCalledWith("one-at-a-time");
    });
  });

  describe("set_follow_up_mode", () => {
    it("calls client.setFollowUpMode", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "set_follow_up_mode",
        mode: "all",
      } as WebviewToExtensionMessage);

      expect(client.setFollowUpMode).toHaveBeenCalledWith("all");
    });
  });

  describe("/gsd status triggers dashboard", () => {
    it("sends dashboard_data when /gsd status is sent", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "/gsd status",
      } as WebviewToExtensionMessage);

      expect(client.prompt).toHaveBeenCalledWith("/gsd status", undefined);
      // Dashboard data should also be sent
      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
    });

    it("sends dashboard_data when /gsd auto mentions status", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "/gsd auto View status: Review what was built",
      } as WebviewToExtensionMessage);

      expect(client.prompt).toHaveBeenCalled();
      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
    });

    it("does NOT send dashboard_data for normal prompts", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "Hello, how are you?",
      } as WebviewToExtensionMessage);

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(0);
    });

    it("does NOT send dashboard_data for /gsd auto without status keyword", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "/gsd auto Continue with the next task",
      } as WebviewToExtensionMessage);

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(0);
    });
  });

  describe("get_dashboard", () => {
    it("builds and sends dashboard data", async () => {
      const { buildDashboardData } = await import("./dashboard-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockResolvedValue({
        hasProject: true,
        hasMilestone: true,
        slices: [{ id: "S01", done: false }],
      });

      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "get_dashboard",
      } as WebviewToExtensionMessage);

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
      expect((dashboardCalls[0][1] as Record<string, unknown>).data).toBeTruthy();
    });

    it("merges session stats into dashboard data", async () => {
      const { buildDashboardData } = await import("./dashboard-parser");
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
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "get_dashboard",
      } as WebviewToExtensionMessage);

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
      const { buildDashboardData } = await import("./dashboard-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("parse error"));

      const { ctx, webview } = createMockDispatchContext();

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "get_dashboard",
      } as WebviewToExtensionMessage);

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
      expect((dashboardCalls[0][1] as any).data).toBeNull();
    });

    it("sends dashboard data even when session stats fail", async () => {
      const { buildDashboardData } = await import("./dashboard-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockResolvedValue({
        hasProject: true,
        hasMilestone: true,
        slices: [],
      });

      const client = createMockClient({
        getSessionStats: vi.fn().mockRejectedValue(new Error("stats unavailable")),
      });
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "get_dashboard",
      } as WebviewToExtensionMessage);

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
      expect((dashboardCalls[0][1] as any).data).toBeTruthy();
      // Stats should be absent since getSessionStats threw
      expect((dashboardCalls[0][1] as any).data.stats).toBeUndefined();
    });

    it("merges metrics when ledger is available", async () => {
      const { buildDashboardData } = await import("./dashboard-parser");
      const { loadMetricsLedger, buildMetricsData } = await import("./metrics-parser");
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
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "get_dashboard",
      } as WebviewToExtensionMessage);

      expect(loadMetricsLedger).toHaveBeenCalled();
      expect(buildMetricsData).toHaveBeenCalledWith(
        expect.objectContaining({ units: expect.any(Array) }),
        1, // 1 remaining slice (S01 not done)
      );
      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect((dashboardCalls[0][1] as any).data.metrics).toBeDefined();
    });

    it("sends dashboard when no client is running", async () => {
      const { buildDashboardData } = await import("./dashboard-parser");
      (buildDashboardData as ReturnType<typeof vi.fn>).mockResolvedValue({
        hasProject: true,
        hasMilestone: true,
        slices: [],
      });

      const session = createMockSession({ client: null });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleWebviewMessage(ctx, webview, SESSION_ID, {
        type: "get_dashboard",
      } as WebviewToExtensionMessage);

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
      // No stats since no client
      expect((dashboardCalls[0][1] as any).data.stats).toBeUndefined();
    });
  });

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
