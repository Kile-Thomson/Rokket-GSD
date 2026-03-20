import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock vscode with workspace.workspaceFolders for handleGsdAutoFallback
vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
  },
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

import {
  GSD_COMMAND_RE,
  GSD_NATIVE_SUBCOMMANDS,
  armGsdFallbackProbe,
  startGsdFallbackTimer,
  handleGsdAutoFallback,
  type CommandFallbackContext,
} from "./command-fallback";
import type { SessionState } from "./session-state";
import * as fs from "fs";

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

function createMockClient() {
  return {
    isRunning: true,
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockContext(session: SessionState): CommandFallbackContext {
  return {
    getSession: vi.fn(() => session),
    postToWebview: vi.fn(),
    output: { appendLine: vi.fn() } as any,
  };
}

const FAKE_WEBVIEW = {} as any;

// ── Tests ───────────────────────────────────────────────────────────────

describe("command-fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── GSD_COMMAND_RE ──────────────────────────────────────────────────

  describe("GSD_COMMAND_RE", () => {
    it("matches /gsd auto", () => {
      expect(GSD_COMMAND_RE.test("/gsd auto")).toBe(true);
    });

    it("matches /gsd with trailing space (bare command)", () => {
      expect(GSD_COMMAND_RE.test("/gsd ")).toBe(true);
    });

    it("matches /gsd at end of string (bare)", () => {
      expect(GSD_COMMAND_RE.test("/gsd")).toBe(true);
    });

    it("matches /gsd with known subcommands", () => {
      const subs = [
        "auto", "next", "stop", "pause", "status", "queue", "quick", "mode", "help",
        "forensics", "doctor", "discuss", "visualize", "capture", "steer", "knowledge",
        "config", "prefs", "migrate", "remote", "changelog", "triage", "dispatch",
        "history", "undo", "skip", "cleanup", "hooks", "run-hook", "skill-health",
        "init", "setup", "inspect", "new-milestone", "parallel", "park", "unpark",
        "start", "templates", "extensions", "export", "keys", "logs",
      ];
      for (const sub of subs) {
        expect(GSD_COMMAND_RE.test(`/gsd ${sub}`)).toBe(true);
      }
    });

    it("does not match random text", () => {
      expect(GSD_COMMAND_RE.test("hello world")).toBe(false);
    });

    it("does not match gsd without slash", () => {
      expect(GSD_COMMAND_RE.test("gsd auto")).toBe(false);
    });
  });

  // ── GSD_NATIVE_SUBCOMMANDS ─────────────────────────────────────────

  describe("GSD_NATIVE_SUBCOMMANDS", () => {
    it("matches native subcommands", () => {
      const native = ["auto", "stop", "pause", "next", "status", "steer", "remote", "prefs", "parallel", "park", "unpark"];
      for (const sub of native) {
        expect(GSD_NATIVE_SUBCOMMANDS.test(`/gsd ${sub}`)).toBe(true);
      }
    });

    it("does not match non-native subcommands", () => {
      expect(GSD_NATIVE_SUBCOMMANDS.test("/gsd queue")).toBe(false);
      expect(GSD_NATIVE_SUBCOMMANDS.test("/gsd quick")).toBe(false);
      expect(GSD_NATIVE_SUBCOMMANDS.test("/gsd forensics")).toBe(false);
    });
  });

  // ── armGsdFallbackProbe ─────────────────────────────────────────────

  describe("armGsdFallbackProbe", () => {
    it("resets gsdTurnStarted to false for /gsd commands", () => {
      const session = createMockSession({ gsdTurnStarted: true });
      const ctx = createMockContext(session);

      armGsdFallbackProbe(ctx, "/gsd auto", "s1", FAKE_WEBVIEW);
      expect(session.gsdTurnStarted).toBe(false);
    });

    it("clears existing fallback timer", () => {
      const existingTimer = setTimeout(() => {}, 1000);
      const session = createMockSession({ gsdFallbackTimer: existingTimer });
      const ctx = createMockContext(session);

      armGsdFallbackProbe(ctx, "/gsd auto", "s1", FAKE_WEBVIEW);
      expect(session.gsdFallbackTimer).toBeNull();
    });

    it("does nothing for non-gsd commands", () => {
      const session = createMockSession({ gsdTurnStarted: true });
      const ctx = createMockContext(session);

      armGsdFallbackProbe(ctx, "hello world", "s1", FAKE_WEBVIEW);
      expect(session.gsdTurnStarted).toBe(true); // unchanged
    });
  });

  // ── startGsdFallbackTimer ───────────────────────────────────────────

  describe("startGsdFallbackTimer", () => {
    it("sets gsdFallbackTimer on the session for non-native /gsd commands", () => {
      const client = createMockClient();
      const session = createMockSession({ client: client as any });
      const ctx = createMockContext(session);

      startGsdFallbackTimer(ctx, "/gsd queue", "s1", FAKE_WEBVIEW);
      expect(session.gsdFallbackTimer).not.toBeNull();
    });

    it("does not set timer for native subcommands", () => {
      const session = createMockSession();
      const ctx = createMockContext(session);

      startGsdFallbackTimer(ctx, "/gsd auto", "s1", FAKE_WEBVIEW);
      expect(session.gsdFallbackTimer).toBeNull();
    });

    it("does not set timer for non-gsd commands", () => {
      const session = createMockSession();
      const ctx = createMockContext(session);

      startGsdFallbackTimer(ctx, "hello world", "s1", FAKE_WEBVIEW);
      expect(session.gsdFallbackTimer).toBeNull();
    });

    it("triggers fallback when gsdTurnStarted is false after 500ms", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        gsdTurnStarted: false,
      });
      const ctx = createMockContext(session);

      // Mock fs.readFileSync to throw (no STATE.md)
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      startGsdFallbackTimer(ctx, "/gsd queue", "s1", FAKE_WEBVIEW);

      await vi.advanceTimersByTimeAsync(500);
      // Should have called client.prompt with a fallback prompt
      expect(client.prompt).toHaveBeenCalled();
    });

    it("does not trigger fallback when gsdTurnStarted becomes true", async () => {
      const client = createMockClient();
      const session = createMockSession({
        client: client as any,
        gsdTurnStarted: false,
      });
      const ctx = createMockContext(session);

      startGsdFallbackTimer(ctx, "/gsd queue", "s1", FAKE_WEBVIEW);

      // Simulate agent_start arriving before timeout
      session.gsdTurnStarted = true;

      await vi.advanceTimersByTimeAsync(500);
      expect(client.prompt).not.toHaveBeenCalled();
    });
  });

  // ── handleGsdAutoFallback ───────────────────────────────────────────

  describe("handleGsdAutoFallback", () => {
    it("sends fallback prompt and notification to webview", async () => {
      const client = createMockClient();
      const session = createMockSession();
      const ctx = createMockContext(session);

      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      await handleGsdAutoFallback(ctx, client as any, FAKE_WEBVIEW, "s1", "/gsd queue");

      // Should post notification
      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({ type: "extension_ui_request" }),
      );
      // Should send fallback prompt
      expect(client.prompt).toHaveBeenCalled();
    });

    it("includes STATE.md content in prompt when available", async () => {
      const client = createMockClient();
      const session = createMockSession();
      const ctx = createMockContext(session);

      vi.mocked(fs.readFileSync).mockReturnValue("## Current State\nActive milestone: M001");

      await handleGsdAutoFallback(ctx, client as any, FAKE_WEBVIEW, "s1", "/gsd status");

      const promptArg = client.prompt.mock.calls[0][0] as string;
      expect(promptArg).toContain("M001");
    });

    it("posts error when client.prompt throws", async () => {
      const client = createMockClient();
      client.prompt.mockRejectedValue(new Error("connection failed"));
      const session = createMockSession();
      const ctx = createMockContext(session);

      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      await handleGsdAutoFallback(ctx, client as any, FAKE_WEBVIEW, "s1", "/gsd auto");

      expect(ctx.postToWebview).toHaveBeenCalledWith(
        FAKE_WEBVIEW,
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("couldn't complete"),
        }),
      );
    });

    it("handles different subcommands with unique prompts", async () => {
      const subcommands = [
        "auto", "status", "queue", "quick", "help", "forensics", "doctor", "mode",
        "changelog", "triage", "dispatch", "history", "undo", "skip", "cleanup",
        "hooks", "run-hook", "skill-health", "init", "setup", "inspect",
        "new-milestone", "start", "templates", "extensions", "export", "logs", "keys",
      ];
      for (const sub of subcommands) {
        const client = createMockClient();
        const session = createMockSession();
        const ctx = createMockContext(session);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("ENOENT");
        });

        await handleGsdAutoFallback(ctx, client as any, FAKE_WEBVIEW, "s1", `/gsd ${sub}`);
        expect(client.prompt).toHaveBeenCalledTimes(1);
      }
    });
  });
});
