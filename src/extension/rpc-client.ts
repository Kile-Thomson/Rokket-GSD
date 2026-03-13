import { ChildProcess, spawn, spawnSync } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";

// ============================================================
// RPC Client — Manages GSD child process via JSON-RPC over stdin/stdout
// ============================================================

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
function resolveGsdPath(hint?: string): { command: string; args: string[]; useShell: boolean } {
  // If user provided an explicit path, use it directly
  if (hint && hint !== "gsd") {
    // If it's a .cmd file, parse it; otherwise assume it's directly executable
    if (process.platform === "win32" && hint.toLowerCase().endsWith(".cmd")) {
      const entry = parseWindowsCmdWrapper(hint);
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
    return resolveGsdWindows();
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
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
      if (firstMatch && fs.existsSync(firstMatch)) {
        return firstMatch;
      }
    }
  } catch { /* ignored */ }

  // Fallback: assume node is on PATH
  return "node";
}

function resolveGsdWindows(): { command: string; args: string[]; useShell: boolean } {
  // Find the .cmd wrapper
  let cmdPath: string | null = null;
  try {
    const result = spawnSync("where", ["gsd.cmd"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
      if (firstMatch && fs.existsSync(firstMatch)) {
        cmdPath = firstMatch;
      }
    }
  } catch { /* ignored */ }

  if (!cmdPath) {
    // Try without .cmd extension
    try {
      const result = spawnSync("where", ["gsd"], {
        encoding: "utf-8",
        timeout: 5000,
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
    } catch { /* ignored */ }
  }

  if (cmdPath) {
    // Parse the .cmd to find the actual node entry point
    const entry = parseWindowsCmdWrapper(cmdPath);
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
function parseWindowsCmdWrapper(cmdPath: string): string | null {
  try {
    const content = fs.readFileSync(cmdPath, "utf-8");
    // Match the pattern: "%_prog%" "path\to\entry.js" %*
    // or: "%_prog%" "%dp0%\path\to\entry.js" %*
    const match = content.match(/"%_prog%"\s+"([^"]+)"\s+%\*/);
    if (match) {
      let entryPath = match[1];
      // Replace %dp0% with the directory of the .cmd file
      const cmdDir = path.dirname(cmdPath);
      entryPath = entryPath.replace(/%dp0%\\/gi, "").replace(/%dp0%/gi, "");
      const fullPath = path.resolve(cmdDir, entryPath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  } catch { /* ignored */ }
  return null;
}

function resolveGsdUnix(): { command: string; args: string[]; useShell: boolean } {
  try {
    const result = spawnSync("which", ["gsd"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.status === 0 && result.stdout) {
      const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
      if (firstMatch && fs.existsSync(firstMatch)) {
        return { command: firstMatch, args: [], useShell: false };
      }
    }
  } catch { /* ignored */ }

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

    const resolved = resolveGsdPath(options.gsdPath);
    // Log the resolved spawn command for diagnostics
    this.emit("log", `[rpc-client] Spawn: ${resolved.command} ${resolved.args.join(" ")} --mode rpc (shell: ${resolved.useShell})\n`);
    const args = [...resolved.args, "--mode", "rpc"];

    if (options.sessionDir) {
      args.push("--session-dir", options.sessionDir);
    }

    const env = {
      ...process.env,
      ...(options.env || {}),
      // Force color output off for RPC
      NO_COLOR: "1",
      FORCE_COLOR: "0",
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

    // Read stdout line by line (JSONL)
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
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
      if (this._stderrBuffer.length > 2048) {
        this._stderrBuffer = this._stderrBuffer.slice(-2048);
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
      this.emit("error", err);
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
        setTimeout(resolve, 500);
      }, 5000);

      this.process!.on("exit", () => {
        clearTimeout(forceTimeout);
        resolve();
      });

      // Step 1: Try graceful abort via RPC
      try {
        this.send({ type: "abort" });
      } catch { /* ignored */ }

      // Step 2: SIGTERM after 1s if still alive
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGTERM");
        }
      }, 1000);
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
      } catch { /* ignored */ }
    } else {
      // Unix: kill the process group (negative PID)
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Fallback: kill just the process
        try {
          process.kill(pid, "SIGKILL");
        } catch { /* ignored */ }
      }
    }

    // Also try via the ChildProcess handle
    try {
      this.process?.kill("SIGKILL");
    } catch { /* ignored */ }
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

    // Long-running commands get no timeout; others get 60s default
    const noTimeoutCommands = ["prompt", "steer", "follow_up", "compact"];
    const effectiveTimeout = timeoutMs ?? (noTimeoutCommands.includes(command.type as string) ? 0 : 60000);

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

  async prompt(message: string, images?: Array<{ type: "image"; data: string; mimeType: string }>, streamingBehavior?: "steer" | "followUp"): Promise<void> {
    const cmd: Record<string, unknown> = { type: "prompt", message };
    if (images?.length) cmd.images = images;
    if (streamingBehavior) cmd.streamingBehavior = streamingBehavior;
    await this.request(cmd);
  }

  async steer(message: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void> {
    const cmd: Record<string, unknown> = { type: "steer", message };
    if (images?.length) cmd.images = images;
    await this.request(cmd);
  }

  async followUp(message: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void> {
    const cmd: Record<string, unknown> = { type: "follow_up", message };
    if (images?.length) cmd.images = images;
    await this.request(cmd);
  }

  async abort(): Promise<void> {
    await this.request({ type: "abort" });
  }

  async getState(): Promise<unknown> {
    return await this.request({ type: "get_state" });
  }

  async getMessages(): Promise<unknown> {
    return await this.request({ type: "get_messages" });
  }

  async setModel(provider: string, modelId: string): Promise<unknown> {
    return await this.request({ type: "set_model", provider, modelId });
  }

  async setThinkingLevel(level: string): Promise<void> {
    await this.request({ type: "set_thinking_level", level });
  }

  async newSession(): Promise<unknown> {
    return await this.request({ type: "new_session" });
  }

  async compact(customInstructions?: string): Promise<unknown> {
    const cmd: Record<string, unknown> = { type: "compact" };
    if (customInstructions) cmd.customInstructions = customInstructions;
    return await this.request(cmd);
  }

  async getCommands(): Promise<unknown> {
    return await this.request({ type: "get_commands" });
  }

  async getSessionStats(): Promise<unknown> {
    return await this.request({ type: "get_session_stats" });
  }

  async getAvailableModels(): Promise<unknown> {
    return await this.request({ type: "get_available_models" });
  }

  async cycleThinkingLevel(): Promise<unknown> {
    return await this.request({ type: "cycle_thinking_level" });
  }

  async exportHtml(outputPath?: string): Promise<unknown> {
    const cmd: Record<string, unknown> = { type: "export_html" };
    if (outputPath) cmd.outputPath = outputPath;
    return await this.request(cmd);
  }

  async executeBash(command: string): Promise<unknown> {
    return await this.request({ type: "bash", command });
  }

  async switchSession(sessionPath: string): Promise<unknown> {
    return await this.request({ type: "switch_session", sessionPath });
  }

  async setSessionName(name: string): Promise<void> {
    await this.request({ type: "set_session_name", name });
  }

  async fork(entryId: string): Promise<unknown> {
    return await this.request({ type: "fork", entryId });
  }

  async cycleModel(): Promise<unknown> {
    return await this.request({ type: "cycle_model" });
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    await this.request({ type: "set_auto_compaction", enabled });
  }

  async setAutoRetry(enabled: boolean): Promise<void> {
    await this.request({ type: "set_auto_retry", enabled });
  }

  async abortRetry(): Promise<void> {
    await this.request({ type: "abort_retry" });
  }

  async abortBash(): Promise<void> {
    await this.request({ type: "abort_bash" });
  }

  async getLastAssistantText(): Promise<unknown> {
    return await this.request({ type: "get_last_assistant_text" });
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
  async ping(timeoutMs: number = 10000): Promise<boolean> {
    if (!this._isRunning || !this.process) return false;
    try {
      await this.request({ type: "get_state" }, timeoutMs);
      return true;
    } catch {
      return false;
    }
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
          pending.reject(new Error(msg.error as string || "Unknown RPC error"));
        }
      }
      // Drop responses without a matching pending request (e.g. late responses
      // from timed-out pings) — don't forward them as events
      return;
    }

    // Everything else is an event — forward to listeners
    this.emit("event", msg);
  }
}
