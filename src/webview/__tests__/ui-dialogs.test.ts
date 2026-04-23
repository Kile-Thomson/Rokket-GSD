// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { init, handleRequest, expireAllPending, hasPending, clearAllDialogState } from "../ui-dialogs";

// ============================================================
// Helpers
// ============================================================

let messagesContainer: HTMLElement;
let mockVscode: { postMessage: ReturnType<typeof vi.fn> };

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: `req-${Math.random().toString(36).slice(2, 8)}`,
    method: "confirm",
    title: "Do it?",
    message: "Are you sure?",
    ...overrides,
  };
}

// ============================================================
// Setup
// ============================================================

describe("ui-dialogs", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    messagesContainer = document.createElement("div");
    document.body.appendChild(messagesContainer);
    mockVscode = { postMessage: vi.fn() };
    init({ messagesContainer, vscode: mockVscode });
  });

  afterEach(() => {
    // Full reset — clears pending, fingerprints, AND resolved cache
    // so tests don't leak state via the resolved-response auto-replay
    clearAllDialogState();
    mockVscode.postMessage.mockClear();
  });

  // ============================================================
  // confirm dialog
  // ============================================================

  describe("handleRequest — confirm", () => {
    it("renders a confirm dialog with Yes/No buttons", () => {
      handleRequest(makeRequest({ id: "c1", method: "confirm", title: "Deploy?", message: "Ship it?" }));
      expect(messagesContainer.querySelector('[data-action="yes"]')).toBeTruthy();
      expect(messagesContainer.querySelector('[data-action="no"]')).toBeTruthy();
      expect(messagesContainer.innerHTML).toContain("Deploy?");
      expect(messagesContainer.innerHTML).toContain("Ship it?");
    });

    it("posts confirmed:true when Yes is clicked", () => {
      handleRequest(makeRequest({ id: "c2", method: "confirm" }));
      const yesBtn = messagesContainer.querySelector('[data-action="yes"]') as HTMLElement;
      yesBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "extension_ui_response", id: "c2", confirmed: true }),
      );
    });

    it("posts confirmed:false when No is clicked", () => {
      handleRequest(makeRequest({ id: "c3", method: "confirm" }));
      const noBtn = messagesContainer.querySelector('[data-action="no"]') as HTMLElement;
      noBtn.click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "extension_ui_response", id: "c3", confirmed: false }),
      );
    });

    it("marks wrapper as resolved after button click", () => {
      handleRequest(makeRequest({ id: "c4", method: "confirm" }));
      const wrapper = messagesContainer.querySelector('[data-ui-id="c4"]') as HTMLElement;
      (messagesContainer.querySelector('[data-action="yes"]') as HTMLElement).click();
      expect(wrapper.classList.contains("resolved")).toBe(true);
    });

    it("inserts dialog after turn container when getDialogContainer returns one", () => {
      const turnContainer = document.createElement("div");
      turnContainer.className = "gsd-entry gsd-entry-assistant streaming";
      messagesContainer.appendChild(turnContainer);

      // Re-init with a getDialogContainer that returns the turn container
      init({ messagesContainer, vscode: mockVscode, getDialogContainer: () => turnContainer });

      handleRequest(makeRequest({ id: "c-inline", method: "confirm" }));

      // Dialog should be a sibling right after the turn container (not inside it,
      // because finalizeCurrentTurn rebuilds the turn element's innerHTML)
      const wrapper = messagesContainer.querySelector('[data-ui-id="c-inline"]') as HTMLElement;
      expect(wrapper).toBeTruthy();
      expect(wrapper.previousElementSibling).toBe(turnContainer);

      // Reset to default
      init({ messagesContainer, vscode: mockVscode });
    });

    it("falls back to messagesContainer when getDialogContainer returns null", () => {
      init({ messagesContainer, vscode: mockVscode, getDialogContainer: () => null });

      handleRequest(makeRequest({ id: "c-fallback", method: "confirm" }));
      const wrapper = messagesContainer.querySelector('[data-ui-id="c-fallback"]');
      expect(wrapper).toBeTruthy();

      // Reset to default
      init({ messagesContainer, vscode: mockVscode });
    });

    it("preserves chronological order for multiple dialogs in the same turn", () => {
      const turnContainer = document.createElement("div");
      turnContainer.className = "gsd-entry gsd-entry-assistant streaming";
      messagesContainer.appendChild(turnContainer);

      init({ messagesContainer, vscode: mockVscode, getDialogContainer: () => turnContainer });

      handleRequest(makeRequest({ id: "d1", method: "confirm", title: "First?" }));
      handleRequest(makeRequest({ id: "d2", method: "confirm", title: "Second?" }));
      handleRequest(makeRequest({ id: "d3", method: "confirm", title: "Third?" }));

      // All three should appear after the turn in FIFO order
      const wrappers = messagesContainer.querySelectorAll(".gsd-entry-ui-request");
      expect(wrappers).toHaveLength(3);
      expect((wrappers[0] as HTMLElement).dataset.uiId).toBe("d1");
      expect((wrappers[1] as HTMLElement).dataset.uiId).toBe("d2");
      expect((wrappers[2] as HTMLElement).dataset.uiId).toBe("d3");

      // Reset
      init({ messagesContainer, vscode: mockVscode });
    });
  });

  // ============================================================
  // select dialog (single)
  // ============================================================

  describe("handleRequest — single select", () => {
    it("renders option buttons for each option", () => {
      handleRequest(makeRequest({ id: "s1", method: "select", title: "Pick", options: ["A", "B", "C"] }));
      const options = messagesContainer.querySelectorAll(".gsd-ui-option-btn");
      expect(options.length).toBe(3);
    });

    it("posts selected value when an option is clicked", () => {
      handleRequest(makeRequest({ id: "s2", method: "select", title: "Pick", options: ["Alpha", "Beta"] }));
      const btns = messagesContainer.querySelectorAll(".gsd-ui-option-btn");
      (btns[1] as HTMLElement).click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "extension_ui_response", id: "s2", value: "Beta" }),
      );
    });

    it("posts cancelled when Skip is clicked", () => {
      handleRequest(makeRequest({ id: "s3", method: "select", title: "Pick", options: ["X"] }));
      (messagesContainer.querySelector(".gsd-ui-cancel-btn") as HTMLElement).click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "s3", cancelled: true }),
      );
    });
  });

  // ============================================================
  // select dialog (multi)
  // ============================================================

  describe("handleRequest — multi select", () => {
    it("renders checkboxes and a Confirm button", () => {
      handleRequest(makeRequest({ id: "m1", method: "select", title: "Multi", options: ["A", "B"], allowMultiple: true }));
      expect(messagesContainer.querySelectorAll(".gsd-ui-multi-option").length).toBe(2);
      const confirmBtn = messagesContainer.querySelector(".gsd-ui-multi-confirm") as HTMLButtonElement;
      expect(confirmBtn).toBeTruthy();
      expect(confirmBtn.disabled).toBe(true); // nothing selected yet
    });

    it("toggles selection on click and posts values on confirm", () => {
      handleRequest(makeRequest({ id: "m2", method: "select", title: "Multi", options: ["A", "B", "C"], allowMultiple: true }));
      const opts = messagesContainer.querySelectorAll(".gsd-ui-multi-option");
      (opts[0] as HTMLElement).click(); // select A
      (opts[2] as HTMLElement).click(); // select C

      const confirmBtn = messagesContainer.querySelector(".gsd-ui-multi-confirm") as HTMLButtonElement;
      expect(confirmBtn.disabled).toBe(false);
      confirmBtn.click();

      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "m2", values: expect.arrayContaining(["A", "C"]) }),
      );
    });
  });

  // ============================================================
  // input dialog
  // ============================================================

  describe("handleRequest — input", () => {
    it("renders an input field and submit/cancel buttons", () => {
      handleRequest(makeRequest({ id: "i1", method: "input", title: "Name?", placeholder: "type here" }));
      const input = messagesContainer.querySelector(".gsd-ui-input") as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.placeholder).toBe("type here");
      expect(messagesContainer.querySelector('[data-action="submit"]')).toBeTruthy();
      expect(messagesContainer.querySelector('[data-action="cancel"]')).toBeTruthy();
    });

    it("posts input value when submit is clicked", () => {
      handleRequest(makeRequest({ id: "i2", method: "input" }));
      const input = messagesContainer.querySelector(".gsd-ui-input") as HTMLInputElement;
      input.value = "hello world";
      (messagesContainer.querySelector('[data-action="submit"]') as HTMLElement).click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "i2", value: "hello world" }),
      );
    });

    it("posts cancelled when cancel is clicked", () => {
      handleRequest(makeRequest({ id: "i3", method: "input" }));
      (messagesContainer.querySelector('[data-action="cancel"]') as HTMLElement).click();
      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "i3", cancelled: true }),
      );
    });

    it("submits on Enter key", () => {
      handleRequest(makeRequest({ id: "i4", method: "input" }));
      const input = messagesContainer.querySelector(".gsd-ui-input") as HTMLInputElement;
      input.value = "enter-test";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "i4", value: "enter-test" }),
      );
    });
  });

  // ============================================================
  // dedup
  // ============================================================

  describe("dedup", () => {
    it("links duplicate select requests to the original dialog", () => {
      const base = { method: "select", title: "Same", message: "msg", options: ["A", "B"] };
      handleRequest({ ...base, id: "d1" });
      handleRequest({ ...base, id: "d2" }); // duplicate fingerprint

      // Only one dialog rendered
      const wrappers = messagesContainer.querySelectorAll(".gsd-entry-ui-request");
      expect(wrappers.length).toBe(1);
    });

    it("resolves linked select duplicates when original is answered", () => {
      const base = { method: "select", title: "Dup", message: "", options: ["Yes", "No"] };
      handleRequest({ ...base, id: "dup1" });
      handleRequest({ ...base, id: "dup2" });

      (messagesContainer.querySelector('.gsd-ui-option-btn') as HTMLElement).click();

      // Both primary and linked should have been sent
      const calls = mockVscode.postMessage.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((c: any) => c.id === "dup1")).toBe(true);
      expect(calls.some((c: any) => c.id === "dup2")).toBe(true);
    });

    it("does not dedup confirm dialogs — each permission prompt renders independently", () => {
      const base = { method: "confirm", title: "Same", message: "msg" };
      handleRequest({ ...base, id: "cd1" });
      handleRequest({ ...base, id: "cd2" });

      // Both permission prompts render as independent dialogs
      const wrappers = messagesContainer.querySelectorAll(".gsd-entry-ui-request");
      expect(wrappers.length).toBe(2);
    });
  });

  // ============================================================
  // hasPending / expireAllPending
  // ============================================================

  describe("hasPending", () => {
    it("returns false when no dialogs exist", () => {
      expect(hasPending()).toBe(false);
    });

    it("returns true when a dialog is pending", () => {
      handleRequest(makeRequest({ id: "p1" }));
      expect(hasPending()).toBe(true);
    });

    it("returns false after dialog is resolved", () => {
      handleRequest(makeRequest({ id: "p2", method: "confirm" }));
      (messagesContainer.querySelector('[data-action="yes"]') as HTMLElement).click();
      expect(hasPending()).toBe(false);
    });
  });

  describe("expireAllPending", () => {
    it("clears all pending dialogs", () => {
      handleRequest(makeRequest({ id: "e1" }));
      handleRequest(makeRequest({ id: "e2", title: "Different" }));
      expect(hasPending()).toBe(true);
      expireAllPending("test");
      expect(hasPending()).toBe(false);
    });

    it("marks expired dialogs as resolved", () => {
      handleRequest(makeRequest({ id: "e3" }));
      expireAllPending("Agent moved on");
      const wrapper = messagesContainer.querySelector('[data-ui-id="e3"]') as HTMLElement;
      expect(wrapper.classList.contains("resolved")).toBe(true);
    });

    it("sends cancelled response for linked select duplicates", () => {
      const base = { method: "select", title: "Exp", message: "", options: ["A", "B"] };
      handleRequest({ ...base, id: "exp1" });
      handleRequest({ ...base, id: "exp2" }); // linked to exp1 via dedup
      expireAllPending("test");
      const calls = mockVscode.postMessage.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((c: any) => c.id === "exp2" && c.cancelled === true)).toBe(true);
    });
  });

  // ============================================================
  // timeout handling
  // ============================================================

  describe("timeout handling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-expires dialog after timeout", () => {
      handleRequest(makeRequest({ id: "t1", timeout: 5000 }));
      expect(hasPending()).toBe(true);

      vi.advanceTimersByTime(5000);

      const wrapper = messagesContainer.querySelector('[data-ui-id="t1"]') as HTMLElement;
      expect(wrapper.classList.contains("resolved")).toBe(true);
      expect(hasPending()).toBe(false);
    });

    it("shows countdown element", () => {
      handleRequest(makeRequest({ id: "t2", timeout: 10000 }));
      const countdown = messagesContainer.querySelector(".gsd-ui-countdown");
      expect(countdown).toBeTruthy();
    });
  });

  // ============================================================
  // resolved-response auto-replay (loop breaker)
  // ============================================================

  describe("resolved response replay", () => {
    it("auto-responds to repeated identical dialogs after resolution", () => {
      // First request — user clicks an option
      handleRequest({ id: "loop1", method: "select", title: "Interrupted Session Detected", message: "", options: ["Resume", "Skip"] });
      const btn = messagesContainer.querySelector('.gsd-ui-option-btn[data-value="Resume"]') as HTMLElement;
      btn.click();

      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "loop1", value: "Resume" }),
      );
      mockVscode.postMessage.mockClear();

      // Second identical request from gsd-pi — should auto-respond without rendering
      handleRequest({ id: "loop2", method: "select", title: "Interrupted Session Detected", message: "", options: ["Resume", "Skip"] });

      // Should have auto-replied with the same value
      expect(mockVscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: "loop2", value: "Resume" }),
      );

      // Should NOT have rendered a new dialog
      const wrappers = messagesContainer.querySelectorAll(".gsd-entry-ui-request");
      expect(wrappers.length).toBe(1); // only the original
    });

    it("does not auto-respond to repeated identical confirm dialogs — each must be approved", () => {
      handleRequest({ id: "cloop1", method: "confirm", title: "Continue?", message: "Proceed?" });
      (messagesContainer.querySelector('[data-action="yes"]') as HTMLElement).click();
      mockVscode.postMessage.mockClear();

      // Re-ask same question — must render a new dialog, never auto-reply
      handleRequest({ id: "cloop2", method: "confirm", title: "Continue?", message: "Proceed?" });
      expect(mockVscode.postMessage).not.toHaveBeenCalled();
      const wrappers = messagesContainer.querySelectorAll(".gsd-entry-ui-request:not(.resolved)");
      expect(wrappers.length).toBe(1); // new dialog rendered and pending
    });

    it("stops auto-replaying after TTL expires", () => {
      vi.useFakeTimers();

      handleRequest({ id: "ttl1", method: "select", title: "Pick", message: "", options: ["A"] });
      (messagesContainer.querySelector('.gsd-ui-option-btn') as HTMLElement).click();
      mockVscode.postMessage.mockClear();

      // Advance past the 10s TTL
      vi.advanceTimersByTime(11_000);

      // Same question again — should render a new dialog since cache expired
      handleRequest({ id: "ttl2", method: "select", title: "Pick", message: "", options: ["A"] });
      const wrappers = messagesContainer.querySelectorAll(".gsd-entry-ui-request");
      expect(wrappers.length).toBe(2); // both rendered

      vi.useRealTimers();
    });

    it("clearAllDialogState resets the resolved cache", () => {
      handleRequest({ id: "clr1", method: "confirm", title: "Clear?", message: "" });
      (messagesContainer.querySelector('[data-action="yes"]') as HTMLElement).click();
      mockVscode.postMessage.mockClear();

      clearAllDialogState();

      // Same question — should render fresh since cache was cleared
      handleRequest({ id: "clr2", method: "confirm", title: "Clear?", message: "" });
      const wrappers = messagesContainer.querySelectorAll(".gsd-entry-ui-request");
      expect(wrappers.length).toBe(2);
    });
  });
});
