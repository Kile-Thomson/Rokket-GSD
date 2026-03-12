import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";

// ============================================================
// RPC Client — Manages GSD child process via JSON-RPC over stdin/stdout
// ============================================================

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

  get isRunning(): boolean {
    return this._isRunning;
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

    const gsdPath = options.gsdPath || "gsd";
    const args = ["--mode", "rpc"];

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

    this.process = spawn(gsdPath, args, {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    this._isRunning = true;
    this.buffer = "";

    // Read stdout line by line (JSONL)
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      this.processBuffer();
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
      for (const [id, pending] of this.pendingRequests) {
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
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill("SIGKILL");
        resolve();
      }, 5000);

      this.process!.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      // Try graceful abort first
      try {
        this.send({ type: "abort" });
      } catch {}

      setTimeout(() => {
        this.process?.kill("SIGTERM");
      }, 1000);
    });
  }

  /**
   * Send a raw command to the GSD process.
   */
  send(command: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) {
      throw new Error("GSD process is not running");
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
          this.pendingRequests.delete(id);
          reject(new Error(`Request timed out after ${effectiveTimeout / 1000}s: ${command.type}`));
        }, effectiveTimeout);
      }

      this.send(commandWithId);
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

  async fork(entryId: string): Promise<unknown> {
    return await this.request({ type: "fork", entryId });
  }

  /**
   * Send an extension_ui_response back to the GSD process.
   */
  sendExtensionUiResponse(response: {
    type: "extension_ui_response";
    id: string;
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }): void {
    this.send(response);
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
      } catch (err) {
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
        return;
      }
    }

    // Everything else is an event — forward to listeners
    this.emit("event", msg);
  }
}
