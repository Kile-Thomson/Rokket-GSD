import { spawnSync } from "child_process";

// ============================================================
// Orphaned gsd-pi engine reaper
// ============================================================
//
// The extension spawns gsd-pi as a child process (`gsd --mode rpc`). On a
// clean window close, `deactivate()` force-kills that child. But "Reload
// Window" (and some crashes) tear down the extension host WITHOUT awaiting
// `deactivate()`, so the engine survives as an orphan. The next extension host
// then reconnects to that stale engine — which is still running whatever
// provider code it loaded at launch. That is the root cause of the recurring
// "I patched the engine / rebuilt the VSIX / restarted, but nothing changed"
// loop: the disk is current, the running process is not.
//
// This module reaps those orphans on activate, BEFORE a fresh engine is
// spawned. An engine is an orphan when its parent process (the host that
// spawned it) is no longer alive. Live windows are never touched: their engine
// still has a living parent. No per-window bookkeeping is needed — the
// parent-alive check is the identity.

const PROBE_TIMEOUT_MS = 6000;
const PROBE_MAX_BUFFER = 8 * 1024 * 1024;

/** A node process that looks like a gsd-pi RPC engine. */
export interface EngineProc {
  pid: number;
  ppid: number;
  cmd: string;
}

export interface ReaperDeps {
  /** Enumerate candidate node processes (pid, ppid, command line). */
  list: () => EngineProc[];
  /** True if a process with this pid is currently alive. */
  isAlive: (pid: number) => boolean;
  /** Force-kill a process tree by pid. Returns true only if the kill succeeded. */
  killTree: (pid: number) => boolean;
  log?: (msg: string) => void;
}

// A gsd-pi RPC engine: launched in --mode rpc, from the gsd-pi package's
// loader.js. ALL THREE markers must be present so we never touch an unrelated
// node process that merely passes "rpc" on its line, or some other project's
// loader.js. The gsd-pi package marker is the strong identity signal.
const RPC_MARKER = /--mode\s+rpc/i;
const PACKAGE_MARKER = /gsd-pi/i;
const LOADER_MARKER = /loader\.js/i;

/** True if a command line is a gsd-pi RPC engine (gsd-pi + loader.js + --mode rpc). */
function isGsdRpcEngine(cmd: string): boolean {
  return RPC_MARKER.test(cmd) && PACKAGE_MARKER.test(cmd) && LOADER_MARKER.test(cmd);
}

/** Default liveness probe: signal 0 reports existence without delivering a signal. */
export function defaultIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack permission to signal it —
    // still alive for our purposes. ESRCH (and anything else) means gone.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Default process-tree kill (Windows: taskkill /F /T; POSIX: kill the group).
 * Returns true only when the target is confirmed gone — a failed kill (e.g.
 * taskkill non-zero exit, EPERM) returns false so the caller never reports a
 * still-running engine as reaped.
 */
export function defaultKillTree(pid: number): boolean {
  if (process.platform === "win32") {
    // taskkill reports failure via res.error (spawn/timeout) or a non-zero
    // status (couldn't kill the tree), NOT by throwing. Treat both as failure.
    const res = spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
    });
    return !res.error && res.status === 0;
  }
  try {
    process.kill(-pid, "SIGKILL");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGKILL");
      return true;
    } catch (err) {
      // ESRCH = the process is already gone, which is the outcome we want.
      // Anything else (EPERM, etc.) means it is still running — a real failure.
      return (err as NodeJS.ErrnoException).code === "ESRCH";
    }
  }
}

/** Enumerate all node.exe processes on Windows (pid, ppid, command line) via Win32_Process. */
function listWindowsNodeProcesses(): EngineProc[] {
  const res = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        "Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: PROBE_MAX_BUFFER },
  );
  if (res.status !== 0 || !res.stdout) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .map((r) => r as { ProcessId?: number; ParentProcessId?: number; CommandLine?: string })
    .filter((r) => typeof r?.CommandLine === "string")
    .map((r) => ({
      pid: Number(r.ProcessId),
      ppid: Number(r.ParentProcessId),
      cmd: String(r.CommandLine),
    }))
    .filter((p) => Number.isInteger(p.pid) && p.pid > 0);
}

