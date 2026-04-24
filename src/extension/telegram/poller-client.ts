import * as net from "net";
import type { TelegramUpdate } from "./api";
import { pollerPipeName, encodeMessage, parseLines, type PollerServerMessage } from "./poller-ipc";
import type { TopicManagerLogger } from "./topicManager";

/**
 * IPC client that connects to a PollerServer and receives
 * broadcasted Telegram updates.
 */
export class PollerClient {
  private socket: net.Socket | null = null;
  private connected = false;
  private buffer = "";
  private readonly pipeName: string;
  private onUpdates: ((updates: TelegramUpdate[]) => void) | null = null;
  private onDisconnect: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    botToken: string,
    private readonly logger: TopicManagerLogger,
  ) {
    this.pipeName = pollerPipeName(botToken);
  }

  setOnUpdates(cb: (updates: TelegramUpdate[]) => void): void {
    this.onUpdates = cb;
  }

  setOnDisconnect(cb: () => void): void {
    this.onDisconnect = cb;
  }

  /**
   * Try to connect to the poller server. Returns true if connected.
   */
  async tryConnect(): Promise<boolean> {
    if (this.connected) return true;

    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection(this.pipeName, () => {
        this.socket = socket;
        this.connected = true;
        this.logger.info(`[poller-client] Connected to shared poller`);
        resolve(true);
      });

      socket.on("error", (err: NodeJS.ErrnoException) => {
        if (!this.connected) {
          resolve(false);
        } else {
          this.logger.info(`[poller-client] Socket error: ${err.message}`);
          this.handleDisconnect();
        }
      });

      socket.on("data", (data) => {
        this.buffer += data.toString("utf8");
        const { messages, remainder } = parseLines(this.buffer);
        this.buffer = remainder;
        for (const raw of messages) {
          try {
            const msg = JSON.parse(raw) as PollerServerMessage;
            if (msg.type === "updates" && this.onUpdates) {
              this.onUpdates(msg.updates as TelegramUpdate[]);
            }
          } catch { /* malformed, ignore */ }
        }
      });

      socket.on("close", () => {
        if (this.connected) {
          this.handleDisconnect();
        }
      });

      // Short timeout for connection attempt
      socket.setTimeout(2000, () => {
        if (!this.connected) {
          socket.destroy();
          resolve(false);
        }
      });
    });
  }

  private handleDisconnect(): void {
    this.connected = false;
    this.socket = null;
    this.buffer = "";
    this.logger.info(`[poller-client] Disconnected from shared poller`);
    this.onDisconnect?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
