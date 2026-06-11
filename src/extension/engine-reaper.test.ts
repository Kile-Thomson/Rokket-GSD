import { describe, it, expect, vi } from "vitest";

import { reapOrphanEngines, type EngineProc, type ReaperDeps } from "./engine-reaper";

function makeDeps(
  procs: EngineProc[],
  alivePids: number[],
): { deps: ReaperDeps; killed: number[] } {
  const killed: number[] = [];
  const deps: ReaperDeps = {
    list: () => procs,
    isAlive: (pid) => alivePids.includes(pid),
    killTree: (pid) => {
      killed.push(pid);
      return true;
    },
  };
  return { deps, killed };
}

const GSD_CMD =
  'node "C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@opengsd\\gsd-pi\\dist\\loader.js" --mode rpc';

describe("reapOrphanEngines", () => {
  it("reaps a gsd-pi engine whose parent host is dead", () => {
    const { deps, killed } = makeDeps(
      [{ pid: 100, ppid: 9999, cmd: GSD_CMD }],
      [/* ppid 9999 not alive */],
    );
    const reaped = reapOrphanEngines(deps);
    expect(reaped).toEqual([100]);
    expect(killed).toEqual([100]);
  });

  it("leaves a gsd-pi engine whose parent host is still alive (other live window)", () => {
    const { deps, killed } = makeDeps(
      [{ pid: 200, ppid: 4242, cmd: GSD_CMD }],
      [4242], // parent host alive
    );
    const reaped = reapOrphanEngines(deps);
    expect(reaped).toEqual([]);
    expect(killed).toEqual([]);
  });

  it("ignores node processes that are not gsd-pi rpc engines", () => {
    const { deps, killed } = makeDeps(
      [
        { pid: 300, ppid: 9999, cmd: "node some-other-app.js --mode rpc" }, // not gsd-pi
        { pid: 301, ppid: 9999, cmd: "node ...gsd-pi/dist/loader.js" }, // gsd-pi but not --mode rpc
        { pid: 302, ppid: 9999, cmd: "node /opt/other/loader.js --mode rpc" }, // loader.js + rpc but not gsd-pi
      ],
      [],
    );
    const reaped = reapOrphanEngines(deps);
    expect(reaped).toEqual([]);
    expect(killed).toEqual([]);
  });

  it("reaps only the orphans in a mixed set", () => {
    const { deps, killed } = makeDeps(
      [
        { pid: 100, ppid: 9999, cmd: GSD_CMD }, // orphan
        { pid: 200, ppid: 4242, cmd: GSD_CMD }, // live window
        { pid: 300, ppid: 8888, cmd: GSD_CMD }, // orphan
      ],
      [4242],
    );
    const reaped = reapOrphanEngines(deps);
    expect(reaped.sort()).toEqual([100, 300]);
    expect(killed.sort()).toEqual([100, 300]);
  });

  it("returns empty and does not throw when enumeration fails", () => {
    const deps: ReaperDeps = {
      list: () => {
        throw new Error("powershell unavailable");
      },
      isAlive: () => false,
      killTree: vi.fn(() => true),
    };
    expect(reapOrphanEngines(deps)).toEqual([]);
    expect(deps.killTree).not.toHaveBeenCalled();
  });

  it("continues reaping after one kill throws", () => {
    const killed: number[] = [];
    const deps: ReaperDeps = {
      list: () => [
        { pid: 100, ppid: 9999, cmd: GSD_CMD },
        { pid: 300, ppid: 8888, cmd: GSD_CMD },
      ],
      isAlive: () => false,
      killTree: (pid) => {
        if (pid === 100) throw new Error("access denied");
        killed.push(pid);
        return true;
      },
    };
    const reaped = reapOrphanEngines(deps);
    expect(reaped).toEqual([300]);
    expect(killed).toEqual([300]);
  });

  it("does not report a pid as reaped when the kill fails (returns false)", () => {
    const deps: ReaperDeps = {
      list: () => [
        { pid: 100, ppid: 9999, cmd: GSD_CMD }, // kill fails
        { pid: 300, ppid: 8888, cmd: GSD_CMD }, // kill succeeds
      ],
      isAlive: () => false,
      killTree: (pid) => pid !== 100,
    };
    const reaped = reapOrphanEngines(deps);
    expect(reaped).toEqual([300]);
  });
});
