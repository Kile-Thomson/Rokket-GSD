import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock vscode (minimal — rpc-events uses very little vscode API directly) ──
vi.mock("vscode", () => ({
  window: {
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showTextDocument: vi.fn().mockResolvedValue(undefined),
  },
  workspace: {
    openTextDocument: vi.fn().mockResolvedValue({ getText: vi.fn(() => "text") }),
  },
  commands: { executeCommand: vi.fn() },
  ViewColumn: { Beside: -2 },
}));

// Mock watchdogs — rpc-events imports clearPromptWatchdog, start/stopActivityMonitor
vi.mock("./watchdogs", () => ({
  clearPromptWatchdog: vi.fn(),
  startActivityMonitor: vi.fn(),
  stopActivityMonitor: vi.fn(),
}));

import { handleRpcEvent, handleExtensionUiRequest, type RpcEventContext } from "./rpc-events";
import { clearPromptWatchdog, startActivityMonitor, stopActivityMonitor } from "./watchdogs";
import type { SessionState } from "./session-state";

// ── Helpers ──────────────────────────────────────────────────────────────

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

function createCtx(session?: SessionState): {
  ctx: RpcEventContext;
  session: SessionState;
} {
  const s = session ?? createMockSession();
  return {
    session: s,
    ctx: {
      getSession: vi.fn(() => s),
      postToWebview: vi.fn(),
      emitStatus: vi.fn(),
      lastStatus: { isStreaming: false, cost: 0 },
      output: { appendLine: vi.fn() } as any,
      watchdogCtx: {
        getSession: vi.fn(() => s),
        output: { appendLine: vi.fn() } as any,
        postToWebview: vi.fn(),
        emitStatus: vi.fn(),
        nextPromptWatchdogNonce: vi.fn(() => 1),
      },
      refreshWorkflowState: vi.fn().mockResolvedValue(undefined),
      isWebviewVisible: vi.fn(() => true),
      webviewView: undefined,
    },
  };
}

const webview = {} as any;
const sid = "s1";
const client = {
  sendExtensionUiResponse: vi.fn(),
  abort: vi.fn(),
  sendPrompt: vi.fn(),
} as any;

// ── Tests ────────────────────────────────────────────────────────────────

