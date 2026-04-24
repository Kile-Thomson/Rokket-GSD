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
  parameters?: { retry_after?: number };
}

export function redactToken(msg: string, token: string): string {
  return msg.replaceAll(token, "bot***");
}

export class TelegramApi {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  private async callApi<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<T> {
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
      clearTimeout(timeout);
      const message =
        err instanceof Error ? err.message : String(err);
      throw new Error(
        redactToken(`Telegram API request failed: ${message}`, this.botToken),
        { cause: err },
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = (await response.json()) as TelegramResponse<T>;

    if (!response.ok || !data.ok) {
      const desc = data.description ?? "unknown error";
      const retryHint =
        data.parameters?.retry_after != null
          ? ` (retry after ${data.parameters.retry_after}s)`
          : "";
      throw new Error(
        redactToken(
          `Telegram API error ${response.status}: ${desc}${retryHint}`,
          this.botToken,
        ),
      );
    }

    if (data.result === undefined) {
      throw new Error(
        redactToken(
          `Unexpected response from ${method}: no result field`,
          this.botToken,
        ),
      );
    }

    return data.result;
  }

  async getMe(): Promise<TelegramUser> {
    return this.callApi<TelegramUser>("getMe");
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    options?: Record<string, unknown>,
  ): Promise<TelegramMessage> {
    return this.callApi<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...options,
    });
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
    return this.callApi<TelegramUpdate[]>(
      "getUpdates",
      offset != null ? { offset } : undefined,
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
    return this.callApi<TelegramMessage>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    });
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
