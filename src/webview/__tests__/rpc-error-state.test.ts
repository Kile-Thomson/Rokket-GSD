// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  init as initUI,
  updateOverlayIndicators,
  type UIUpdatesDeps,
} from "../ui-updates";
import {
  init as initDashboard,
  updateWelcomeScreen,
  type DashboardDeps,
} from "../dashboard";
import { state } from "../state";

// ── Mock dependencies ────────────────────────────────────────────────

vi.mock("../dashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dashboard")>();
  return {
    ...actual,
    // keep real updateWelcomeScreen for dashboard tests below
  };
});

vi.mock("../helpers", () => ({
  escapeHtml: (s: string) => String(s ?? ""),
  formatCost: (c: number) => `$${c.toFixed(2)}`,
  formatTokens: (n: number) => `${n}`,
  scrollToBottom: vi.fn(),
  formatContextUsage: () => "",
}));

// ── Helpers ──────────────────────────────────────────────────────────

let uiDeps: UIUpdatesDeps;
let dashDeps: DashboardDeps;
let mockVscode: { postMessage: ReturnType<typeof vi.fn> };

function createUIDeps(): UIUpdatesDeps {
  mockVscode = { postMessage: vi.fn() };
  return {
    vscode: mockVscode,
    modelBadge: document.createElement("span"),
    thinkingBadge: document.createElement("span"),
    headerSep1: document.createElement("span"),
    costBadge: document.createElement("span"),
    contextBadge: document.createElement("span"),
    contextBarContainer: document.createElement("div"),
    contextBar: document.createElement("div"),
    footerCwd: document.createElement("span"),
    sendBtn: document.createElement("button"),
    sendIcon: document.createElement("span"),
    promptInput: document.createElement("textarea") as HTMLTextAreaElement,
    inputHint: document.createElement("span"),
    overlayIndicators: document.createElement("div"),
  };
}

function createDashDeps(): DashboardDeps {
  return {
    messagesContainer: document.createElement("div"),
    welcomeScreen: document.createElement("div"),
    welcomeProcess: document.createElement("div"),
    welcomeModel: document.createElement("div"),
    welcomeHints: document.createElement("div"),
  };
}

function resetState(): void {
  state.model = null;
  state.thinkingLevel = null;
  state.isStreaming = false;
  state.isCompacting = false;
  state.isRetrying = false;
  state.retryInfo = undefined;
  state.processStatus = "stopped";
  state.processHealth = "responsive";
  state.lastExitCode = null;
  state.lastExitDetail = null;
  state.sessionStats = {};
  state.cwd = "";
  state.useCtrlEnterToSend = false;
  state.availableModels = [];
  state.modelsLoaded = false;
  state.entries = [];
  (state as any).currentTurn = null;
  (state as any).version = "1.0.0";
}

// ── Tests ────────────────────────────────────────────────────────────

describe("RPC failure error state", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
    uiDeps = createUIDeps();
    dashDeps = createDashDeps();
    document.body.appendChild(uiDeps.overlayIndicators);
    initUI(uiDeps);
    initDashboard(dashDeps);
  });

  // ── Crash overlay rendering ──────────────────────────────────────

  describe("crash overlay (updateOverlayIndicators)", () => {
    it("renders crash banner with exit code, detail, and Restart button", () => {
      state.processStatus = "crashed";
      state.lastExitCode = 1;
      state.lastExitDetail = "ECONNREFUSED 127.0.0.1:9321";

      updateOverlayIndicators();

      expect(uiDeps.overlayIndicators.innerHTML).toContain("GSD process exited");
      expect(uiDeps.overlayIndicators.innerHTML).toContain("(code: 1)");
      expect(uiDeps.overlayIndicators.innerHTML).toContain("ECONNREFUSED 127.0.0.1:9321");
      expect(uiDeps.overlayIndicators.querySelector("#restartBtn")).toBeTruthy();
      expect(uiDeps.overlayIndicators.classList.contains("gsd-hidden")).toBe(false);
    });

    it("does NOT render crash banner when status is running", () => {
      state.processStatus = "running";

      updateOverlayIndicators();

      expect(uiDeps.overlayIndicators.innerHTML).not.toContain("GSD process exited");
      expect(uiDeps.overlayIndicators.querySelector("#restartBtn")).toBeNull();
      expect(uiDeps.overlayIndicators.classList.contains("gsd-hidden")).toBe(true);
    });

    it("does NOT render crash banner when status is starting", () => {
      state.processStatus = "starting";

      updateOverlayIndicators();

      expect(uiDeps.overlayIndicators.innerHTML).not.toContain("GSD process exited");
      expect(uiDeps.overlayIndicators.querySelector("#restartBtn")).toBeNull();
    });
  });

  // ── Welcome screen crash text ────────────────────────────────────

  describe("welcome screen (updateWelcomeScreen)", () => {
    it("shows failure message when processStatus is crashed", () => {
      state.processStatus = "crashed";

      updateWelcomeScreen();

      expect(dashDeps.welcomeProcess.textContent).toContain("GSD failed to start");
    });

    it("shows normal message when processStatus is running", () => {
      state.processStatus = "running";

      updateWelcomeScreen();

      expect(dashDeps.welcomeProcess.textContent).toBe("Type a message to start");
    });
  });
});
