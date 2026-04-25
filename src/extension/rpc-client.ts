import { ChildProcess, spawn, spawnSync } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import {
  MAX_STDOUT_BUFFER_BYTES,
  MAX_STDERR_BUFFER_BYTES,
  RPC_DEFAULT_TIMEOUT_MS,
  RPC_COMPACT_TIMEOUT_MS,
  RPC_INIT_TIMEOUT_MS,
  RPC_PING_TIMEOUT_MS,
  EXEC_TIMEOUT_MS,
  STOP_SIGTERM_DELAY_MS,
  STOP_FORCE_KILL_DELAY_MS,
  STOP_POST_KILL_SETTLE_MS,
} from "../shared/constants";

// ============================================================
// RPC Client — Manages GSD child process via JSON-RPC over stdin/stdout
// ============================================================

/**
 * Strip Electron/VS Code extension host env vars that shouldn't leak into
 * GSD's process tree. When the extension host spawns GSD, process.env contains
 * Electron-specific variables (ELECTRON_RUN_AS_NODE, NODE_OPTIONS with --require
 * hooks, VSCODE_* internals, etc.). If these propagate to grandchild processes
 * like `next dev`, `lightningcss`, or `tailwindcss` workers, they can cause:
 *   - Infinite process spawn loops (144+ node processes, OOM)
 *   - DEP0190 warnings from shell: true + args
 *   - Worker processes crash-restarting due to unexpected --require hooks
 *   - Playwright/Chromium launch failures
 */
export function sanitizeEnvForChildProcess(env: NodeJS.ProcessEnv): Record<string, string> {
  const cleaned: Record<string, string> = {};

  // Prefixes/exact keys to strip — these are Electron/VS Code internals
  // that should never reach user project subprocesses
  const stripExact = new Set([
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_NO_ASAR",
    "ELECTRON_ENABLE_LOGGING",
    "ELECTRON_LOG_FILE",
    "ELECTRON_FORCE_WINDOW_MENU_BAR",
    "GOOGLE_API_KEY",          // Electron's internal API key, not the user's
    "NODE_OPTIONS",            // VS Code injects --require hooks that break child processes
    "NODE_EXTRA_CA_CERTS",     // Can cause TLS issues in child processes
    "VSCODE_CWD",
    "VSCODE_HANDLES_UNCAUGHT_ERRORS",
    "VSCODE_IPC_HOOK",
    "VSCODE_NLS_CONFIG",
    "VSCODE_PID",
    "VSCODE_CRASH_REPORTER_PROCESS_TYPE",
    "VSCODE_AMD_ENTRYPOINT",
    "VSCODE_PIPE_LOGGING",
    "VSCODE_VERBOSE_LOGGING",
    "VSCODE_LOG_NATIVE",
    "VSCODE_LOG_LEVEL",
    "VSCODE_PORTABLE",
    "VSCODE_LOG_STACK",
    "VSCODE_NODE_CACHED_DATA_DIR",
    "VSCODE_LOGS",
    "VSCODE_INSPECTOR_OPTIONS",
    "ORIGINAL_XDG_CURRENT_DESKTOP",  // Set by Electron on Linux
    "GDK_BACKEND",                   // Set by Electron on Linux
    "CHROME_DESKTOP",                // Set by Electron
  ]);

  const stripPrefixes = [
    "VSCODE_",
    "ELECTRON_",
  ];

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (stripExact.has(key)) continue;
    if (stripPrefixes.some(prefix => key.startsWith(prefix))) continue;
    cleaned[key] = value;
  }

  return cleaned;
}

/**
 * Resolve the GSD executable for direct invocation without shell wrappers.
 *
 * On Windows, npm installs a `.cmd` wrapper that just calls `node <entry>.js`.
 * Using `shell: true` to run .cmd files creates an extra cmd.exe process that
 * breaks signal propagation, triggers Node 22 DEP0190 warnings, and fails
 * when the path contains spaces (common in `C:\Users\First Last\...`).
 *
 * Instead, we parse the .cmd wrapper to find the actual Node.js entry point
 * and invoke it directly: `node <entry.js> --mode rpc`.
 *
 * On Unix, `gsd` is typically a direct symlink to a JS file with a shebang,
 * so we can run it directly.
 */
