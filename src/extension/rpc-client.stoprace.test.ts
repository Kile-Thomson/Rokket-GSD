import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { GsdRpcClient } from "./rpc-client";
import { STOP_SIGTERM_DELAY_MS, STOP_FORCE_KILL_DELAY_MS } from "../shared/constants";

// Regression coverage for the stop()/restart() race: a stop() timer that
// outlives a clean process exit must never act on the process that restart()
// spawned in its place.

interface FakeProc extends EventEmitter {
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
  stdin: { writable: boolean } | undefined;
}

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.killed = false;
  // stdin not writable, so stop()'s abort send() throws and is caught.
  proc.stdin = { writable: false };
  proc.kill = vi.fn((_signal?: string) => {
    proc.killed = true;
    return true;
  });
  return proc;
}

function setProcess(client: GsdRpcClient, proc: FakeProc | null): void {
  (client as unknown as { process: FakeProc | null }).process = proc;
}

describe("GsdRpcClient.stop() restart race", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not SIGTERM a replacement process after a clean exit before the SIGTERM delay", async () => {
    const client = new GsdRpcClient();
    const original = makeFakeProc();
    setProcess(client, original);

    const stopped = client.stop();

    // The original process exits cleanly well before STOP_SIGTERM_DELAY_MS.
    original.emit("exit", 0, null);
    await stopped;

    // restart() would now spawn a fresh child on the same client instance.
    const replacement = makeFakeProc();
    setProcess(client, replacement);

    // Advance past every timer stop() could have scheduled.
    await vi.advanceTimersByTimeAsync(STOP_FORCE_KILL_DELAY_MS + STOP_SIGTERM_DELAY_MS + 1000);

    // The stale SIGTERM timer must have been cleared by the clean exit.
    expect(original.kill).not.toHaveBeenCalled();
    expect(replacement.kill).not.toHaveBeenCalled();
    expect(replacement.killed).toBe(false);
  });
});
