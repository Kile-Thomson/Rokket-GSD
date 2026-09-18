export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  title?: string;
  type: string;
}

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  message_thread_id?: number;
  photo?: PhotoSize[];
  caption?: string;
  voice?: TelegramVoice;
}

export interface ForumTopic {
  message_thread_id: number;
  name: string;
  icon_color?: number;
  icon_custom_emoji_id?: string;
}

export interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

export interface ChatMember {
  status: string;
  user: TelegramUser;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export function redactToken(msg: string, token: string): string {
  return msg.replaceAll(token, "bot***");
}

/**
 * Thrown when a request targets a group chat that Telegram has upgraded to a
 * supergroup. The old chat ID is permanently invalid; `migrateToChatId` is the
 * new ID Telegram returns under `parameters.migrate_to_chat_id`. Callers should
 * update their stored chat ID to this value and retry. Carries no token, so it
 * is safe to log without redaction.
 */
export class TelegramMigrationError extends Error {
  constructor(
    readonly migrateToChatId: number,
    readonly status: number,
    readonly description: string,
  ) {
    super(
      `Telegram chat was upgraded to a supergroup — migrate to chat ID ${migrateToChatId}`,
    );
    this.name = "TelegramMigrationError";
  }
}

/**
 * Thrown when a forum method (e.g. createForumTopic) targets a supergroup that
 * does not have Topics enabled. Telegram returns `400 Bad Request: the chat is
 * not a forum`. The fix is a one-time toggle in the group settings, not a
 * re-setup, so callers should surface an actionable "enable Topics" message
 * rather than the raw 400. Carries no token, so it is safe to log unredacted.
 */
export class TelegramNotForumError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(
      "Telegram supergroup does not have Topics enabled — enable Topics to create forum topics",
    );
    this.name = "TelegramNotForumError";
  }
}

/** Largest retry_after (seconds) callApi will wait out in-line before retrying a rate-limited call. */
const MAX_AUTO_RETRY_AFTER_S = 30;

/** Telegram's "can't parse entities" 400: the text is valid but the parse_mode markup is malformed. */
function isParseEntitiesError(err: unknown): boolean {
  return err instanceof Error && /can't parse entities/i.test(err.message);
}

export class TelegramApi {
  private readonly baseUrl: string;
  /**
   * Fired when any call hits a supergroup migration. Lets a central owner
   * (bridge + topic manager) adopt the new chat ID so every subsequent call
   * targets the valid supergroup, not just the one that tripped the migration.
   */
  private onMigrate?: (newChatId: number) => void | Promise<void>;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  /** Register the migration handler (see onMigrate). */
  setOnMigrate(cb: (newChatId: number) => void | Promise<void>): void {
    this.onMigrate = cb;
  }

