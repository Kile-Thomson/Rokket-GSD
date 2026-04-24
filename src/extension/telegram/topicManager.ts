import type { TelegramApi, ForumTopic } from "./api";

const TELEGRAM_TOPIC_NAME_LIMIT = 128;
const TOPIC_REGISTRY_KEY = "gsd.telegram.topicRegistry";

export interface TopicManagerLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface GlobalStateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface TopicRegistryEntry {
  threadId: number;
  sessionId: string;
  machineId: string;
  createdAt: string;
}

const noopLogger: TopicManagerLogger = {
  info() {},
  warn() {},
};

export class TopicManager {
  private readonly sessionToTopic = new Map<string, number>();
  private readonly topicToSession = new Map<number, string>();
  private readonly syncing = new Set<string>();
  private topicCounter = 0;
  private readonly _machineId: string;
  private readonly globalState?: GlobalStateStore;

  constructor(
    private readonly api: TelegramApi,
    private readonly chatId: number | string,
    machineId: string,
    private readonly logger: TopicManagerLogger = noopLogger,
    globalState?: GlobalStateStore,
  ) {
    this._machineId = machineId;
    this.globalState = globalState;
  }

  get machineId(): string {
    return this._machineId;
  }

  get activeSessions(): string[] {
    return [...this.sessionToTopic.keys()];
  }

  getTopicForSession(sessionId: string): number | undefined {
    return this.sessionToTopic.get(sessionId);
  }

  getSessionForTopic(threadId: number): string | undefined {
    return this.topicToSession.get(threadId);
  }

  async syncOn(sessionId: string, label: string): Promise<number> {
    const existing = this.sessionToTopic.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }

    if (this.syncing.has(sessionId)) {
      const current = this.sessionToTopic.get(sessionId);
      if (current !== undefined) return current;
      return -1;
    }

    this.syncing.add(sessionId);
    try {
      this.topicCounter++;
      const topicName =
        this.topicCounter === 1
          ? label.slice(0, TELEGRAM_TOPIC_NAME_LIMIT)
          : `${label} #${this.topicCounter}`.slice(0, TELEGRAM_TOPIC_NAME_LIMIT);

      this.logger.info(`Creating forum topic "${topicName}" for session ${sessionId}`);
      const topic: ForumTopic = await this.api.createForumTopic(this.chatId, topicName);
      const threadId = topic.message_thread_id;

      this.sessionToTopic.set(sessionId, threadId);
      this.topicToSession.set(threadId, sessionId);
      await this.registryAdd({ threadId, sessionId, machineId: this._machineId, createdAt: new Date().toISOString() });
      this.logger.info(`Created topic ${threadId} for session ${sessionId}`);

      return threadId;
    } finally {
      this.syncing.delete(sessionId);
    }
  }

  async syncOff(sessionId: string): Promise<void> {
    const threadId = this.sessionToTopic.get(sessionId);
    if (threadId === undefined) {
      return;
    }

    if (this.syncing.has(sessionId)) {
      return;
    }

    this.syncing.add(sessionId);
    try {
      try {
        await this.api.closeForumTopic(this.chatId, threadId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`closeForumTopic failed for topic ${threadId}: ${msg}`);
      }

      try {
        await this.api.deleteForumTopic(this.chatId, threadId);
        this.logger.info(`Deleted topic ${threadId} for session ${sessionId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`deleteForumTopic failed for topic ${threadId}: ${msg}`);
      }

      this.sessionToTopic.delete(sessionId);
      this.topicToSession.delete(threadId);
      await this.registryRemove(threadId);
    } finally {
      this.syncing.delete(sessionId);
    }
  }

  async disposeAll(): Promise<void> {
    const sessions = [...this.sessionToTopic.keys()];
    for (const sessionId of sessions) {
      await this.syncOff(sessionId);
    }
    await this.registryClearMachine();
  }

  async cleanupStaleTopics(): Promise<number> {
    if (!this.globalState) return 0;
    const entries = this.globalState.get<TopicRegistryEntry[]>(TOPIC_REGISTRY_KEY) ?? [];
    const stale = entries.filter(
      (e) => e.machineId === this._machineId && !this.sessionToTopic.has(e.sessionId),
    );
    if (stale.length === 0) return 0;

    this.logger.info(`[topic-manager] Stale topics found: ${stale.length}`);

    for (const entry of stale) {
      try {
        await this.api.closeForumTopic(this.chatId, entry.threadId);
      } catch {
        // swallow
      }
      try {
        await this.api.deleteForumTopic(this.chatId, entry.threadId);
        this.logger.info(`[topic-manager] Stale topic ${entry.threadId} deleted`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[topic-manager] Stale topic ${entry.threadId} delete failed: ${msg}`);
      }
    }

    const staleIds = new Set(stale.map((e) => e.threadId));
    const remaining = entries.filter((e) => !staleIds.has(e.threadId));
    try {
      await this.globalState.update(TOPIC_REGISTRY_KEY, remaining);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[topic-manager] Registry cleanup write failed: ${msg}`);
    }

    return stale.length;
  }

  private async registryAdd(entry: TopicRegistryEntry): Promise<void> {
    if (!this.globalState) return;
    try {
      const entries = this.globalState.get<TopicRegistryEntry[]>(TOPIC_REGISTRY_KEY) ?? [];
      entries.push(entry);
      await this.globalState.update(TOPIC_REGISTRY_KEY, entries);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[topic-manager] Registry add failed: ${msg}`);
    }
  }

  private async registryRemove(threadId: number): Promise<void> {
    if (!this.globalState) return;
    try {
      const entries = this.globalState.get<TopicRegistryEntry[]>(TOPIC_REGISTRY_KEY) ?? [];
      const filtered = entries.filter((e) => e.threadId !== threadId);
      await this.globalState.update(TOPIC_REGISTRY_KEY, filtered);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[topic-manager] Registry remove failed: ${msg}`);
    }
  }

  private async registryClearMachine(): Promise<void> {
    if (!this.globalState) return;
    try {
      const entries = this.globalState.get<TopicRegistryEntry[]>(TOPIC_REGISTRY_KEY) ?? [];
      const filtered = entries.filter((e) => e.machineId !== this._machineId);
      await this.globalState.update(TOPIC_REGISTRY_KEY, filtered);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[topic-manager] Registry clear failed: ${msg}`);
    }
  }
}