/** Enumerate all processes on POSIX (pid, ppid, command line) via `ps`. */
function listPosixNodeProcesses(): EngineProc[] {
  // pid=, ppid=, args= with empty headers gives a stable, header-less table.
  const res = spawnSync("ps", ["-eo", "pid=,ppid=,args="], {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_MAX_BUFFER,
  });
  if (res.status !== 0 || !res.stdout) return [];
  const out: EngineProc[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] });
  }
  return out;
}

/** Enumerate gsd-pi RPC engine processes currently running on this machine. */
export function listGsdRpcEngines(): EngineProc[] {
  const all = process.platform === "win32" ? listWindowsNodeProcesses() : listPosixNodeProcesses();
  return all.filter((p) => isGsdRpcEngine(p.cmd));
}

const productionDeps: ReaperDeps = {
  list: listGsdRpcEngines,
  isAlive: defaultIsAlive,
  killTree: defaultKillTree,
};

/**
 * True if an engine has been orphaned by the death of its spawning host.
 *
 * On Windows the ppid is not reparented when the parent dies, so a dead parent
 * simply reads as not-alive — the parent-alive check is sufficient.
 *
 * On POSIX a dead parent reparents the child to init or a subreaper, so the
 * ppid becomes 1 (occasionally 0) and `isAlive(ppid)` would always be true,
 * never flagging the orphan. A reparented ppid is therefore itself the orphan
 * signal. (We cannot instead record the host pid at spawn time: this reaper
 * enumerates engines it did not spawn — from other windows and prior, crashed
 * sessions — so no such bookkeeping exists for them.)
 */
function isOrphanEngine(engine: EngineProc, isAlive: (pid: number) => boolean): boolean {
  if (process.platform !== "win32" && engine.ppid <= 1) return true;
  return !isAlive(engine.ppid);
}

/**
 * Kill every orphaned gsd-pi RPC engine (one whose parent host process is gone).
 * Returns the pids that were confirmed killed. Safe to call on every activate:
 * engines belonging to a live window keep a living parent and are left
 * untouched.
 */
export function reapOrphanEngines(deps: ReaperDeps = productionDeps): number[] {
  let engines: EngineProc[];
  try {
    engines = deps.list().filter((e) => isGsdRpcEngine(e.cmd));
  } catch (err) {
    deps.log?.(`[engine-reaper] enumeration failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const reaped: number[] = [];
  for (const engine of engines) {
    // A live parent means this engine belongs to a live extension host (this
    // window or another) — never reap a live window's engine.
    if (!isOrphanEngine(engine, deps.isAlive)) continue;
    try {
      if (deps.killTree(engine.pid)) {
        reaped.push(engine.pid);
        deps.log?.(
          `[engine-reaper] reaped orphaned gsd-pi engine PID ${engine.pid} (parent ${engine.ppid} gone)`,
        );
      } else {
        deps.log?.(
          `[engine-reaper] kill failed for orphaned gsd-pi engine PID ${engine.pid} (parent ${engine.ppid}) — left running`,
        );
      }
    } catch (err) {
      deps.log?.(
        `[engine-reaper] failed to reap PID ${engine.pid}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return reaped;
}

/**
 * Fire-and-forget reap for use on extension activate. Runs the (synchronous,
 * spawnSync-based) reap off the activation path so a slow process query never
 * delays startup. The freshly-spawned engine is never at risk: it is parented
 * to the current, living host, so the parent-alive check skips it.
 */
export function reapOrphanEnginesOnStartup(log?: (msg: string) => void): void {
  setTimeout(() => {
    try {
      const reaped = reapOrphanEngines({ ...productionDeps, log });
      if (reaped.length > 0) {
        log?.(`[engine-reaper] startup reap complete — killed ${reaped.length} orphaned engine(s): ${reaped.join(", ")}`);
      }
    } catch (err) {
      log?.(`[engine-reaper] startup reap error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 0);
}