  /** One network round-trip: fetch + JSON parse. No retry/error interpretation. */
  private async fetchOnce<T>(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<{ status: number; ok: boolean; data: TelegramResponse<T> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: params ? JSON.stringify(params) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        redactToken(`Telegram API request failed: ${message}`, this.botToken),
        { cause: err },
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = (await response.json()) as TelegramResponse<T>;
    return { status: response.status, ok: response.ok, data };
  }

  private async callApi<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<T> {
    // At most one automatic retry per trigger (migration adopt, 429 wait), so a
    // persistently failing call can't loop. currentParams is rewritten on a
    // migration retry so the second attempt targets the new chat ID.
    let currentParams = params;
    let migrationRetried = false;
    let rateLimitRetried = false;

    for (;;) {
      const { status, ok, data } = await this.fetchOnce<T>(method, currentParams, timeoutMs);

      if (ok && data.ok) {
        if (data.result === undefined) {
          throw new Error(
            redactToken(`Unexpected response from ${method}: no result field`, this.botToken),
          );
        }
        return data.result;
      }

      const desc = data.description ?? "unknown error";
      const migrateTo = data.parameters?.migrate_to_chat_id;
      const retryAfter = data.parameters?.retry_after;

      // Supergroup migration: adopt the new ID centrally, then retry once with
      // the rewritten chat_id so this very call succeeds. Falls through to the
      // thrown TelegramMigrationError when no handler is set (e.g. in tests) or
      // the call carries no chat_id, preserving the existing caller contract.
      if (migrateTo != null) {
        if (this.onMigrate && !migrationRetried && currentParams && "chat_id" in currentParams) {
          await this.onMigrate(migrateTo);
          currentParams = { ...currentParams, chat_id: migrateTo };
          migrationRetried = true;
          continue;
        }
        throw new TelegramMigrationError(migrateTo, status, desc);
      }

      if (/not a forum/i.test(desc)) {
        throw new TelegramNotForumError(status, desc);
      }

      // Rate limited: wait out Telegram's own retry_after once (bounded) instead
      // of dropping the message. A retry_after beyond the cap is thrown so the
      // caller decides rather than blocking the poller for minutes.
      if (
        retryAfter != null &&
        !rateLimitRetried &&
        retryAfter > 0 &&
        retryAfter <= MAX_AUTO_RETRY_AFTER_S
      ) {
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        rateLimitRetried = true;
        continue;
      }

      const retryHint = retryAfter != null ? ` (retry after ${retryAfter}s)` : "";
      throw new Error(
        redactToken(`Telegram API error ${status}: ${desc}${retryHint}`, this.botToken),
      );
    }
  }

  async getMe(): Promise<TelegramUser> {
    return this.callApi<TelegramUser>("getMe");
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    options?: Record<string, unknown>,
  ): Promise<TelegramMessage> {
    try {
      return await this.callApi<TelegramMessage>("sendMessage", {
        chat_id: chatId,
        text,
        ...options,
      });
    } catch (err: unknown) {
      // Malformed markup (e.g. a code fence cut mid-block by truncation) makes
      // Telegram reject the whole message. Retry once as plain text so the
      // content is still delivered rather than silently lost.
      if (isParseEntitiesError(err) && options?.parse_mode) {
        const { parse_mode: _drop, ...rest } = options;
        return this.callApi<TelegramMessage>("sendMessage", {
          chat_id: chatId,
          text,
          ...rest,
        });
      }
      throw err;
    }
  }

  async getChatMember(
    chatId: number | string,
    userId: number,
  ): Promise<ChatMember> {
    return this.callApi<ChatMember>("getChatMember", {
      chat_id: chatId,
      user_id: userId,
    });
  }

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    // Long-poll: `timeout` holds the connection open server-side until an update
    // arrives (or 30s elapses), cutting latency and request volume versus short
    // polling. The 35s fetch abort sits comfortably above the 30s long-poll.
    return this.callApi<TelegramUpdate[]>(
      "getUpdates",
      offset != null ? { offset, timeout: 30 } : { timeout: 30 },
      35_000,
    );
  }

  async createForumTopic(
    chatId: number | string,
    name: string,
  ): Promise<ForumTopic> {
    return this.callApi<ForumTopic>("createForumTopic", {
      chat_id: chatId,
      name,
    });
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: Record<string, unknown>,
  ): Promise<TelegramMessage> {
    try {
      return await this.callApi<TelegramMessage>("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...options,
      });
    } catch (err: unknown) {
      // Same malformed-markup fallback as sendMessage: deliver as plain text
      // rather than let a parse failure silently drop the edit.
      if (isParseEntitiesError(err) && options?.parse_mode) {
        const { parse_mode: _drop, ...rest } = options;
        return this.callApi<TelegramMessage>("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text,
          ...rest,
        });
      }
      throw err;
    }
  }

  async closeForumTopic(
    chatId: number | string,
    messageThreadId: number,
  ): Promise<boolean> {
    await this.callApi<true>("closeForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });
    return true;
  }

  async deleteForumTopic(
    chatId: number | string,
    messageThreadId: number,
  ): Promise<boolean> {
    await this.callApi<true>("deleteForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });
    return true;
  }

  async sendChatAction(
    chatId: number | string,
    action: string,
    options?: Record<string, unknown>,
  ): Promise<boolean> {
    return this.callApi<boolean>("sendChatAction", {
      chat_id: chatId,
      action,
      ...options,
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<boolean> {
    return this.callApi<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.callApi<TelegramFile>("getFile", { file_id: fileId });
  }

  async downloadFile(
    filePath: string,
    timeoutMs = 10_000,
  ): Promise<{ base64: string; mimeType: string }> {
    const buf = await this.downloadFileBuffer(filePath, timeoutMs);
    const lower = filePath.toLowerCase();
    const mimeType =
      lower.endsWith(".png") ? "image/png" :
      lower.endsWith(".gif") ? "image/gif" :
      lower.endsWith(".webp") ? "image/webp" :
      "image/jpeg";
    return { base64: buf.toString("base64"), mimeType };
  }

  async downloadFileBuffer(
    filePath: string,
    timeoutMs = 30_000,
  ): Promise<Buffer> {
    const url = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err: unknown) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        redactToken(`Telegram file download failed: ${message}`, this.botToken),
        { cause: err },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(
        redactToken(
          `Telegram file download error ${response.status}: ${url}`,
          this.botToken,
        ),
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
