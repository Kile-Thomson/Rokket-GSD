import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: "/mock/cwd" } }] },
}));

const mockListSessions = vi.fn().mockResolvedValue([]);
const mockDeleteSession = vi.fn().mockResolvedValue(undefined);
const mockValidateSessionPath = vi.fn();
vi.mock("../../session-list-service", () => ({
  listSessions: (...args: unknown[]) => mockListSessions(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
  validateSessionPath: (...args: unknown[]) => mockValidateSessionPath(...args),
}));

import {
  handleNewConversation,
  handleGetSessionList,
  handleSwitchSession,
  handleRenameSession,
  handleDeleteSession,
  handleResumeLastSession,
} from "../session-handlers";
import type { MessageDispatchContext } from "../../message-dispatch";
import type { SessionState } from "../../session-state";

function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    isRunning: true,
    abort: vi.fn().mockResolvedValue(undefined),
    newSession: vi.fn().mockResolvedValue(undefined),
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
    switchSession: vi.fn().mockResolvedValue(null),
    setSessionName: vi.fn().mockResolvedValue(undefined),
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

describe("session-handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockListSessions.mockReset().mockResolvedValue([]);
    mockDeleteSession.mockReset().mockResolvedValue(undefined);
    mockValidateSessionPath.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── new_conversation ────────────────────────────────────────────────

  describe("handleNewConversation", () => {
    it("aborts streaming before new session when isStreaming=true", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: true });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleNewConversation(ctx, webview, SESSION_ID, { type: "new_conversation" });

      expect(client.abort).toHaveBeenCalled();
      expect(client.newSession).toHaveBeenCalled();
    });

    it("does NOT call abort when not streaming", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: false });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleNewConversation(ctx, webview, SESSION_ID, { type: "new_conversation" });

      expect(client.abort).not.toHaveBeenCalled();
      expect(client.newSession).toHaveBeenCalled();
    });

    it("resets accumulatedCost and refreshes state after new session", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, accumulatedCost: 10 });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleNewConversation(ctx, webview, SESSION_ID, { type: "new_conversation" });

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

      await handleNewConversation(ctx, webview, SESSION_ID, { type: "new_conversation" });

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

      await handleNewConversation(ctx, webview, SESSION_ID, { type: "new_conversation" });

      expect(session.promptWatchdog).toBeNull();
      expect(session.slashWatchdog).toBeNull();
      expect(session.gsdFallbackTimer).toBeNull();
    });
  });

  // ── switch_session ──────────────────────────────────────────────────

  describe("handleSwitchSession", () => {
    it("aborts streaming before session switch when isStreaming=true", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: true });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleSwitchSession(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/other.jsonl",
      } as any);

      expect(client.abort).toHaveBeenCalled();
      expect(client.switchSession).toHaveBeenCalledWith("/sessions/other.jsonl");
    });

    it("does NOT abort when not streaming", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any, isStreaming: false });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleSwitchSession(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/other.jsonl",
      } as any);

      expect(client.abort).not.toHaveBeenCalled();
      expect(client.switchSession).toHaveBeenCalled();
    });

    it("posts session_switched with state and messages after switch", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleSwitchSession(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/other.jsonl",
      } as any);

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

      await handleSwitchSession(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/other.jsonl",
      } as any);

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

      await handleSwitchSession(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/bad.jsonl",
      } as any);

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error", message: expect.stringContaining("switch boom") }),
      );
    });

    it("validates session path before switching", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleSwitchSession(ctx, webview, SESSION_ID, {
        type: "switch_session",
        path: "/sessions/other.jsonl",
      } as any);

      expect(mockValidateSessionPath).toHaveBeenCalledWith("/sessions/other.jsonl");
    });
  });

  // ── rename_session ──────────────────────────────────────────────────

  describe("handleRenameSession", () => {
    it("calls client.setSessionName", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleRenameSession(ctx, webview, SESSION_ID, {
        type: "rename_session",
        name: "New Name",
      } as any);

      expect(client.setSessionName).toHaveBeenCalledWith("New Name");
    });
  });

  // ── get_session_list ────────────────────────────────────────────────

  describe("handleGetSessionList", () => {
    it("lists sessions and posts session_list", async () => {
      mockListSessions.mockResolvedValue([
        { path: "/s/1", id: "s1", name: "S1", firstMessage: "hi", created: new Date("2025-01-01"), modified: new Date("2025-01-02"), messageCount: 3 },
      ]);
      const { ctx, webview } = createMockDispatchContext();

      await handleGetSessionList(ctx, webview, SESSION_ID, { type: "get_session_list" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "session_list" }),
      );
    });

    it("posts session_list_error when listSessions throws", async () => {
      mockListSessions.mockRejectedValue(new Error("list fail"));
      const { ctx, webview } = createMockDispatchContext();

      await handleGetSessionList(ctx, webview, SESSION_ID, { type: "get_session_list" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "session_list_error" }),
      );
    });
  });

  // ── delete_session ──────────────────────────────────────────────────

  describe("handleDeleteSession", () => {
    it("deletes session and refreshes list", async () => {
      mockListSessions.mockResolvedValue([
        { path: "/s/1", id: "s1", name: "S1", firstMessage: "hi", created: new Date(), modified: new Date(), messageCount: 5 },
      ]);
      const { ctx, webview } = createMockDispatchContext();

      await handleDeleteSession(ctx, webview, SESSION_ID, {
        type: "delete_session",
        path: "/sessions/old",
      } as any);

      expect(mockDeleteSession).toHaveBeenCalledWith("/sessions/old");
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "session_list" }),
      );
    });

    it("posts error when delete fails", async () => {
      mockDeleteSession.mockRejectedValue(new Error("ENOENT"));
      const { ctx, webview } = createMockDispatchContext();

      await handleDeleteSession(ctx, webview, SESSION_ID, {
        type: "delete_session",
        path: "/sessions/missing",
      } as any);

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error" }),
      );
    });
  });

  // ── resume_last_session ─────────────────────────────────────────────

  describe("handleResumeLastSession", () => {
    it("resumes the most recent session", async () => {
      mockListSessions.mockResolvedValue([
        { path: "/s/latest", id: "s-latest", name: "Latest", firstMessage: "hey", created: new Date(), modified: new Date(), messageCount: 10 },
      ]);
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleResumeLastSession(ctx, webview, SESSION_ID, { type: "resume_last_session" });

      expect(client.switchSession).toHaveBeenCalledWith("/s/latest");
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "session_switched" }),
      );
    });

    it("posts error when no sessions exist", async () => {
      mockListSessions.mockResolvedValue([]);
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleResumeLastSession(ctx, webview, SESSION_ID, { type: "resume_last_session" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error", message: "No previous sessions found" }),
      );
    });

    it("handles cancelled resume", async () => {
      mockListSessions.mockResolvedValue([
        { path: "/s/latest", id: "s-latest", name: "Latest", firstMessage: "hey", created: new Date(), modified: new Date(), messageCount: 10 },
      ]);
      const client = createMockClient({
        switchSession: vi.fn().mockResolvedValue({ cancelled: true }),
      });
      const session = createMockSession({ client: client as any });
      const { ctx, webview } = createMockDispatchContext(session);

      await handleResumeLastSession(ctx, webview, SESSION_ID, { type: "resume_last_session" });

      expect(ctx.postToWebview).not.toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "session_switched" }),
      );
    });
  });
});