async function resolveGsdPath(hint?: string): Promise<{ command: string; args: string[]; useShell: boolean }> {
  // If user provided an explicit path, use it directly
  if (hint && hint !== "gsd") {
    // If it's a .cmd file, parse it; otherwise assume it's directly executable
    if (process.platform === "win32" && hint.toLowerCase().endsWith(".cmd")) {
      const entry = await parseWindowsCmdWrapper(hint);
      if (entry) {
        const nodePath = findNodeBinary();
        return { command: nodePath, args: [entry], useShell: false };
      }
      // Couldn't parse .cmd — must use shell to execute it
      return { command: hint, args: [], useShell: true };
    }
    return { command: hint, args: [], useShell: false };
  }

  if (process.platform === "win32") {
    return await resolveGsdWindows();
  }

  return resolveGsdUnix();
}

/**
 * Find the Node.js binary path.
 * In VS Code extension host, `process.execPath` is Electron, not Node.
 * We need the actual `node` binary to run GSD's JS entry point.
 */
function findNodeBinary(): string {
  // Try to find node via `where` (Windows) or `which` (Unix)
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(cmd, ["node"], {
      encoding: "utf-8",
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
      if (firstMatch && fs.existsSync(firstMatch)) {
        return firstMatch;
      }
    }
  } catch (err: unknown) {
    // Resolution failed — log but continue to fallback
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rpc-client] findNodeBinary: "where node" failed: ${msg}`);
  }

  // Fallback: assume node is on PATH
  return "node";
}

async function resolveGsdWindows(): Promise<{ command: string; args: string[]; useShell: boolean }> {
  // Find the .cmd wrapper
  let cmdPath: string | null = null;
  try {
    const result = spawnSync("where", ["gsd.cmd"], {
      encoding: "utf-8",
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
      if (firstMatch && fs.existsSync(firstMatch)) {
        cmdPath = firstMatch;
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rpc-client] resolveGsdWindows: "where gsd.cmd" failed: ${msg}`);
  }

  if (!cmdPath) {
    // Try without .cmd extension
    try {
      const result = spawnSync("where", ["gsd"], {
        encoding: "utf-8",
        timeout: EXEC_TIMEOUT_MS,
        windowsHide: true,
      });
      if (result.status === 0 && result.stdout) {
        const lines = result.stdout.trim().split(/\r?\n/);
        for (const line of lines) {
          if (line.toLowerCase().endsWith(".cmd") && fs.existsSync(line)) {
            cmdPath = line;
            break;
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[rpc-client] resolveGsdWindows: "where gsd" failed: ${msg}`);
    }
  }

  if (cmdPath) {
    // Parse the .cmd to find the actual node entry point
    const entry = await parseWindowsCmdWrapper(cmdPath);
    if (entry) {
      const nodePath = findNodeBinary();
      return { command: nodePath, args: [entry], useShell: false };
    }
    // Couldn't parse — fall back to .cmd with shell
    return { command: cmdPath, args: [], useShell: true };
  }

  // Last resort: "gsd" with shell
  return { command: "gsd", args: [], useShell: true };
}

/**
 * Parse an npm-generated .cmd wrapper to extract the JS entry point.
 * npm .cmd wrappers follow a known pattern ending with:
 *   "%_prog%" "%dp0%\path\to\entry.js" %*
 */
async function parseWindowsCmdWrapper(cmdPath: string): Promise<string | null> {
  try {
    const content = await fs.promises.readFile(cmdPath, "utf-8");
    // Match the pattern: "%_prog%" "path\to\entry.js" %*
    // or: "%_prog%" "%dp0%\path\to\entry.js" %*
    const match = content.match(/"%_prog%"\s+"([^"]+)"\s+%\*/);
    if (match) {
      let entryPath = match[1];
      // Replace %dp0% with the directory of the .cmd file
      const cmdDir = path.dirname(cmdPath);
      entryPath = entryPath.replace(/%dp0%\\/gi, "").replace(/%dp0%/gi, "");
      const fullPath = path.resolve(cmdDir, entryPath);
      try {
        await fs.promises.access(fullPath);
        return fullPath;
      } catch {
        return null;
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rpc-client] parseWindowsCmdWrapper: failed to parse ${cmdPath}: ${msg}`);
  }
  return null;
}

function resolveGsdUnix(): { command: string; args: string[]; useShell: boolean } {
  try {
    const result = spawnSync("which", ["gsd"], {
      encoding: "utf-8",
      timeout: EXEC_TIMEOUT_MS,
    });
    if (result.status === 0 && result.stdout) {
      const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
      if (firstMatch && fs.existsSync(firstMatch)) {
        return { command: firstMatch, args: [], useShell: false };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rpc-client] resolveGsdUnix: "which gsd" failed: ${msg}`);
  }

  // Fallback: hope it's on PATH
  return { command: "gsd", args: [], useShell: false };
}

export interface RpcEvent {
  type: string;
  [key: string]: unknown;
}

export interface RpcResponse {
  type: "response";
  id?: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * JSON-RPC client for communicating with the gsd-pi child process.
 *
 * Manages the gsd-pi process lifecycle (spawn, restart, stop, force-kill) and
 * provides a request/response API over JSONL on stdin/stdout. Emits events for
 * streaming data (`"event"`), process lifecycle (`"exit"`, `"error"`), and
 * diagnostic logging (`"log"`).
 *
 * The client handles:
 * - Sanitized environment variables (strips Electron/VS Code internals)
 * - Windows .cmd wrapper resolution for direct Node.js invocation
 * - Request timeout management (indefinite for agent turns, 60s for control commands)
 * - 10MB stdout buffer cap to prevent OOM from runaway output
 * - Graceful stop escalation: abort → SIGTERM → process tree kill
 */
export class GsdRpcClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private requestId: number = 0;
  private pendingRequests: Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }> = new Map();
  private _isRunning: boolean = false;
  private _lastStartOptions: {
    cwd: string;
    gsdPath?: string;
    env?: Record<string, string>;
    sessionDir?: string;
  } | null = null;
  private _stderrBuffer: string = "";
  private _pid: number | null = null;
  private _protocolVersion: 1 | 2 = 1;

  /** The negotiated RPC protocol version (1 = legacy, 2 = v2 with runId/cost_update/execution_complete). */
  get protocolVersion(): 1 | 2 {
    return this._protocolVersion;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  /** PID of the GSD child process, or null if not running. */
  get pid(): number | null {
    return this._pid;
  }

  /**
   * Spawn the GSD process in RPC mode.
   */
  async start(options: {
    cwd: string;
    gsdPath?: string;
    env?: Record<string, string>;
    sessionDir?: string;
  }): Promise<void> {
    if (this.process) {
      await this.stop();
    }

    this._lastStartOptions = { ...options };
    this._stderrBuffer = "";

    const resolved = await resolveGsdPath(options.gsdPath);
    // Log the resolved spawn command for diagnostics
    this.emit("log", `[rpc-client] Spawn: ${resolved.command} ${resolved.args.join(" ")} --mode rpc (shell: ${resolved.useShell})\n`);
    const args = [...resolved.args, "--mode", "rpc"];

    if (options.sessionDir) {
      args.push("--session-dir", options.sessionDir);
    }

    const env = {
      ...sanitizeEnvForChildProcess(process.env),
      ...(options.env || {}),
      // Force color output off for RPC
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      // Signal to extensions that we're running inside the IDE (not CLI TUI)
      GSD_IDE: "1",
    };

    this.process = spawn(resolved.command, args, {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: resolved.useShell,
      windowsHide: true,
    });

    this._pid = this.process.pid ?? null;

    this._isRunning = true;
    this.buffer = "";
    this._protocolVersion = 1;

    // Read stdout line by line (JSONL) — cap buffer at 10MB to prevent OOM
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      if (this.buffer.length > MAX_STDOUT_BUFFER_BYTES) {
        // Preserve any partial line (data after the last newline) so the
        // JSON-RPC stream can resync once the next newline arrives.
        const lastNl = this.buffer.lastIndexOf("\n");
        const partial = lastNl === -1 ? "" : this.buffer.slice(lastNl + 1);
        this.emit("log", `[rpc-client] Buffer exceeded ${MAX_STDOUT_BUFFER_BYTES / 1024 / 1024}MB — truncating (possible runaway output). Preserving ${partial.length} bytes of partial line.`);
        this.buffer = partial;
      }
      this.processBuffer();
    });

    // Handle stream errors (broken pipe, etc.) — without this they become unhandled errors
    this.process.stdout?.on("error", (err) => {
      this.emit("log", `[rpc-client] stdout error: ${err.message}\n`);
    });
    this.process.stderr?.on("error", (err) => {
      this.emit("log", `[rpc-client] stderr error: ${err.message}\n`);
    });

    // Forward stderr as log events and buffer for diagnostics
    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      // Keep last 2KB of stderr for exit diagnostics
      this._stderrBuffer += text;
      if (this._stderrBuffer.length > MAX_STDERR_BUFFER_BYTES) {
        this._stderrBuffer = this._stderrBuffer.slice(-MAX_STDERR_BUFFER_BYTES);
      }
      this.emit("log", text);
    });

    this.process.on("exit", (code, signal) => {
      this._isRunning = false;
      this._pid = null;

      // Build a more descriptive error message
      const stderrHint = this._stderrBuffer.trim();
      let detail = `GSD process exited (code=${code}, signal=${signal})`;
      if (stderrHint) {
        // Take the last meaningful line from stderr
        const lines = stderrHint.split(/\r?\n/).filter(Boolean);
        const lastLine = lines[lines.length - 1] || "";
        if (lastLine) {
          detail += `: ${lastLine}`;
        }
      }

      this.emit("exit", { code, signal, detail });

      // Reject all pending requests with the enriched error
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(detail));
      }
      this.pendingRequests.clear();
      this.process = null;
    });

    this.process.on("error", (err) => {
      this._isRunning = false;
      this._pid = null;
      this.emit("error", err);

      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`GSD process error: ${err.message}`));
      }
      this.pendingRequests.clear();
      this.process = null;
    });
  }

  /**
   * Restart the GSD process using the last start options.
   * Returns true if restart succeeded, false if no previous options available.
   */
  async restart(): Promise<boolean> {
    if (!this._lastStartOptions) {
      return false;
    }
    await this.stop();
    await this.start(this._lastStartOptions);
    return true;
  }

  /**
   * Stop the GSD process.
   * Escalation: abort command → SIGTERM → forceKill (process tree kill)
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    return new Promise((resolve) => {
      // Final escalation: force kill the entire process tree
      const forceTimeout = setTimeout(() => {
        this.forceKill();
        // Give forceKill a moment to work, then resolve regardless
        setTimeout(resolve, STOP_POST_KILL_SETTLE_MS);
      }, STOP_FORCE_KILL_DELAY_MS);

      this.process!.on("exit", () => {
        clearTimeout(forceTimeout);
        resolve();
      });

      // Step 1: Try graceful abort via RPC
      try {
        this.send({ type: "abort" });
      } catch {
        // Process stdin may already be closed — proceed to SIGTERM
      }

      // Step 2: SIGTERM after 1s if still alive
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGTERM");
        }
      }, STOP_SIGTERM_DELAY_MS);
    });
  }

  /**
   * Force-kill the GSD process and its entire process tree.
   * Use this when the process is unresponsive and graceful stop has failed.
   * This is the nuclear option — kills everything including grandchild bash processes.
   */
  forceKill(): void {
    const pid = this._pid;
    if (!pid) return;

    if (process.platform === "win32") {
      // taskkill /F (force) /T (tree — kills all child processes)
      try {
        spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit("log", `[rpc-client] forceKill: taskkill failed for PID ${pid}: ${msg}`);
      }
    } else {
      // Unix: kill the process group (negative PID)
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Fallback: kill just the process
        try {
          process.kill(pid, "SIGKILL");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.emit("log", `[rpc-client] forceKill: kill failed for PID ${pid}: ${msg}`);
        }
      }
    }

    // Also try via the ChildProcess handle
    try {
      this.process?.kill("SIGKILL");
    } catch { /* process already dead — expected */ }
  }

  /**
   * Send a raw command to the GSD process.
   */
  send(command: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) {
      throw new Error("[GSD-ERR-021] GSD process is not running — cannot send command");
    }

    const line = JSON.stringify(command) + "\n";
    this.process.stdin.write(line);
  }

  /**
   * Send a command and wait for its response.
   * 
   * Timeout handling:
   * - "prompt", "steer", "follow_up" use no timeout (agent turns can run indefinitely)
   * - All other commands use a 60-second timeout
   */
  async request(command: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const id = `req-${++this.requestId}`;
    const commandWithId = { ...command, id };

    // User-interactive commands get no timeout (watchdog-covered); others get defaults
    const noTimeoutCommands = ["prompt", "steer", "follow_up"];
    const longTimeoutCommands: Record<string, number> = { compact: RPC_COMPACT_TIMEOUT_MS, get_messages: RPC_DEFAULT_TIMEOUT_MS };
    const effectiveTimeout = timeoutMs
      ?? (noTimeoutCommands.includes(command.type as string) ? 0
        : longTimeoutCommands[command.type as string] ?? RPC_DEFAULT_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        this.pendingRequests.delete(id);
      };

      this.pendingRequests.set(id, {
        resolve: (data) => {
          cleanup();
          resolve(data);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      });

      if (effectiveTimeout > 0) {
        timeoutHandle = setTimeout(() => {
          cleanup();
          reject(new Error(`[GSD-ERR-020] Request timed out after ${effectiveTimeout / 1000}s: ${command.type}`));
        }, effectiveTimeout);
      }

      try {
        this.send(commandWithId);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  // --- Convenience methods matching RPC protocol ---

  /**
   * Send a user prompt to the agent and wait for the response.
   * @param message - The user's text message
   * @param images - Optional image attachments (base64-encoded)
   * @param streamingBehavior - Optional override: `"steer"` to interrupt, `"followUp"` to queue after current turn
   */
  async prompt(message: string, images?: Array<{ type: "image"; data: string; mimeType: string }>, streamingBehavior?: "steer" | "followUp"): Promise<string | undefined> {
    const cmd: Record<string, unknown> = { type: "prompt", message };
    if (images?.length) cmd.images = images;
    if (streamingBehavior) cmd.streamingBehavior = streamingBehavior;
    const result = await this.request(cmd) as Record<string, unknown> | undefined;
    return result?.runId as string | undefined;
  }

  /** Send a steering message that interrupts the current agent turn with new instructions. */
  async steer(message: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<string | undefined> {
    const cmd: Record<string, unknown> = { type: "steer", message };
    if (images?.length) cmd.images = images;
    const result = await this.request(cmd) as Record<string, unknown> | undefined;
    return result?.runId as string | undefined;
  }

  /** Send a follow-up message that queues after the current agent turn completes. */
  async followUp(message: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<string | undefined> {
    const cmd: Record<string, unknown> = { type: "follow_up", message };
    if (images?.length) cmd.images = images;
    const result = await this.request(cmd) as Record<string, unknown> | undefined;
    return result?.runId as string | undefined;
  }

  /** Abort the current agent turn. Resolves when the abort is acknowledged. */
  async abort(): Promise<void> {
    await this.request({ type: "abort" });
  }

  /** Fetch the current session state (model, streaming status, session info). Returns `RpcStateResult`. */
  async getState(): Promise<unknown> {
    return await this.request({ type: "get_state" });
  }

  /** Fetch all messages in the current session. Returns an array of `AgentMessage`. */
  async getMessages(): Promise<unknown> {
    return await this.request({ type: "get_messages" });
  }

  /** Change the active model. */
  async setModel(provider: string, modelId: string): Promise<unknown> {
    return await this.request({ type: "set_model", provider, modelId });
  }

  /** Set the thinking budget level. PI CLI expects `level` field. */
  async setThinkingLevel(level: string): Promise<void> {
    await this.request({ type: "set_thinking_level", level });
  }

  /** Create a new empty session, discarding the current conversation. */
  async newSession(): Promise<unknown> {
    return await this.request({ type: "new_session" });
  }

  /** Trigger context compaction with optional custom instructions. */
  async compact(customInstructions?: string): Promise<unknown> {
    const cmd: Record<string, unknown> = { type: "compact" };
    if (customInstructions) cmd.customInstructions = customInstructions;
    return await this.request(cmd);
  }

  /** Fetch the list of available slash commands. */
  async getCommands(): Promise<unknown> {
    return await this.request({ type: "get_commands" });
  }

  /** Fetch session cost and token usage statistics. Returns `SessionStats`-shaped data. */
  async getSessionStats(): Promise<unknown> {
    return await this.request({ type: "get_session_stats" });
  }

  /** Fetch all models available from configured providers. */
  async getAvailableModels(): Promise<unknown> {
    return await this.request({ type: "get_available_models" });
  }

  /** Cycle to the next thinking level and return the new level. */
  async cycleThinkingLevel(): Promise<unknown> {
    return await this.request({ type: "cycle_thinking_level" });
  }

  /** Execute a bash command in the agent's working directory. */
  async executeBash(command: string): Promise<unknown> {
    return await this.request({ type: "bash", command });
  }

  /** Switch to a different session by its JSONL file path. Returns the new session state. */
  async switchSession(sessionPath: string): Promise<unknown> {
    return await this.request({ type: "switch_session", sessionPath });
  }

  /** Rename the current session. */
  async setSessionName(name: string): Promise<void> {
    await this.request({ type: "set_session_name", name });
  }

  /** Enable or disable automatic context compaction. */
  async setAutoCompaction(enabled: boolean): Promise<void> {
    await this.request({ type: "set_auto_compaction", enabled });
  }

  /** Enable or disable automatic retry on transient errors. */
  async setAutoRetry(enabled: boolean): Promise<void> {
    await this.request({ type: "set_auto_retry", enabled });
  }

  /** Cancel a pending auto-retry. */
  async abortRetry(): Promise<void> {
    await this.request({ type: "abort_retry" });
  }

  /** Set steering message delivery mode: `"all"` sends immediately, `"one-at-a-time"` queues. */
  async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
    await this.request({ type: "set_steering_mode", mode });
  }

  /** Set follow-up message delivery mode: `"all"` sends immediately, `"one-at-a-time"` queues. */
  async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
    await this.request({ type: "set_follow_up_mode", mode });
  }

  /**
   * Send an extension_ui_response back to the GSD process.
   */
  sendExtensionUiResponse(response: {
    type: "extension_ui_response";
    id: string;
    value?: string;
    values?: string[];
    confirmed?: boolean;
    cancelled?: boolean;
  }): void {
    this.send(response);
  }

  /**
   * Lightweight health check — sends get_state with a short timeout.
   * Returns true if the process responds, false if it times out or errors.
   * Does NOT throw on failure.
   */
  async ping(timeoutMs: number = RPC_PING_TIMEOUT_MS): Promise<boolean> {
    if (!this._isRunning || !this.process) return false;
    try {
      await this.request({ type: "get_state" }, timeoutMs);
      return true;
    } catch {
      // get_state failed — process is not responding
      return false;
    }
  }

  // --- v2 Protocol & New Commands (gsd-pi 2.41–2.58) ---

  /**
   * Negotiate RPC protocol v2. Must be sent as the very first command after start().
   * Returns the init result on success, or null if the server doesn't support v2
   * (falls back to v1 silently). Does NOT throw.
   */
  async initV2(clientId?: string): Promise<{ protocolVersion: 2; sessionId: string; capabilities: { events: string[]; commands: string[] } } | null> {
    try {
      const cmd: Record<string, unknown> = { type: "init", protocolVersion: 2 };
      if (clientId) cmd.clientId = clientId;
      const result = await this.request(cmd, RPC_INIT_TIMEOUT_MS) as Record<string, unknown> | undefined;
      if (result?.protocolVersion === 2) {
        this._protocolVersion = 2;
        return result as { protocolVersion: 2; sessionId: string; capabilities: { events: string[]; commands: string[] } };
      }
      return null;
    } catch {
      // Server doesn't support v2 — stay on v1
      return null;
    }
  }

  /** Request a graceful shutdown of the GSD process. */
  async shutdown(): Promise<void> {
    await this.request({ type: "shutdown" });
  }

  /** Subscribe to specific event types (v2 only). Pass `["*"]` for all events. */
  async subscribe(events: string[]): Promise<void> {
    await this.request({ type: "subscribe", events });
  }

  /** Get the text content of the last assistant message. */
  async getLastAssistantText(): Promise<unknown> {
    return await this.request({ type: "get_last_assistant_text" });
  }

  /** Abort a running bash command. */
  async abortBash(): Promise<void> {
    await this.request({ type: "abort_bash" });
  }

  /** Cycle to the next model in the model registry. */
  async cycleModel(): Promise<unknown> {
    return await this.request({ type: "cycle_model" });
  }

  // --- Internal ---

  private processBuffer(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      // Strip optional \r
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        this.handleMessage(parsed);
      } catch {
        this.emit("log", `Failed to parse RPC message: ${line}`);
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Check if this is a response to a pending request
    if (msg.type === "response" && msg.id) {
      const pending = this.pendingRequests.get(msg.id as string);
      if (pending) {
        if (msg.success) {
          pending.resolve(msg.data);
        } else {
          this.emit("log", `[rpc-client] RPC error response: ${msg.command} — ${msg.error}\n`);
          pending.reject(new Error(msg.error as string || "Unknown RPC error"));
        }
      } else if (!msg.success && msg.error) {
        // Second response for an already-resolved request (e.g. gsd-pi sends
        // ack followed by error). Forward as an error event so the UI can show it.
        this.emit("log", `[rpc-client] Late error for ${msg.command}: ${msg.error}\n`);
        this.emit("event", { type: "error", message: msg.error });
      }
      return;
    }

    // Everything else is an event — forward to listeners
    this.emit("event", msg);
  }
}
