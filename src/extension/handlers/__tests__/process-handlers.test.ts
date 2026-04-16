import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: "/mock/cwd" } }] },
  extensions: { getExtension: () => ({ packageJSON: { version: "0.0.1-test" } }) },
  window: { showWarningMessage: vi.fn() },
  env: { openExternal: vi.fn() },
  Uri: { parse: (s: string) => s },
}));

vi.mock("../../update-checker", () => ({
  downloadAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
  dismissUpdateVersion: vi.fn().mockResolvedValue(undefined),
}));

import * as vscode from "vscode";
import {
  handleReady,
  handleLaunchGsd,
  handleForceKill,
  handleForceRestart,
  handleShutdown,
  handleRunBash,
  handleUpdateInstall,
  handleUpdateDismiss,
  handleUpdateViewRelease,
  handleExtensionUiResponse,
} from "../process-handlers";
import { downloadAndInstallUpdate, dismissUpdateVersion } from "../../update-checker";
import type { MessageDispatchContext } from "../../message-dispatch";

function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    isRunning: true,
    pid: 12345,
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
    executeBash: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }),
    sendExtensionUiResponse: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
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
    watchdogCtx: {} as any,
    commandFallbackCtx: {} as any,
    fileOpsCtx: {} as any,
  };

  return { ctx, webview };
}

const SESSION_ID = "test-session-1";