describe("rpc-events", () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── handleRpcEvent ────────────────────────────────────────────────

  describe("handleRpcEvent", () => {
    it("updates lastEventTime on every event", () => {
      const { ctx, session } = createCtx();
      handleRpcEvent(ctx, webview, sid, { type: "some_event" }, client);
      expect(session.lastEventTime).toBeGreaterThan(0);
    });

    it("clears slashWatchdog timer on any event", () => {
      const timer = setTimeout(() => {}, 99999);
      const { ctx, session } = createCtx(createMockSession({ slashWatchdog: timer as any }));
      handleRpcEvent(ctx, webview, sid, { type: "some_event" }, client);
      expect(session.slashWatchdog).toBeNull();
    });

    it("agent_start: sets streaming + starts activity monitor + clears prompt watchdog", () => {
      const { ctx, session } = createCtx();
      handleRpcEvent(ctx, webview, sid, { type: "agent_start" }, client);
      expect(ctx.emitStatus).toHaveBeenCalledWith({ isStreaming: true });
      expect(session.isStreaming).toBe(true);
      expect(session.gsdTurnStarted).toBe(true);
      expect(clearPromptWatchdog).toHaveBeenCalled();
      expect(startActivityMonitor).toHaveBeenCalled();
    });

    it("agent_end: clears streaming + stops activity monitor + refreshes workflow", () => {
      const { ctx, session } = createCtx(createMockSession({ isStreaming: true }));
      handleRpcEvent(ctx, webview, sid, { type: "agent_end" }, client);
      expect(ctx.emitStatus).toHaveBeenCalledWith({ isStreaming: false });
      expect(session.isStreaming).toBe(false);
      expect(stopActivityMonitor).toHaveBeenCalled();
      expect(ctx.refreshWorkflowState).toHaveBeenCalled();
    });

    it("agent_end: clears gsdFallbackTimer if set", () => {
      const timer = setTimeout(() => {}, 99999);
      const { ctx, session } = createCtx(createMockSession({ gsdFallbackTimer: timer as any }));
      handleRpcEvent(ctx, webview, sid, { type: "agent_end" }, client);
      expect(session.gsdFallbackTimer).toBeNull();
    });

    it("message_end: accumulates cost from assistant usage", () => {
      const { ctx, session } = createCtx();
      session.accumulatedCost = 1.5;
      handleRpcEvent(ctx, webview, sid, {
        type: "message_end",
        message: { role: "assistant", usage: { cost: { total: 0.25 } } },
      }, client);
      expect(ctx.emitStatus).toHaveBeenCalledWith({ cost: 1.75 });
    });

    it("message_end: ignores non-assistant messages", () => {
      const { ctx } = createCtx();
      handleRpcEvent(ctx, webview, sid, {
        type: "message_end",
        message: { role: "user", usage: { cost: { total: 0.1 } } },
      }, client);
      expect(ctx.emitStatus).not.toHaveBeenCalled();
    });

    it("message_end: clears streaming state on stopReason error", () => {
      const { ctx, session } = createCtx(createMockSession({ isStreaming: true }));
      handleRpcEvent(ctx, webview, sid, {
        type: "message_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "API key invalid" },
      }, client);
      expect(session.isStreaming).toBe(false);
      expect(ctx.emitStatus).toHaveBeenCalledWith({ isStreaming: false });
      expect(stopActivityMonitor).toHaveBeenCalled();
    });

    it("message_end: does not clear streaming on normal stopReason", () => {
      const { ctx, session } = createCtx(createMockSession({ isStreaming: true }));
      handleRpcEvent(ctx, webview, sid, {
        type: "message_end",
        message: { role: "assistant", usage: { cost: { total: 0.5 } }, stopReason: "end_turn" },
      }, client);
      expect(session.isStreaming).toBe(true);
    });

    it("fallback_provider_switch: updates model in status", () => {
      const { ctx } = createCtx();
      handleRpcEvent(ctx, webview, sid, { type: "fallback_provider_switch", to: "gpt-4" }, client);
      expect(ctx.emitStatus).toHaveBeenCalledWith({ model: "gpt-4" });
    });

    it("session_shutdown: clears streaming + stops activity monitor", () => {
      const { ctx, session } = createCtx(createMockSession({ isStreaming: true }));
      handleRpcEvent(ctx, webview, sid, { type: "session_shutdown" }, client);
      expect(session.isStreaming).toBe(false);
      expect(stopActivityMonitor).toHaveBeenCalled();
    });

    it("extension_error: logs error to output", () => {
      const { ctx } = createCtx();
      handleRpcEvent(ctx, webview, sid, {
        type: "extension_error",
        extensionPath: "foo/bar",
        event: "onLoad",
        error: "boom",
      }, client);
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("Extension error"));
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("boom"));
    });

    it("forwards unknown event types to webview", () => {
      const { ctx } = createCtx();
      const event = { type: "custom_thing", data: 42 };
      handleRpcEvent(ctx, webview, sid, event, client);
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, event);
    });

    it("delegates extension_ui_request to handleExtensionUiRequest", () => {
      const { ctx } = createCtx();
      handleRpcEvent(ctx, webview, sid, {
        type: "extension_ui_request",
        id: "req1",
        method: "setWidget",
        widget: "x",
      }, client);
      // setWidget → postToWebview
      expect(ctx.postToWebview).toHaveBeenCalled();
    });
  });

  // ─── handleExtensionUiRequest ──────────────────────────────────────

  describe("handleExtensionUiRequest", () => {
    it("select/confirm/input: forwards to webview", async () => {
      const { ctx } = createCtx();
      await handleExtensionUiRequest(ctx, webview, sid, {
        type: "extension_ui_request",
        id: "r1",
        method: "confirm",
        title: "Are you sure?",
      }, client);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ method: "confirm" }),
      );
    });

    it("select/confirm/input: shows notification when webview not visible", async () => {
      const { ctx } = createCtx();
      (ctx.isWebviewVisible as any).mockReturnValue(false);
      await handleExtensionUiRequest(ctx, webview, sid, {
        type: "extension_ui_request",
        id: "r2",
        method: "select",
        title: "Pick one",
      }, client);
      const vsc = await import("vscode");
      expect(vsc.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("GSD"),
        "Open GSD",
      );
    });

    it("notify: forwards non-suppressed messages to webview", async () => {
      const { ctx } = createCtx();
      await handleExtensionUiRequest(ctx, webview, sid, {
        type: "extension_ui_request",
        id: "r3",
        method: "notify",
        message: "Build complete",
        notifyType: "info",
      }, client);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ method: "notify" }),
      );
    });

    it("notify: suppresses startup noise (API key info)", async () => {
      const { ctx } = createCtx();
      await handleExtensionUiRequest(ctx, webview, sid, {
        type: "extension_ui_request",
        id: "r4",
        method: "notify",
        message: "No OPENAI_API_KEY set",
        notifyType: "info",
      }, client);
      expect(ctx.postToWebview).not.toHaveBeenCalled();
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("suppressed"));
    });

    it("setStatus with gsd-auto: updates autoModeState + refreshes workflow + clears gsdFallbackTimer", async () => {
      const timer = setTimeout(() => {}, 99999);
      const { ctx, session } = createCtx(createMockSession({ gsdFallbackTimer: timer as any }));
      await handleExtensionUiRequest(ctx, webview, sid, {
        type: "extension_ui_request",
        id: "r5",
        method: "setStatus",
        statusKey: "gsd-auto",
        statusText: "running",
      }, client);
      expect(session.autoModeState).toBe("running");
      expect(session.gsdFallbackTimer).toBeNull();
      expect(ctx.refreshWorkflowState).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalled();
    });

    it("setWidget: forwards to webview", async () => {
      const { ctx } = createCtx();
      await handleExtensionUiRequest(ctx, webview, sid, {
        type: "extension_ui_request",
        id: "r6",
        method: "setWidget",
        widget: "progress",
      }, client);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ method: "setWidget" }),
      );
    });

    it("setTitle: updates panel title", async () => {
      const panel = { title: "", reveal: vi.fn() };
      const { ctx } = createCtx(createMockSession({ panel: panel as any }));
      await handleExtensionUiRequest(ctx, webview, sid, {
        type: "extension_ui_request",
        id: "r7",
        method: "setTitle",
        title: "My Session",
      }, client);
      expect(panel.title).toBe("My Session");
    });

    it("default: forwards unknown methods + logs", async () => {
      const { ctx } = createCtx();
      await handleExtensionUiRequest(ctx, webview, sid, {
        type: "extension_ui_request",
        id: "r8",
        method: "unknownMethod",
      }, client);
      expect(ctx.postToWebview).toHaveBeenCalled();
      expect(ctx.output.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("Unknown extension_ui method: unknownMethod"),
      );
    });
  });
});
