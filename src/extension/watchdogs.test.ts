import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock vscode before importing the module under test
vi.mock("vscode", () => ({}));

import {
  startPromptWatchdog,
  clearPromptWatchdog,
  startSlashCommandWatchdog,
  startActivityMonitor,
  stopActivityMonitor,
  abortAndPrompt,
  type WatchdogContext,
} from "./watchdogs";
import type { SessionState } from "./session-state";

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
    prompt: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(true),
    abort: vi.fn().mockResolvedValue(undefined),
    forceKill: vi.fn(),
    ...overrides,
  };
}

function createMockContext(session: SessionState): WatchdogContext {
  let nonce = 0;
  return {
    getSession: vi.fn(() => session),
    postToWebview: vi.fn(),
    output: { appendLine: vi.fn() } as any,
    emitStatus: vi.fn(),
    nextPromptWatchdogNonce: () => ++nonce,
  };
}

const FAKE_WEBVIEW = {} as any;

// ── Tests ───────────────────────────────────────────────────────────────

describe("watchdogs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Prompt Watchdog ─────────────────────────────────────────────────

  describe("startPromptWatchdog", () => {
    it("sets promptWatchdog on the session", () => {
      const session = createMockSession({ client: createMockClient() as any });
      const ctx = createMockContext(session);

      startPromptWatchdog(ctx, FAKE_WEBVIEW, "s1", "hello");
      expect(session.promptWatchdog).not.toBeNull();
      expect(session.promptWatchdog!.retried).toBe(false);
      expect(session.promptWatchdog!.message).toBe("hello");
    });

    it("retries prompt on first timeout, then errors on second timeout", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockContext(session);

      startPromptWatchdog(ctx, FAKE_WEBVIEW, "s1", "hello");

      // Advance past 8s — first timeout fires, retries prompt
      await vi.advanceTimersByTimeAsync(8000);
      expect(client.prompt).toHaveBeenCalledWith("hello", undefined);
      expect(session.promptWatchdog!.retried).toBe(true);

      // Advance past another 8s — second timeout fires, posts error
      await vi.advanceTimersByTimeAsync(8000);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "error" }),
      );
    });

    it("does nothing on timeout if client is not running", async () => {
      const client = createMockClient({ isRunning: false });
      const session = createMockSession({ client: client as any });
      const ctx = createMockContext(session);

      startPromptWatchdog(ctx, FAKE_WEBVIEW, "s1", "hello");
      await vi.advanceTimersByTimeAsync(8000);
      expect(client.prompt).not.toHaveBeenCalled();
      expect(ctx.postToWebview).not.toHaveBeenCalled();
    });

    it("nonce guard: new watchdog invalidates old one", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockContext(session);

      startPromptWatchdog(ctx, FAKE_WEBVIEW, "s1", "first");
      const firstNonce = session.promptWatchdog!.nonce;

      // Start a new watchdog — replaces the old one
      startPromptWatchdog(ctx, FAKE_WEBVIEW, "s1", "second");
      expect(session.promptWatchdog!.nonce).not.toBe(firstNonce);

      // Advance past timeout — only the second watchdog fires
      await vi.advanceTimersByTimeAsync(8000);
      expect(client.prompt).toHaveBeenCalledWith("second", undefined);
      expect(client.prompt).not.toHaveBeenCalledWith("first", undefined);
    });
  });

  describe("clearPromptWatchdog", () => {
    it("clears the watchdog timer and nulls the state", () => {
      const session = createMockSession({ client: createMockClient() as any });
      const ctx = createMockContext(session);

      startPromptWatchdog(ctx, FAKE_WEBVIEW, "s1", "hello");
      expect(session.promptWatchdog).not.toBeNull();

      clearPromptWatchdog(ctx, "s1");
      expect(session.promptWatchdog).toBeNull();
    });

    it("advancing time after clear does not trigger callback", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockContext(session);

      startPromptWatchdog(ctx, FAKE_WEBVIEW, "s1", "hello");
      clearPromptWatchdog(ctx, "s1");

      await vi.advanceTimersByTimeAsync(16000);
      expect(client.prompt).not.toHaveBeenCalled();
      expect(ctx.postToWebview).not.toHaveBeenCalled();
    });

    it("is a no-op when no watchdog exists", () => {
      const session = createMockSession();
      const ctx = createMockContext(session);
      // Should not throw
      clearPromptWatchdog(ctx, "s1");
      expect(session.promptWatchdog).toBeNull();
    });
  });

  // ── Slash Command Watchdog ──────────────────────────────────────────

  describe("startSlashCommandWatchdog", () => {
    it("sets slashWatchdog on the session", () => {
      const session = createMockSession({ client: createMockClient() as any });
      const ctx = createMockContext(session);

      startSlashCommandWatchdog(ctx, FAKE_WEBVIEW, "s1", "/status");
      expect(session.slashWatchdog).not.toBeNull();
    });

    it("retries prompt when no events arrive within 10s", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        lastEventTime: 0,
      });
      const ctx = createMockContext(session);

      startSlashCommandWatchdog(ctx, FAKE_WEBVIEW, "s1", "/status");

      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.prompt).toHaveBeenCalledWith("/status", undefined);
    });

    it("does not retry if events arrived after send", async () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockContext(session);

      startSlashCommandWatchdog(ctx, FAKE_WEBVIEW, "s1", "/status");
      // Simulate an event arriving 2s later
      session.lastEventTime = Date.now() + 2000;

      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.prompt).not.toHaveBeenCalled();
    });

    it("posts error after retry also times out with no events", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        lastEventTime: 0,
      });
      const ctx = createMockContext(session);

      startSlashCommandWatchdog(ctx, FAKE_WEBVIEW, "s1", "/status");

      // First timeout (10s) — retries
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.prompt).toHaveBeenCalled();

      // Second timeout (10s) — posts error
      await vi.advanceTimersByTimeAsync(10_000);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "error" }),
      );
    });
  });

  // ── Activity Monitor ────────────────────────────────────────────────

  describe("startActivityMonitor", () => {
    it("sets activityTimer on the session", () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        isStreaming: true,
      });
      const ctx = createMockContext(session);

      startActivityMonitor(ctx, FAKE_WEBVIEW, "s1", client as any);
      expect(session.activityTimer).not.toBeNull();
    });

    it("posts warning on first ping failure", async () => {
      const client = createMockClient({ ping: vi.fn().mockResolvedValue(false) });
      const session = createMockSession({
        client: client as any,
        isStreaming: true,
      });
      const ctx = createMockContext(session);

      startActivityMonitor(ctx, FAKE_WEBVIEW, "s1", client as any);

      // First interval fires at 30s
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("not responding"),
        }),
      );
    });

    it("aborts on two consecutive ping failures", async () => {
      const client = createMockClient({ ping: vi.fn().mockResolvedValue(false) });
      const session = createMockSession({
        client: client as any,
        isStreaming: true,
      });
      const ctx = createMockContext(session);

      startActivityMonitor(ctx, FAKE_WEBVIEW, "s1", client as any);

      // Two consecutive interval ticks
      await vi.advanceTimersByTimeAsync(30_000); // first failure — warn
      await vi.advanceTimersByTimeAsync(30_000); // second failure — abort
      expect(client.abort).toHaveBeenCalled();
    });

    it("stops monitoring when isStreaming becomes false", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        isStreaming: true,
      });
      const ctx = createMockContext(session);

      startActivityMonitor(ctx, FAKE_WEBVIEW, "s1", client as any);

      // Stop streaming before first tick
      session.isStreaming = false;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(session.activityTimer).toBeNull();
    });

    it("resets failure counter when ping succeeds after failure", async () => {
      const pingFn = vi.fn()
        .mockResolvedValueOnce(false) // first ping fails
        .mockResolvedValue(true);      // subsequent pings succeed
      const client = createMockClient({ ping: pingFn });
      const session = createMockSession({
        client: client as any,
        isStreaming: true,
      });
      const ctx = createMockContext(session);

      startActivityMonitor(ctx, FAKE_WEBVIEW, "s1", client as any);

      // First tick: failure → warn
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ctx.postToWebview).toHaveBeenCalledTimes(1);

      // Second tick: success → recovery logged, no abort
      await vi.advanceTimersByTimeAsync(30_000);
      expect(client.abort).not.toHaveBeenCalled();
      expect((ctx.output.appendLine as any).mock.calls.some(
        (c: string[]) => c[0].includes("recovered"),
      )).toBe(true);
    });
  });

  describe("stopActivityMonitor", () => {
    it("clears the interval and nulls activityTimer", () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        isStreaming: true,
      });
      const ctx = createMockContext(session);

      startActivityMonitor(ctx, FAKE_WEBVIEW, "s1", client as any);
      expect(session.activityTimer).not.toBeNull();

      stopActivityMonitor(ctx, "s1");
      expect(session.activityTimer).toBeNull();
    });

    it("is a no-op when no monitor exists", () => {
      const session = createMockSession();
      const ctx = createMockContext(session);
      stopActivityMonitor(ctx, "s1");
      expect(session.activityTimer).toBeNull();
    });
  });

  // ── Abort and Prompt ────────────────────────────────────────────────

  describe("abortAndPrompt", () => {
    it("aborts then sends prompt", async () => {
      const client = createMockClient();
      const session = createMockSession();
      const ctx = createMockContext(session);

      await abortAndPrompt(ctx, client as any, FAKE_WEBVIEW, "/test");
      expect(client.abort).toHaveBeenCalled();
      expect(client.prompt).toHaveBeenCalledWith("/test", undefined);
    });

    it("retries when prompt throws streaming error", async () => {
      const client = createMockClient({
        prompt: vi.fn()
          .mockRejectedValueOnce(new Error("still streaming"))
          .mockResolvedValueOnce(undefined),
      });
      const session = createMockSession();
      const ctx = createMockContext(session);

      const promise = abortAndPrompt(ctx, client as any, FAKE_WEBVIEW, "/test");
      // Advance timers for the retry delay (150ms)
      await vi.advanceTimersByTimeAsync(150);
      await promise;

      expect(client.prompt).toHaveBeenCalledTimes(2);
    });

    it("posts error when all retries fail with non-streaming error", async () => {
      const client = createMockClient({
        prompt: vi.fn().mockRejectedValue(new Error("connection lost")),
      });
      const session = createMockSession();
      const ctx = createMockContext(session);

      await abortAndPrompt(ctx, client as any, FAKE_WEBVIEW, "/test");
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "error", message: "connection lost" }),
      );
    });

    it("maps images with type:'image' added", async () => {
      const client = createMockClient();
      const session = createMockSession();
      const ctx = createMockContext(session);
      const imgs = [{ data: "base64data", mimeType: "image/png" }];

      await abortAndPrompt(ctx, client as any, FAKE_WEBVIEW, "/test", imgs);
      expect(client.prompt).toHaveBeenCalledWith(
        "/test",
        [{ type: "image", data: "base64data", mimeType: "image/png" }],
      );
    });
  });
});
