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

// ── Mock parallel-status ──
const mockReadParallelWorkers = vi.fn();
const mockReadBudgetCeiling = vi.fn();
vi.mock("./parallel-status", () => ({
  readParallelWorkers: (...args: unknown[]) => mockReadParallelWorkers(...args),
  readBudgetCeiling: (...args: unknown[]) => mockReadBudgetCeiling(...args),
}));

import { AutoProgressPoller } from "./auto-progress-poller";

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
    mockCountPendingCaptures.mockResolvedValue(0);
    mockReadParallelWorkers.mockResolvedValue(null);
    mockReadBudgetCeiling.mockResolvedValue(null);
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

    // finalPollAndMaybeClear is async — flush microtasks so it resolves
    await vi.advanceTimersByTimeAsync(0);

    // Should send a clear message (phase is "building", not "needs-discussion")
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

  it("initiates all 5 async calls concurrently in poll()", async () => {
    const callOrder: string[] = [];
    let resolveGetState: (v: any) => void;
    let resolveGetSessionStats: (v: any) => void;
    let resolveDashboard: (v: any) => void;
    let resolveCaptures: (v: any) => void;
    let resolveWorkers: (v: any) => void;

    const client = createMockClient({
      isRunning: true,
      getState: vi.fn(() => {
        callOrder.push("getState");
        return new Promise(r => { resolveGetState = r; });
      }),
      getSessionStats: vi.fn(() => {
        callOrder.push("getSessionStats");
        return new Promise(r => { resolveGetSessionStats = r; });
      }),
    });

    mockBuildDashboardData.mockImplementation(() => {
      callOrder.push("buildDashboardData");
      return new Promise(r => { resolveDashboard = r; });
    });
    mockCountPendingCaptures.mockImplementation(() => {
      callOrder.push("countPendingCaptures");
      return new Promise(r => { resolveCaptures = r; });
    });
    mockReadParallelWorkers.mockImplementation(() => {
      callOrder.push("readParallelWorkers");
      return new Promise(r => { resolveWorkers = r; });
    });

    const { poller } = createPoller({ client });
    poller.onAutoModeChanged("auto");

    // Let microtasks run so poll() starts — but none of the 5 promises have resolved yet
    await vi.advanceTimersByTimeAsync(0);

    // All 5 must have been called before any resolved
    expect(callOrder).toHaveLength(5);
    expect(callOrder).toContain("getState");
    expect(callOrder).toContain("getSessionStats");
    expect(callOrder).toContain("buildDashboardData");
    expect(callOrder).toContain("countPendingCaptures");
    expect(callOrder).toContain("readParallelWorkers");

    // Now resolve them all to let poll() complete
    resolveGetState!(null);
    resolveGetSessionStats!(null);
    resolveDashboard!({ phase: "building" });
    resolveCaptures!(0);
    resolveWorkers!(null);
    await vi.advanceTimersByTimeAsync(0);

    poller.dispose();
  });

  it("runs getSessionStats and countPendingCaptures concurrently in finalPollAndMaybeClear", async () => {
    const callOrder: string[] = [];
    let resolveStats: (v: any) => void;
    let resolveCaptures: (v: any) => void;

    // Make buildDashboardData return needs-discussion so the parallel branch executes
    mockBuildDashboardData.mockResolvedValue({
      phase: "needs-discussion",
      milestone: "M001",
      slice: "S01",
      task: "T01",
      progress: { slices: { done: 0, total: 1 }, tasks: { done: 0, total: 1 }, milestones: { done: 0, total: 1 } },
    });

    const client = createMockClient({
      isRunning: true,
      getSessionStats: vi.fn(() => {
        callOrder.push("getSessionStats");
        return new Promise(r => { resolveStats = r; });
      }),
    });

    mockCountPendingCaptures.mockImplementation(() => {
      callOrder.push("countPendingCaptures");
      return new Promise(r => { resolveCaptures = r; });
    });

    const { poller, webview } = createPoller({ client });

    // Start then stop to trigger finalPollAndMaybeClear
    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0);

    callOrder.length = 0;
    poller.onAutoModeChanged(undefined);
    await vi.advanceTimersByTimeAsync(0);

    // Both should have been called before either resolved
    expect(callOrder).toContain("getSessionStats");
    expect(callOrder).toContain("countPendingCaptures");
    expect(callOrder).toHaveLength(2);

    // Resolve to complete the finalPollAndMaybeClear
    resolveStats!({ cost: 1.23 });
    resolveCaptures!(2);
    await vi.advanceTimersByTimeAsync(0);

    // Should send paused progress (not clear) for needs-discussion
    const lastMsg = webview.postMessage.mock.calls.at(-1)?.[0];
    expect(lastMsg.data).toMatchObject({
      autoState: "paused",
      phase: "needs-discussion",
      pendingCaptures: 2,
      cost: 1.23,
    });

    poller.dispose();
  });

  it("rebindWebview updates webview reference for subsequent polls", async () => {
    const webviewA = createMockWebview();
    const webviewB = createMockWebview();
    const { poller } = createPoller({ webview: webviewA });

    poller.onAutoModeChanged("auto");
    await vi.advanceTimersByTimeAsync(0); // initial poll goes to A

    expect(webviewA.postMessage).toHaveBeenCalled();
    expect(webviewB.postMessage).not.toHaveBeenCalled();

    webviewA.postMessage.mockClear();
    poller.rebindWebview(webviewB);

    await vi.advanceTimersByTimeAsync(3000); // next poll should go to B

    expect(webviewB.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "auto_progress" }),
    );
    expect(webviewA.postMessage).not.toHaveBeenCalled();

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
