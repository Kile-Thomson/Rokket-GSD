import * as net from "net";
import * as fs from "fs";
import type { TelegramApi, TelegramUpdate } from "./api";
import { redactToken } from "./api";
import { pollerPipeName, encodeMessage, parseLines, type PollerClientMessage } from "./poller-ipc";
import type { TopicManagerLogger } from "./topicManager";

/**
 * Shared poller server. Owns getUpdates for one bot token and
 * broadcasts all updates to connected IPC clients.
 */
export class PollerServer {
  private server: net.Server | null = null;
  private clients = new Set<net.Socket>();
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private offset: number | undefined;
  private consecutiveErrors = 0;
  private pollCount = 0;
  private readonly BASE_DELAY_MS = 2000;
  private readonly MAX_DELAY_MS = 30000;
  private readonly pipeName: string;

  constructor(
    private readonly api: TelegramApi,
    private readonly botToken: string,
    private readonly logger: TopicManagerLogger,
  ) {
    this.pipeName = pollerPipeName(botToken);
  }

  /**
   * Try to bind the named pipe. Returns true if this instance
   * became the server, false if the pipe is already taken.
   */
  async tryStart(): Promise<boolean> {
    // Clean up stale Unix socket files (Windows named pipes clean themselves)
    if (process.platform !== "win32") {
      try { fs.unlinkSync(this.pipeName); } catch { /* doesn't exist */ }
    }

    return new Promise<boolean>((resolve) => {
      const server = net.createServer((socket) => this.onClientConnect(socket));

      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" || err.code === "ERR_SERVER_ALREADY_LISTEN") {
          resolve(false);
        } else {
          this.logger.warn(`[poller-server] Listen error: ${err.message}`);
          resolve(false);
        }
      });

      server.listen(this.pipeName, () => {
        this.server = server;
        this.logger.info(`[poller-server] Listening on ${this.pipeName}`);
        this.running = true;
        this.poll();
        resolve(true);
      });
    });
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    // Clean up Unix socket file
    if (process.platform !== "win32") {
      try { fs.unlinkSync(this.pipeName); } catch { /* best effort */ }
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private onClientConnect(socket: net.Socket): void {
    this.clients.add(socket);
    this.logger.info(`[poller-server] Client connected (total: ${this.clients.size})`);

    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      const { messages, remainder } = parseLines(buffer);
      buffer = remainder;
      for (const raw of messages) {
        try {
          const msg = JSON.parse(raw) as PollerClientMessage;
          if (msg.type === "ping") {
            socket.write(encodeMessage({ type: "pong" }));
          }
        } catch { /* malformed, ignore */ }
      }
    });

    socket.on("close", () => {
      this.clients.delete(socket);
      this.logger.info(`[poller-server] Client disconnected (total: ${this.clients.size})`);
    });

    socket.on("error", () => {
      this.clients.delete(socket);
    });
  }

  private broadcast(updates: TelegramUpdate[]): void {
    if (this.clients.size === 0) return;
    const msg = encodeMessage({ type: "updates", updates });
    for (const client of this.clients) {
      try {
        client.write(msg);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private getBackoffDelay(lastErrorMessage?: string): number {
    const exponential = Math.min(
      this.BASE_DELAY_MS * Math.pow(2, this.consecutiveErrors),
      this.MAX_DELAY_MS,
    );
    const jitter = Math.floor(Math.random() * 1000);
    let delay = exponential + jitter;

    const retryMatch = lastErrorMessage?.match(/retry after (\d+)s/);
    if (retryMatch) {
      const retryAfterMs = parseInt(retryMatch[1], 10) * 1000;
      delay = Math.max(delay, retryAfterMs);
    }

    return delay;
  }

  private poll(): void {
    if (!this.running) return;

    this.pollCount++;
    if (this.pollCount % 30 === 1) {
      this.logger.info(`[poller-server] Poll #${this.pollCount} (offset=${this.offset ?? "none"}, clients=${this.clients.size})`);
    }

    let lastErrorMessage: string | undefined;
    this.api
      .getUpdates(this.offset)
      .then((updates) => {
        this.consecutiveErrors = 0;
        if (updates.length > 0) {
          // Advance offset
          for (const u of updates) {
            this.offset = u.update_id + 1;
          }
          this.logger.info(`[poller-server] Poll got ${updates.length} update(s), broadcasting to ${this.clients.size} client(s)`);
          this.broadcast(updates);
        }
      })
      .catch((err: unknown) => {
        this.consecutiveErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        lastErrorMessage = msg;
        const delay = this.getBackoffDelay(msg);
        this.logger.info(
          `[poller-server] getUpdates error (attempt ${this.consecutiveErrors}, backoff ${delay}ms): ${redactToken(msg, this.botToken)}`,
        );
      })
      .finally(() => {
        if (this.running) {
          const delay = this.consecutiveErrors > 0
            ? this.getBackoffDelay(lastErrorMessage)
            : this.BASE_DELAY_MS;
          this.pollTimer = setTimeout(() => this.poll(), delay);
        }
      });
  }
}
