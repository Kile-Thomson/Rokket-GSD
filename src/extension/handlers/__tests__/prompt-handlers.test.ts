import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks — must precede all imports from the module under test ──

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: "/mock/cwd" } }] },
  extensions: { getExtension: () => ({ packageJSON: { version: "0.0.1-test" } }) },
  window: { showWarningMessage: vi.fn() },
  env: { openExternal: vi.fn() },
  Uri: { parse: (s: string) => s },
}));

vi.mock("../../session-list-service", () => ({
  listSessions: vi.fn().mockResolvedValue([]),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  validateSessionPath: vi.fn(),
}));

vi.mock("../../update-checker", () => ({
  downloadAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
  dismissUpdateVersion: vi.fn().mockResolvedValue(undefined),
  fetchRecentReleases: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../dashboard-parser", () => ({
  buildDashboardData: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../metrics-parser", () => ({
  loadMetricsLedger: vi.fn().mockResolvedValue(null),
  buildMetricsData: vi.fn().mockReturnValue(null),
}));

vi.mock("../../watchdogs", () => ({
  startPromptWatchdog: vi.fn(),
  clearPromptWatchdog: vi.fn(),
  startSlashCommandWatchdog: vi.fn(),
  stopActivityMonitor: vi.fn(),
  abortAndPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../command-fallback", () => ({
  armGsdFallbackProbe: vi.fn(),
  startGsdFallbackTimer: vi.fn(),
}));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockAccess = vi.fn();
const mockAppendFile = vi.fn();
vi.mock("node:fs", () => ({
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    access: (...args: unknown[]) => mockAccess(...args),
    appendFile: (...args: unknown[]) => mockAppendFile(...args),
  },
}));

