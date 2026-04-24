import type { TelegramApi, TelegramUpdate } from "./api";
import type { TopicManagerLogger } from "./topicManager";
import { PollerServer } from "./poller-server";
import { PollerClient } from "./poller-client";

export type PollerRole = "server" | "client" | "idle";

/**
 * Coordinates shared polling across VS Code instances.
 *
 * On start: tries to bind the named pipe as server. If taken,
 * connects as a client. If the server goes away, tries to promote.
 *
 * Incoming updates are forwarded to the registered callback
 * regardless of role — the bridge doesn't care who polled them.
 */
export class PollerCoordinator {
  private server: PollerServer | null = null;
  private client: PollerClient | null = null;
  private role: PollerRole = "idle";
  private onUpdates: ((updates: TelegramUpdate[]) => void) | null = null;
  private promotionTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly PROMOTION_DELAY_MS = 3000;

  constructor(
    private readonly api: TelegramApi,
    private readonly botToken: string,
    private readonly logger: TopicManagerLogger,
  ) {}

  setOnUpdates(cb: (updates: TelegramUpdate[]) => void): void {
    this.onUpdates = cb;
  }

  async start(): Promise<void> {
    if (this.stopped) return;

    // Try to become the server
    const server = new PollerServer(this.api, this.botToken, this.logger);
    const bound = await server.tryStart();

    if (bound) {
      this.server = server;
      this.role = "server";
      this.logger.info(`[poller-coord] Role: server`);

      // Server also needs to receive its own updates locally.
      // The server broadcasts to IPC clients, but this instance
      // is in-process — we connect as a local client too.
      await this.connectAsClient();
      return;
    }

    // Pipe is taken — connect as client
    this.logger.info(`[poller-coord] Pipe taken, connecting as client`);
    await this.connectAsClient();
  }

  private async connectAsClient(): Promise<void> {
    const client = new PollerClient(this.botToken, this.logger);
    client.setOnUpdates((updates) => {
      this.onUpdates?.(updates);
    });
    client.setOnDisconnect(() => {
      if (this.stopped) return;
      this.logger.info(`[poller-coord] Server gone — attempting promotion in ${this.PROMOTION_DELAY_MS}ms`);
      this.role = "idle";
      this.client = null;
      this.schedulePromotion();
    });

    const connected = await client.tryConnect();
    if (connected) {
      this.client = client;
      if (!this.server) {
        this.role = "client";
        this.logger.info(`[poller-coord] Role: client`);
      }
    } else if (!this.server) {
      // Neither server nor client worked — retry promotion
      this.logger.info(`[poller-coord] Could not connect as client — will retry`);
      this.schedulePromotion();
    }
  }

  private schedulePromotion(): void {
    if (this.stopped) return;
    if (this.promotionTimer) return;

    this.promotionTimer = setTimeout(() => {
      (async () => {
        this.promotionTimer = null;
        if (this.stopped) return;

        this.logger.info(`[poller-coord] Attempting promotion to server`);
        const server = new PollerServer(this.api, this.botToken, this.logger);
        const bound = await server.tryStart();

        if (bound) {
          this.server = server;
          this.role = "server";
          this.logger.info(`[poller-coord] Promoted to server`);
          await this.connectAsClient();
        } else {
          // Another instance beat us — connect as client
          this.logger.info(`[poller-coord] Promotion failed, connecting as client`);
          await this.connectAsClient();
        }
      })().catch((err: unknown) => {
        this.logger.warn(`[poller-coord] Promotion error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.PROMOTION_DELAY_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.promotionTimer) {
      clearTimeout(this.promotionTimer);
      this.promotionTimer = null;
    }
    this.client?.stop();
    this.client = null;
    this.server?.stop();
    this.server = null;
    this.role = "idle";
  }

  get currentRole(): PollerRole {
    return this.role;
  }

  get isActive(): boolean {
    return this.role !== "idle";
  }
}
