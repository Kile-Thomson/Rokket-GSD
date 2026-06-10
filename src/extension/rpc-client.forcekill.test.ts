import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock only spawnSync; keep the rest of child_process real so importing the
// module (which uses spawn for path resolution) stays intact. This file is
// isolated from rpc-client.test.ts, whose ENOENT tests need the real spawn.
const spawnSyncMock = vi.fn();
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawnSync: (...args: unknown[]) => spawnSyncMock(...args) };
});

import { GsdRpcClient } from "./rpc-client";

function setPid(client: GsdRpcClient, pid: number | null): void {
  (client as unknown as { _pid: number | null })._pid = pid;
}

describe("GsdRpcClient.forceKillSync", () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  });

  it("no-ops when no process is running (pid null)", () => {
    const client = new GsdRpcClient();
    setPid(client, null);
    expect(() => client.forceKillSync()).not.toThrow();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("issues a blocking taskkill /F /T for the pid on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const client = new GsdRpcClient();
    setPid(client, 4242);

    client.forceKillSync();

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "taskkill",
      ["/F", "/T", "/PID", "4242"],
      expect.objectContaining({ windowsHide: true, stdio: "ignore" }),
    );
  });

  it("does not use taskkill on non-win32 platforms", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    const client = new GsdRpcClient();
    // A pid that almost certainly has no matching process/group; the resulting
    // ESRCH is swallowed internally, so this must not throw or call taskkill.
    setPid(client, 2 ** 30);
    expect(() => client.forceKillSync()).not.toThrow();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});
