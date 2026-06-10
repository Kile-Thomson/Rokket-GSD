import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupVscodeMock } from "./__test-utils__/vscode-mock";

vi.mock("vscode", () => setupVscodeMock());
// Keep the heavy collaborators inert — this test only exercises teardown.
vi.mock("./rpc-client", () => ({ GsdRpcClient: vi.fn() }));
vi.mock("./auto-progress-poller", () => ({ AutoProgressPoller: vi.fn() }));
vi.mock("./workflow-progress-poller", () => ({ WorkflowProgressManager: vi.fn() }));
vi.mock("./workflow-fs-watcher", () => ({ WorkflowFsWatcher: vi.fn() }));

import { GsdWebviewProvider } from "./webview-provider";
import { createSessionState, type SessionState } from "./session-state";

function makeProvider(): GsdWebviewProvider {
  const uri = { fsPath: "/mock/ext", scheme: "file" } as never;
  const context = { subscriptions: [], globalState: { get: vi.fn(), update: vi.fn() } } as never;
  return new GsdWebviewProvider(uri, context);
}

/** A session whose client records whether it was synchronously force-killed. */
function makeKillableSession(): { session: SessionState; forceKillSync: ReturnType<typeof vi.fn> } {
  const session = createSessionState();
  const forceKillSync = vi.fn();
  session.client = {
    forceKillSync,
    stop: vi.fn().mockResolvedValue(undefined),
    removeAllListeners: vi.fn(),
  } as unknown as SessionState["client"];
  return { session, forceKillSync };
}

describe("GsdWebviewProvider.disposeAsync teardown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("synchronously force-kills every live session client", async () => {
    const provider = makeProvider();
    const a = makeKillableSession();
    const b = makeKillableSession();
    const sessions = (provider as unknown as { sessions: Map<string, SessionState> }).sessions;
    sessions.set("sidebar", a.session);
    sessions.set("panel-1", b.session);

    await provider.disposeAsync();

    expect(a.forceKillSync).toHaveBeenCalledTimes(1);
    expect(b.forceKillSync).toHaveBeenCalledTimes(1);
    expect(sessions.size).toBe(0);
  });

  it("does not throw when a session has no client", async () => {
    const provider = makeProvider();
    const sessions = (provider as unknown as { sessions: Map<string, SessionState> }).sessions;
    sessions.set("empty", createSessionState());

    await expect(provider.disposeAsync()).resolves.toBeUndefined();
  });
});