vi.mock("../../file-ops", () => ({
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

import {
  handlePrompt,
  handleSteer,
  handleFollowUp,
  handleInterrupt,
  sanitizeImages,
} from "../prompt-handlers";
import type { MessageDispatchContext } from "../../message-dispatch";
import type { SessionState } from "../../session-state";

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

describe("prompt-handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReadFile.mockReset();
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockMkdir.mockReset().mockResolvedValue(undefined);
    mockAccess.mockReset().mockResolvedValue(undefined);
    mockAppendFile.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── interrupt / cancel_request ──────────────────────────────────────

  describe("handleInterrupt", () => {
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

      await handleInterrupt(ctx, webview, SESSION_ID, { type: "interrupt" } as any);

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

      await handleInterrupt(ctx, webview, SESSION_ID, { type: "interrupt" } as any);

      expect(session.isStreaming).toBe(false);
      expect(ctx.emitStatus).toHaveBeenCalledWith({ isStreaming: false });
    });
  });

  // ── prompt ──────────────────────────────────────────────────────────

  describe("handlePrompt", () => {
    it("sends prompt to running client and starts watchdog", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);
      const { startPromptWatchdog } = await import("../../watchdogs");

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "Hello world",
      } as any);

      expect(client.prompt).toHaveBeenCalledWith("Hello world", undefined);
      expect(startPromptWatchdog).toHaveBeenCalled();
    });

    it("starts slash command watchdog for / prefixed messages", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);
      const { startSlashCommandWatchdog } = await import("../../watchdogs");

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "/status",
      } as any);

      expect(startSlashCommandWatchdog).toHaveBeenCalled();
    });

    it("updates lastUserActionTime on prompt", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, lastUserActionTime: 0 });
      const { ctx, webview } = createMockDispatchContext(session);

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "test",
      } as any);

      expect(session.lastUserActionTime).toBeGreaterThan(0);
    });

    it("relaunches when client is not running and no prior client exists", async () => {
      const session = createMockSession({ client: null });
      const { ctx, webview } = createMockDispatchContext(session);

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "hello",
      } as any);

      expect(ctx.launchGsd).toHaveBeenCalledWith(webview, SESSION_ID);
    });

    it("posts error when prompt throws streaming error and falls back to steer", async () => {
      const client = createMockClient({
        prompt: vi.fn().mockRejectedValue(new Error("streaming in progress")),
        steer: vi.fn().mockResolvedValue(undefined),
      });
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "hello",
      } as any);

      expect(client.steer).toHaveBeenCalled();
    });
  });

  // ── steer ───────────────────────────────────────────────────────────

  describe("handleSteer", () => {
    it("calls client.steer for non-slash messages", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleSteer(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as any);

      expect(client.steer).toHaveBeenCalled();
    });

    it("calls abortAndPrompt for slash command steers", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);
      const { abortAndPrompt } = await import("../../watchdogs");

      await handleSteer(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "/gsd auto",
      } as any);

      expect(abortAndPrompt).toHaveBeenCalled();
    });

    it("posts error when no client is available", async () => {
      const session = createMockSession({ client: null as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleSteer(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as any);

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

      await handleSteer(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as any);

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
      mockWriteFile.mockResolvedValue(undefined);

      await handleSteer(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "Use Postgres instead of SQLite",
      } as any);

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("OVERRIDES.md"),
        expect.stringContaining("GSD Overrides"),
        expect.objectContaining({ encoding: "utf-8", flag: "wx" }),
      );
      expect(mockAppendFile).toHaveBeenCalledWith(
        expect.stringContaining("OVERRIDES.md"),
        expect.stringContaining("Use Postgres instead of SQLite"),
        "utf-8",
      );
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, { type: "steer_persisted" });
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

      await handleSteer(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as any);

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(ctx.postToWebview).not.toHaveBeenCalledWith(webview, { type: "steer_persisted" });
      expect(client.steer).toHaveBeenCalledWith("change direction", undefined);
    });

    it("appends to existing OVERRIDES.md during auto-mode (wx EEXIST is ignored)", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        autoModeState: "auto",
        lastStartOptions: { cwd: "/mock/project" },
      });
      const { ctx, webview } = createMockDispatchContext(session);
      const eexist = Object.assign(new Error("file already exists"), { code: "EEXIST" });
      mockWriteFile.mockRejectedValue(eexist);

      await handleSteer(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "No in-app messaging",
      } as any);

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockAppendFile).toHaveBeenCalledWith(
        expect.stringContaining("OVERRIDES.md"),
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
      mockAppendFile.mockRejectedValue(new Error("disk full"));

      await handleSteer(ctx, webview, SESSION_ID, {
        type: "steer",
        message: "change direction",
      } as any);

      expect(client.steer).toHaveBeenCalledWith("change direction", undefined);
    });
  });

  // ── follow_up ───────────────────────────────────────────────────────

  describe("handleFollowUp", () => {
    it("calls client.followUp and updates lastUserActionTime", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, lastUserActionTime: 0 });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleFollowUp(ctx, webview, SESSION_ID, {
        type: "follow_up",
        message: "tell me more",
      } as any);

      expect(client.followUp).toHaveBeenCalled();
      expect(session.lastUserActionTime).toBeGreaterThan(0);
    });

    it("posts error when client is null", async () => {
      const session = createMockSession({ client: null as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleFollowUp(ctx, webview, SESSION_ID, {
        type: "follow_up",
        message: "tell me more",
      } as any);

      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, {
        type: "error",
        message: expect.stringContaining("no active GSD session"),
      });
    });
  });

  // ── /gsd status triggers dashboard ─────────────────────────────────

  describe("/gsd status triggers dashboard", () => {
    it("sends dashboard_data when /gsd status is sent", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "/gsd status",
      } as any);

      expect(client.prompt).toHaveBeenCalledWith("/gsd status", undefined);
      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(1);
    });

    it("sends dashboard_data when /gsd auto mentions status", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "/gsd auto View status: Review what was built",
      } as any);

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

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "Hello, how are you?",
      } as any);

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(0);
    });

    it("does NOT send dashboard_data for /gsd auto without status keyword", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "/gsd auto Continue with the next task",
      } as any);

      const dashboardCalls = (ctx.postToWebview as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => (call[1] as Record<string, unknown>).type === "dashboard_data"
      );
      expect(dashboardCalls.length).toBe(0);
    });
  });

  // ─── Image payload sanitization ─────────────────────────────────────

  describe("sanitizeImages", () => {
    it("returns undefined for no images", () => {
      expect(sanitizeImages(undefined)).toBeUndefined();
    });

    it("filters out images with empty data or invalid MIME types", () => {
      const result = sanitizeImages([
        { data: "base64valid", mimeType: "image/png" },
        { data: "", mimeType: "image/png" },
        { data: "base64pdf", mimeType: "application/pdf" },
      ]);
      expect(result).toEqual([
        { type: "image", data: "base64valid", mimeType: "image/png" },
      ]);
    });

    it("returns undefined when all images are invalid", () => {
      const result = sanitizeImages([
        { data: "", mimeType: "image/png" },
        { data: "base64pdf", mimeType: "application/pdf" },
      ]);
      expect(result).toBeUndefined();
    });

    it("accepts all valid MIME types", () => {
      const result = sanitizeImages([
        { data: "a", mimeType: "image/jpeg" },
        { data: "b", mimeType: "image/png" },
        { data: "c", mimeType: "image/gif" },
        { data: "d", mimeType: "image/webp" },
      ]);
      expect(result).toHaveLength(4);
    });

    it("filters images on prompt path via handlePrompt", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "hello",
        images: [
          { data: "base64valid", mimeType: "image/png" },
          { data: "", mimeType: "image/png" },
          { data: "base64pdf", mimeType: "application/pdf" },
        ],
      } as any);

      expect(client.prompt).toHaveBeenCalledTimes(1);
      const passedImages = client.prompt.mock.calls[0][1];
      expect(passedImages).toEqual([
        { type: "image", data: "base64valid", mimeType: "image/png" },
      ]);
    });

    it("passes undefined when all images are invalid on prompt", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handlePrompt(ctx, webview, SESSION_ID, {
        type: "prompt",
        message: "hello",
        images: [
          { data: "", mimeType: "image/png" },
          { data: "base64pdf", mimeType: "application/pdf" },
        ],
      } as any);

      expect(client.prompt).toHaveBeenCalledTimes(1);
      const passedImages = client.prompt.mock.calls[0][1];
      expect(passedImages).toBeUndefined();
    });

    it("sanitizes images on follow_up path", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, lastUserActionTime: 0 });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleFollowUp(ctx, webview, SESSION_ID, {
        type: "follow_up",
        message: "more info",
        images: [
          { data: "validdata", mimeType: "image/webp" },
          { data: "badmime", mimeType: "text/plain" },
        ],
      } as any);

      expect(client.followUp).toHaveBeenCalledTimes(1);
      const passedImages = client.followUp.mock.calls[0][1];
      expect(passedImages).toEqual([
        { type: "image", data: "validdata", mimeType: "image/webp" },
      ]);
    });
  });
});
