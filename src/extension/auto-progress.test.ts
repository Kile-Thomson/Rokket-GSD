import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock vscode ──
vi.mock("vscode", () => ({}));

// ── Mock dashboard-parser ──
const mockBuildDashboardData = vi.fn();
vi.mock("./dashboard-parser", () => ({
  buildDashboardData: (...args: unknown[]) => mockBuildDashboardData(...args),
}));

// ── Mock captures-parser ──
const mockCountPendingCaptures = vi.fn();
vi.mock("./captures-parser", () => ({
  countPendingCaptures: (...args: unknown[]) => mockCountPendingCaptures(...args),
}));

import { AutoProgressPoller } from "./auto-progress";

// ── Helpers ──
function createMockWebview() {
  return {
    postMessage: vi.fn().mockResolvedValue(true),
    onDidReceiveMessage: vi.fn(),
    html: "",
    options: {},
    cspSource: "",
    asWebviewUri: vi.fn(),
  } as any;
}

function createMockClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isRunning: false,
    getState: vi.fn().mockResolvedValue(null),
    getSessionStats: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as any;
}

function createMockOutput() {
  return {
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  } as any;
}

function createPoller(overrides: {
  client?: any;
  webview?: any;
  output?: any;
  onModelChanged?: any;
} = {}) {
  const webview = overrides.webview ?? createMockWebview();
  const client = overrides.client ?? createMockClient();
  const output = overrides.output ?? createMockOutput();

  return {
    poller: new AutoProgressPoller(
      "test-session",
      client,
      webview,
      () => "/mock/cwd",
      output,
      overrides.onModelChanged,
    ),
    webview,
    client,
    output,
  };
}

describe("AutoProgressPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockBuildDashboardData.mockResolvedValue({
      phase: "building",
      milestone: "M001",
      slice: "S01",
      task: "T01",
      progress: {
        slices: { done: 1, total: 3 },
        tasks: { done: 2, total: 5 },
        milestones: { done: 0, total: 1 },
      },
    });
    mockCountPendingCaptures.mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("constructs without starting polling", () => {
    const { poller } = createPoller();

    expect(poller.isActive).toBe(false);
  });

  it("starts polling on onAutoModeChanged('auto')", async () => {
    const { poller, webview } = createPoller();

    poller.onAutoModeChanged("auto");
    expect(poller.isActive).toBe(true);

    // Immediate poll fires synchronously on start
    await vi.advanceTimersByTimeAsync(0);

    expect(mockBuildDashboardData).toHaveBeenCalledWith("/mock/cwd");
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "auto_progress" }),
    );
  });

  it("polls periodically at 3-second intervals", async () => {
    const { poller } = createPoller();

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0); // initial poll

    mockBuildDashboardData.mockClear();

    // Advance 3 seconds — should trigger another poll
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockBuildDashboardData).toHaveBeenCalledTimes(1);

    // Advance another 3 seconds
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockBuildDashboardData).toHaveBeenCalledTimes(2);

    poller.dispose();
  });

  it("stops polling on onAutoModeChanged(undefined)", async () => {
    const { poller, webview } = createPoller();

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0);

    poller.onAutoModeChanged(undefined);
    expect(poller.isActive).toBe(false);

    // Should send a clear message
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "auto_progress", data: null }),
    );

    mockBuildDashboardData.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockBuildDashboardData).not.toHaveBeenCalled();
  });

  it("does not create duplicate intervals on repeated start()", async () => {
    const { poller } = createPoller();

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0);
    poller.onAutoModeChanged("auto"); // duplicate — should be ignored (already active)
    await vi.advanceTimersByTimeAsync(0);

    mockBuildDashboardData.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    // Only 1 poll, not 2 (no duplicate interval)
    expect(mockBuildDashboardData).toHaveBeenCalledTimes(1);

    poller.dispose();
  });

  it("continues polling when buildDashboardData throws", async () => {
    const { poller, output } = createPoller();

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0); // initial poll

    // Make the next poll throw
    mockBuildDashboardData.mockRejectedValueOnce(new Error("parse failure"));

    await vi.advanceTimersByTimeAsync(3000);
    expect(output.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("poll error"),
    );

    // Should still poll after the error
    mockBuildDashboardData.mockResolvedValueOnce({ phase: "planning" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockBuildDashboardData).toHaveBeenCalled();

    poller.dispose();
  });

  it("cleans up on onProcessExit()", async () => {
    const { poller, webview } = createPoller();

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0);

    poller.onProcessExit();
    expect(poller.isActive).toBe(false);
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "auto_progress", data: null }),
    );
  });

  it("cleans up on onNewConversation()", async () => {
    const { poller, webview } = createPoller();

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0);

    poller.onNewConversation();
    expect(poller.isActive).toBe(false);
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "auto_progress", data: null }),
    );
  });

  it("dispose() permanently stops the poller from polling", async () => {
    const { poller } = createPoller();

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0);

    poller.dispose();

    // Trying to re-activate should be ignored — no new polling occurs
    mockBuildDashboardData.mockClear();
    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockBuildDashboardData).not.toHaveBeenCalled();
  });

  it("includes RPC state when client is running", async () => {
    const client = createMockClient({
      isRunning: true,
      getState: vi.fn().mockResolvedValue({
        model: { id: "claude-sonnet-4-20250514", provider: "anthropic" },
      }),
      getSessionStats: vi.fn().mockResolvedValue({ cost: 0.05 }),
    });
    const { poller, webview } = createPoller({ client });

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0);

    const lastCall = webview.postMessage.mock.calls.at(-1)?.[0];
    expect(lastCall.data.model).toEqual({ id: "claude-sonnet-4-20250514", provider: "anthropic" });
    expect(lastCall.data.cost).toBe(0.05);

    poller.dispose();
  });

  it("fires onModelChanged callback when model changes", async () => {
    const onModelChanged = vi.fn();
    const client = createMockClient({
      isRunning: true,
      getState: vi.fn().mockResolvedValue({
        model: { id: "claude-sonnet-4-20250514", provider: "anthropic" },
      }),
    });
    const { poller } = createPoller({ client, onModelChanged });

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0);

    // Change the model on next poll
    client.getState.mockResolvedValue({
      model: { id: "gpt-4", provider: "openai" },
    });
    await vi.advanceTimersByTimeAsync(3000);

    expect(onModelChanged).toHaveBeenCalledWith(
      { id: "claude-sonnet-4-20250514", provider: "anthropic" },
      { id: "gpt-4", provider: "openai" },
    );

    poller.dispose();
  });

  it("resumes polling on auto after paused state", async () => {
    const { poller } = createPoller();

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0);

    poller.onAutoModeChanged("paused");
    expect(poller.isActive).toBe(false);

    mockBuildDashboardData.mockClear();
    poller.onAutoModeChanged("auto");
    expect(poller.isActive).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockBuildDashboardData).toHaveBeenCalled();

    poller.dispose();
  });
});
