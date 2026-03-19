import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependency chains before importing the module under test
vi.mock("vscode", () => ({}));
vi.mock("./rpc-client", () => ({ GsdRpcClient: vi.fn() }));
vi.mock("./auto-progress", () => ({ AutoProgressPoller: vi.fn() }));

import { createSessionState, cleanupSessionState, type SessionState } from "./session-state";

describe("session-state", () => {
  describe("createSessionState", () => {
    it("returns object with null client", () => {
      const state = createSessionState();
      expect(state.client).toBeNull();
    });

    it("returns default values for all fields", () => {
      const state = createSessionState();
      expect(state.webview).toBeNull();
      expect(state.panel).toBeNull();
      expect(state.statsTimer).toBeNull();
      expect(state.healthTimer).toBeNull();
      expect(state.workflowTimer).toBeNull();
      expect(state.activityTimer).toBeNull();
      expect(state.promptWatchdog).toBeNull();
      expect(state.slashWatchdog).toBeNull();
      expect(state.gsdFallbackTimer).toBeNull();
      expect(state.healthState).toBe("responsive");
      expect(state.autoModeState).toBeNull();
      expect(state.gsdTurnStarted).toBe(false);
      expect(state.lastEventTime).toBe(0);
      expect(state.isStreaming).toBe(false);
      expect(state.isRestarting).toBe(false);
      expect(state.autoProgressPoller).toBeNull();
      expect(state.launchPromise).toBeNull();
      expect(state.messageHandlerDisposable).toBeNull();
      expect(state.lastStartOptions).toBeNull();
    });

    it("returns a fresh object each call (no shared references)", () => {
      const state1 = createSessionState();
      const state2 = createSessionState();
      expect(state1).not.toBe(state2);
      state1.isStreaming = true;
      expect(state2.isStreaming).toBe(false);
    });
  });

  describe("cleanupSessionState", () => {
    let state: SessionState;

    beforeEach(() => {
      state = createSessionState();
      vi.restoreAllMocks();
    });

    it("clears promptWatchdog timer if set", () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const timer = setTimeout(() => {}, 1000);
      state.promptWatchdog = { timer, retried: false, nonce: 1, message: "test" };

      cleanupSessionState(state);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
      expect(state.promptWatchdog).toBeNull();
    });

    it("clears interval timers (statsTimer, healthTimer, etc.)", () => {
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");
      state.statsTimer = setInterval(() => {}, 1000);
      state.healthTimer = setInterval(() => {}, 1000);
      state.activityTimer = setInterval(() => {}, 1000);

      cleanupSessionState(state);

      expect(clearIntervalSpy).toHaveBeenCalledTimes(3);
      expect(state.statsTimer).toBeNull();
      expect(state.healthTimer).toBeNull();
      expect(state.activityTimer).toBeNull();
    });

    it("calls client.stop() if client exists", () => {
      const mockStop = vi.fn();
      state.client = { stop: mockStop } as unknown as SessionState["client"];

      cleanupSessionState(state);

      expect(mockStop).toHaveBeenCalled();
      expect(state.client).toBeNull();
    });

    it("handles null client gracefully", () => {
      state.client = null;
      expect(() => cleanupSessionState(state)).not.toThrow();
      expect(state.client).toBeNull();
    });

    it("disposes autoProgressPoller if set", () => {
      const mockDispose = vi.fn();
      state.autoProgressPoller = { dispose: mockDispose } as unknown as SessionState["autoProgressPoller"];

      cleanupSessionState(state);

      expect(mockDispose).toHaveBeenCalled();
      expect(state.autoProgressPoller).toBeNull();
    });

    it("disposes messageHandlerDisposable if set", () => {
      const mockDispose = vi.fn();
      state.messageHandlerDisposable = { dispose: mockDispose } as unknown as SessionState["messageHandlerDisposable"];

      cleanupSessionState(state);

      expect(mockDispose).toHaveBeenCalled();
      expect(state.messageHandlerDisposable).toBeNull();
    });

    it("resets state flags to defaults", () => {
      state.healthState = "unresponsive";
      state.autoModeState = "running";
      state.gsdTurnStarted = true;
      state.lastEventTime = 12345;
      state.isStreaming = true;
      state.isRestarting = true;

      cleanupSessionState(state);

      expect(state.healthState).toBe("responsive");
      expect(state.autoModeState).toBeNull();
      expect(state.gsdTurnStarted).toBe(false);
      expect(state.lastEventTime).toBe(0);
      expect(state.isStreaming).toBe(false);
      expect(state.isRestarting).toBe(false);
    });
  });
});
