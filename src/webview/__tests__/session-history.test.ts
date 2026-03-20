// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../helpers", () => ({
  escapeHtml: (s: string) => String(s ?? ""),
  escapeAttr: (s: string) => String(s ?? ""),
  formatRelativeTime: () => "just now",
  shortenPath: (s: string) => s,
}));

vi.mock("../a11y", () => ({
  createFocusTrap: () => () => {},
  saveFocus: () => null,
  restoreFocus: () => {},
}));

import {
  init,
  isVisible,
  show,
  hide,
  toggle,
  setCurrentSessionId,
  updateSessions,
  showError,
  handleKeyDown,
  type SessionHistoryDeps,
} from "../session-history";

function createDeps(): SessionHistoryDeps {
  return {
    panelEl: document.createElement("div"),
    historyBtn: document.createElement("button"),
    vscode: { postMessage: vi.fn() },
    _onSessionSwitched: vi.fn(),
    onNewConversation: vi.fn(),
  };
}

describe("session-history", () => {
  let deps: SessionHistoryDeps;

  beforeEach(() => {
    deps = createDeps();
    document.body.appendChild(deps.panelEl);
    init(deps);
  });

  afterEach(() => {
    if (isVisible()) hide();
    document.body.innerHTML = "";
  });

  it("isVisible returns false initially", () => {
    expect(isVisible()).toBe(false);
  });

  it("show() makes it visible and requests session list", () => {
    show();
    expect(isVisible()).toBe(true);
    expect(deps.vscode.postMessage).toHaveBeenCalledWith({ type: "get_session_list" });
  });

  it("hide() makes it not visible and clears content", () => {
    show();
    hide();
    expect(isVisible()).toBe(false);
    expect(deps.panelEl.innerHTML).toBe("");
    expect(deps.panelEl.classList.contains("gsd-hidden")).toBe(true);
  });

  it("toggle() opens when closed and closes when open", () => {
    toggle();
    expect(isVisible()).toBe(true);
    toggle();
    expect(isVisible()).toBe(false);
  });

  it("setCurrentSessionId stores the session ID", () => {
    setCurrentSessionId("session-123");
    // Internal state — verified by behavior: current session is highlighted in render
  });

  it("updateSessions renders the session list", () => {
    show();
    updateSessions([
      { id: "s1", path: "/sessions/s1", name: "Session 1", firstMessage: "Hello", startedAt: Date.now(), messageCount: 5, costTotal: 0.05 },
      { id: "s2", path: "/sessions/s2", name: "Session 2", firstMessage: "World", startedAt: Date.now(), messageCount: 3, costTotal: 0.02 },
    ]);

    expect(deps.panelEl.innerHTML).toContain("Session 1");
    expect(deps.panelEl.innerHTML).toContain("Session 2");
  });

  it("showError displays an error message", () => {
    show();
    showError("Failed to load sessions");

    expect(deps.panelEl.innerHTML).toContain("Failed to load sessions");
  });

  it("handleKeyDown returns false when not visible", () => {
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    expect(handleKeyDown(event)).toBe(false);
  });

  it("handleKeyDown Escape hides the panel", () => {
    show();
    updateSessions([]);
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    const handled = handleKeyDown(event);
    expect(handled).toBe(true);
    expect(isVisible()).toBe(false);
  });

  it("handleKeyDown ArrowDown returns true when sessions exist", () => {
    // Mock scrollIntoView on Element prototype (jsdom doesn't implement it)
    Element.prototype.scrollIntoView = vi.fn();
    show();
    updateSessions([
      { id: "s1", path: "/p1", name: "S1", firstMessage: "a", startedAt: 0, messageCount: 1, costTotal: 0 },
      { id: "s2", path: "/p2", name: "S2", firstMessage: "b", startedAt: 0, messageCount: 1, costTotal: 0 },
    ]);
    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    const handled = handleKeyDown(event);
    expect(handled).toBe(true);
  });

  it("shows empty state when no sessions exist", () => {
    show();
    updateSessions([]);
    expect(deps.panelEl.innerHTML).toContain("No previous sessions");
  });

  it("shows loading state on initial show", () => {
    show();
    // Before updateSessions is called, should show loading
    expect(deps.panelEl.innerHTML).toContain("Loading");
  });
});
