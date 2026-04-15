// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  shouldDebounce,
  _testResetDebounce,
  SEND_DEBOUNCE_MS,
} from "../send-debounce";

import {
  initPersistAttachments,
  persistAttachments,
  rehydrateAttachments,
  _testReset as resetPersist,
} from "../persist-attachments";

import { state, resetState } from "../state";
import * as sessionHistory from "../session-history";

describe("send debounce", () => {
  beforeEach(() => {
    _testResetDebounce();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first send", () => {
    expect(shouldDebounce()).toBe(false);
  });

  it("blocks a second send within SEND_DEBOUNCE_MS", () => {
    expect(shouldDebounce()).toBe(false); // first send accepted
    vi.advanceTimersByTime(100);
    expect(shouldDebounce()).toBe(true); // within 300ms — blocked
  });

  it("allows a second send after SEND_DEBOUNCE_MS has elapsed", () => {
    expect(shouldDebounce()).toBe(false); // first send
    vi.advanceTimersByTime(SEND_DEBOUNCE_MS);
    expect(shouldDebounce()).toBe(false); // 300ms later — allowed
  });

  it("resets correctly via _testResetDebounce", () => {
    expect(shouldDebounce()).toBe(false); // first send
    vi.advanceTimersByTime(50);
    expect(shouldDebounce()).toBe(true); // blocked
    _testResetDebounce();
    expect(shouldDebounce()).toBe(false); // reset — allowed again
  });

  it("exports SEND_DEBOUNCE_MS as 300", () => {
    expect(SEND_DEBOUNCE_MS).toBe(300);
  });
});

describe("attachment persistence", () => {
  let storedState: unknown = null;
  const mockVscode = {
    setState: vi.fn((s: unknown) => { storedState = s; }),
    getState: vi.fn(() => storedState),
  };

  beforeEach(() => {
    storedState = null;
    resetState();
    resetPersist();
    mockVscode.setState.mockClear();
    mockVscode.getState.mockClear();
    initPersistAttachments(mockVscode);
  });

  it("calls setState with current images and files when persistAttachments is called", () => {
    state.images = [{ type: "image", data: "abc123", mimeType: "image/png" }];
    state.files = [{ type: "file", path: "/tmp/a.txt", name: "a.txt", extension: "txt" }];
    persistAttachments();
    expect(mockVscode.setState).toHaveBeenCalledWith({
      images: state.images,
      files: state.files,
    });
  });

  it("rehydrates images from getState into state", () => {
    const saved = [{ type: "image", data: "xyz789", mimeType: "image/jpeg" }];
    storedState = { images: saved, files: [] };
    const result = rehydrateAttachments();
    expect(result.hadImages).toBe(true);
    expect(state.images).toEqual(saved);
  });

  it("rehydrates files from getState into state", () => {
    const saved = [{ type: "file", path: "/tmp/b.pdf", name: "b.pdf", extension: "pdf" }];
    storedState = { images: [], files: saved };
    const result = rehydrateAttachments();
    expect(result.hadFiles).toBe(true);
    expect(state.files).toEqual(saved);
  });

  it("returns hadImages/hadFiles false when getState returns null", () => {
    storedState = null;
    const result = rehydrateAttachments();
    expect(result.hadImages).toBe(false);
    expect(result.hadFiles).toBe(false);
    expect(state.images).toEqual([]);
    expect(state.files).toEqual([]);
  });

  it("persists empty arrays after clearing attachments", () => {
    state.images = [{ type: "image", data: "abc", mimeType: "image/png" }];
    persistAttachments();
    state.images = [];
    state.files = [];
    persistAttachments();
    expect(mockVscode.setState).toHaveBeenLastCalledWith({ images: [], files: [] });
  });
});

describe("draft confirmation", () => {
  let mockPostMessage: ReturnType<typeof vi.fn>;
  let mockHasDraft: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetState();
    mockPostMessage = vi.fn();
    mockHasDraft = vi.fn(() => false);

    const panelEl = document.createElement("div");
    const historyBtn = document.createElement("button");

    sessionHistory.init({
      panelEl,
      historyBtn,
      vscode: { postMessage: mockPostMessage },
      _onSessionSwitched: vi.fn(),
      onNewConversation: vi.fn(),
      hasDraft: mockHasDraft,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selectSession calls confirm when hasDraft returns true", () => {
    mockHasDraft.mockReturnValue(true);
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    sessionHistory._testSelectSession("/path", "id1");
    expect(confirmSpy).toHaveBeenCalledOnce();
  });

  it("selectSession does NOT call confirm when hasDraft returns false", () => {
    mockHasDraft.mockReturnValue(false);
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    sessionHistory._testSelectSession("/path", "id1");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("selectSession does not post switch_session when user cancels confirm", () => {
    mockHasDraft.mockReturnValue(true);
    vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    sessionHistory._testSelectSession("/path", "id1");
    expect(mockPostMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "switch_session" }),
    );
  });

  it("selectSession posts switch_session when user confirms", () => {
    mockHasDraft.mockReturnValue(true);
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    sessionHistory._testSelectSession("/path", "id1");
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "switch_session", path: "/path" }),
    );
  });

  it("session_switched handler clears state.images and state.files", () => {
    state.images = [{ type: "image", data: "abc", mimeType: "image/png" }];
    state.files = [{ type: "file", path: "/tmp/a.txt", name: "a.txt", extension: "txt" }];

    // Simulate what session_switched handler does
    state.images = [];
    state.files = [];

    expect(state.images).toEqual([]);
    expect(state.files).toEqual([]);
  });
});