describe("process-handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe("handleReady", () => {
    it("posts config message with theme, ctrl-enter, cwd, versions", async () => {
      const { ctx, webview } = createMockCtx();
      await handleReady(ctx, webview, SESSION_ID, { type: "ready" });

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({
          type: "config",
          useCtrlEnterToSend: false,
          theme: "dark",
          version: "1.0.0-test",
        }),
      );
      expect(ctx.checkWhatsNew).toHaveBeenCalledWith(webview);
    });
  });

  describe("handleLaunchGsd", () => {
    it("launches GSD when no existing client", async () => {
      const { ctx, webview } = createMockCtx();
      await handleLaunchGsd(ctx, webview, SESSION_ID, { type: "launch_gsd" });
      expect(ctx.launchGsd).toHaveBeenCalledWith(webview, SESSION_ID, undefined);
    });

    it("skips launch when client already running", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);
      await handleLaunchGsd(ctx, webview, SESSION_ID, { type: "launch_gsd" });
      expect(ctx.launchGsd).not.toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "process_status", status: "running" }),
      );
    });

    it("passes cwd to launchGsd", async () => {
      const { ctx, webview } = createMockCtx();
      await handleLaunchGsd(ctx, webview, SESSION_ID, { type: "launch_gsd", cwd: "/custom" });
      expect(ctx.launchGsd).toHaveBeenCalledWith(webview, SESSION_ID, "/custom");
    });
  });

  describe("handleForceKill", () => {
    it("calls client.forceKill()", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);
      await handleForceKill(ctx, webview, SESSION_ID, { type: "force_kill" });
      expect(client.forceKill).toHaveBeenCalled();
    });

    it("does nothing when no client", async () => {
      const { ctx, webview } = createMockCtx();
      await handleForceKill(ctx, webview, SESSION_ID, { type: "force_kill" });
    });
  });

  describe("handleForceRestart", () => {
    it("kills and re-launches after delay", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);
      await handleForceRestart(ctx, webview, SESSION_ID, { type: "force_restart" });

      expect(client.forceKill).toHaveBeenCalled();
      expect(ctx.cleanupSession).toHaveBeenCalledWith(SESSION_ID);

      await vi.advanceTimersByTimeAsync(1000);
      expect(ctx.launchGsd).toHaveBeenCalledWith(webview, SESSION_ID);
    });

    it("skips when already restarting", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);
      (ctx.getSession as any).mockReturnValue({
        client,
        isRestarting: true,
      });
      await handleForceRestart(ctx, webview, SESSION_ID, { type: "force_restart" });
      expect(client.forceKill).not.toHaveBeenCalled();
    });
  });

  describe("handleShutdown", () => {
    it("calls client.shutdown()", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);
      await handleShutdown(ctx, webview, SESSION_ID, { type: "shutdown" });
      expect(client.shutdown).toHaveBeenCalled();
    });

    it("falls back to stop() on shutdown failure", async () => {
      const client = createMockClient({
        shutdown: vi.fn().mockRejectedValue(new Error("shutdown err")),
      });
      const { ctx, webview } = createMockCtx(client);
      await handleShutdown(ctx, webview, SESSION_ID, { type: "shutdown" });
      expect(client.stop).toHaveBeenCalled();
    });

    it("does nothing when client not running", async () => {
      const client = createMockClient({ isRunning: false });
      const { ctx, webview } = createMockCtx(client);
      await handleShutdown(ctx, webview, SESSION_ID, { type: "shutdown" });
      expect(client.shutdown).not.toHaveBeenCalled();
    });
  });

  describe("handleRunBash", () => {
    it("executes bash command and posts result", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);
      await handleRunBash(ctx, webview, SESSION_ID, { type: "run_bash", command: "echo hello" });
      expect(client.executeBash).toHaveBeenCalledWith("echo hello");
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "bash_result" }),
      );
    });

    it("warns on destructive commands", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);
      (vscode.window.showWarningMessage as any).mockResolvedValue(undefined);

      await handleRunBash(ctx, webview, SESSION_ID, { type: "run_bash", command: "rm -rf /tmp" });

      expect(vscode.window.showWarningMessage).toHaveBeenCalled();
      expect(client.executeBash).not.toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({
          type: "bash_result",
          result: expect.objectContaining({ stderr: "Cancelled by user" }),
        }),
      );
    });

    it("runs destructive command when user confirms", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);
      (vscode.window.showWarningMessage as any).mockResolvedValue("Run Anyway");

      await handleRunBash(ctx, webview, SESSION_ID, { type: "run_bash", command: "rm -rf /tmp" });
      expect(client.executeBash).toHaveBeenCalledWith("rm -rf /tmp");
    });

    it("does nothing when client not running", async () => {
      const client = createMockClient({ isRunning: false });
      const { ctx, webview } = createMockCtx(client);
      await handleRunBash(ctx, webview, SESSION_ID, { type: "run_bash", command: "echo hello" });
      expect(client.executeBash).not.toHaveBeenCalled();
    });
  });

  describe("handleUpdateInstall", () => {
    it("calls downloadAndInstallUpdate for GitHub URLs", async () => {
      const { ctx, webview } = createMockCtx();
      await handleUpdateInstall(ctx, webview, SESSION_ID, {
        type: "update_install",
        downloadUrl: "https://api.github.com/repos/test/releases/assets/123",
      });
      expect(downloadAndInstallUpdate).toHaveBeenCalled();
    });

    it("blocks non-GitHub URLs", async () => {
      const { ctx, webview } = createMockCtx();
      await handleUpdateInstall(ctx, webview, SESSION_ID, {
        type: "update_install",
        downloadUrl: "https://evil.com/malware.vsix",
      });
      expect(downloadAndInstallUpdate).not.toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        webview,
        expect.objectContaining({ type: "error" }),
      );
    });
  });

  describe("handleUpdateDismiss", () => {
    it("calls dismissUpdateVersion", async () => {
      const { ctx, webview } = createMockCtx();
      await handleUpdateDismiss(ctx, webview, SESSION_ID, {
        type: "update_dismiss",
        version: "1.2.3",
      });
      expect(dismissUpdateVersion).toHaveBeenCalledWith("1.2.3", ctx.extensionContext);
    });
  });

  describe("handleUpdateViewRelease", () => {
    it("opens release URL externally", async () => {
      const { ctx, webview } = createMockCtx();
      await handleUpdateViewRelease(ctx, webview, SESSION_ID, {
        type: "update_view_release",
        htmlUrl: "https://github.com/test/releases/tag/v1.0.0",
      });
      expect(vscode.env.openExternal).toHaveBeenCalled();
    });

    it("blocks non-http URLs", async () => {
      const { ctx, webview } = createMockCtx();
      await handleUpdateViewRelease(ctx, webview, SESSION_ID, {
        type: "update_view_release",
        htmlUrl: "file:///etc/passwd",
      });
      expect(vscode.env.openExternal).not.toHaveBeenCalled();
    });
  });

  describe("handleExtensionUiResponse", () => {
    it("sends response to client", async () => {
      const client = createMockClient();
      const { ctx, webview } = createMockCtx(client);
      await handleExtensionUiResponse(ctx, webview, SESSION_ID, {
        type: "extension_ui_response",
        id: "test-id",
        value: "yes",
        confirmed: true,
      });
      expect(client.sendExtensionUiResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "extension_ui_response",
          id: "test-id",
          value: "yes",
          confirmed: true,
        }),
      );
    });

    it("does nothing when no client", async () => {
      const { ctx, webview } = createMockCtx();
      await handleExtensionUiResponse(ctx, webview, SESSION_ID, {
        type: "extension_ui_response",
        id: "test-id",
      });
    });
  });
});
