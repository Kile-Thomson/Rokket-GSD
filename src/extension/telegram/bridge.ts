import type { TelegramApi, TelegramUpdate, CallbackQuery } from "./api";
import { redactToken } from "./api";
import { transcribeAudio, TranscriptionError } from "../openai/transcribe";
import { truncateMessage, markdownToTelegramHtml, escapeHtml } from "./formatter";
import type { TopicManager, TopicManagerLogger } from "./topicManager";
import { PollerCoordinator } from "./poller-coordinator";

export interface SessionResolver {
  (sessionId: string): BridgeSessionState | undefined;
}

export interface BridgeSessionState {
  client: BridgeClient | null;
  isStreaming: boolean;
}

export interface BridgeImage {
  type: "image";
  data: string;
  mimeType: string;
}

export interface BridgeClient {
  abort(): Promise<void>;
  prompt(message: string, images?: BridgeImage[]): Promise<unknown>;
}

interface StreamingState {
  messageId: number | null;
  accumulatedText: string;
  pendingEdit: ReturnType<typeof setTimeout> | null;
  sendingPlaceholder: boolean;
  placeholderPromise: Promise<number | null> | null;
  queuedDeltas: string[];
}

interface QueuedMessage {
  text: string;
  images?: BridgeImage[];
  routeLabel: string;
}

export type InboundMessageCallback = (sessionId: string, text: string, images?: BridgeImage[]) => void;

interface PendingQuestion {
  resolve: (value: string | null) => void;
  optionMap: Map<string, string>;
  messageId: number;
  threadId: number;
}

interface ActiveTool {
  messageId: number;
  threadId: number;
  toolName: string;
  summary: string;
  startMs: number;
}

export class TelegramBridge {
  private chatId: number | string;
  private readonly streamingState = new Map<string, StreamingState>();
  private readonly EDIT_THROTTLE_MS = 2000;
  private streamingGranularity: "off" | "throttled" | "final-only" = "throttled";
  private onInboundMessage: InboundMessageCallback | undefined;
  private readonly messageQueue = new Map<string, QueuedMessage[]>();
  private readonly processingSession = new Set<string>();
  private readonly pendingQuestions = new Map<string, PendingQuestion>();
  private readonly activeTools = new Map<string, ActiveTool>();
  private readonly pendingToolEnds = new Map<string, { isError: boolean; durationMs?: number }>();
  private coordinator: PollerCoordinator | null = null;
  private polling = false;
  private getOpenAiKey: (() => Promise<string | undefined>) | undefined;
  private readonly typingLoops = new Map<string, ReturnType<typeof setInterval>>();
  private readonly turnStartMs = new Map<string, number>();
  private readonly TYPING_INTERVAL_MS = 4500;
  private readonly _activeDeliveries = new Set<Promise<void>>();

  async waitForAllDeliveries(): Promise<void> {
    while (this._activeDeliveries.size > 0) {
      await Promise.allSettled(Array.from(this._activeDeliveries));
    }
  }

  constructor(
    private readonly api: TelegramApi,
    private readonly topicManager: TopicManager,
    private readonly resolveSession: SessionResolver,
    private readonly logger: TopicManagerLogger,
    private readonly botToken: string,
    chatId: number | string,
    getOpenAiKey?: () => Promise<string | undefined>,
  ) {
    this.chatId = chatId;
    this.getOpenAiKey = getOpenAiKey;
  }

  setStreamingGranularity(value: "off" | "throttled" | "final-only"): void {
    this.streamingGranularity = value;
  }

  setOnInboundMessage(cb: InboundMessageCallback): void {
    this.onInboundMessage = cb;
  }

  startPolling(): void {
    if (this.polling) return;
    this.polling = true;

    const coord = new PollerCoordinator(this.api, this.botToken, this.logger);
    coord.setOnUpdates((updates) => {
      this.handleUpdates(updates as TelegramUpdate[]).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.info(`[telegram-bridge] handleUpdates error: ${redactToken(msg, this.botToken)}`);
      });
    });
    this.coordinator = coord;
    coord.start().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.info(`[telegram-bridge] Coordinator start error: ${redactToken(msg, this.botToken)}`);
    });
  }

  stopPolling(): void {
    this.polling = false;
    this.coordinator?.stop();
    this.coordinator = null;
  }

  /** For testing only — directly process updates without going through the IPC poller. */
  async _testInjectUpdates(updates: TelegramUpdate[]): Promise<void> {
    await this.handleUpdates(updates);
    await this.waitForAllDeliveries();
  }

  private async handleUpdates(updates: TelegramUpdate[]): Promise<void> {
    for (const update of updates) {
      if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
        continue;
      }
      const message = update.message;
      if (!message) {
        this.logger.info("[telegram-bridge] Skipping update without message");
        continue;
      }
      const hasText = !!message.text;
      const hasPhoto = !!message.photo?.length;
      const hasVoice = !!message.voice;
      if (!hasText && !hasPhoto && !hasVoice) {
        this.logger.info("[telegram-bridge] Skipping message without text, photo, or voice");
        continue;
      }
      if (message.message_thread_id == null) {
        this.logger.info("[telegram-bridge] Skipping message without thread_id");
        continue;
      }
      if (message.from?.is_bot) {
        this.logger.info("[telegram-bridge] Skipping bot message");
        continue;
      }

      const rawText = hasPhoto
        ? (message.caption ?? message.text ?? "")
        : (message.text ?? "");
      if (rawText.toLowerCase().startsWith("/telegram")) {
        this.logger.info("[telegram-bridge] Skipping /telegram command");
        continue;
      }

      const sessionId = this.topicManager.getSessionForTopic(
        message.message_thread_id,
      );
      if (!sessionId) {
        this.logger.info(
          `[telegram-bridge] No session for topic ${message.message_thread_id}`,
        );
        continue;
      }

      // Handle voice transcription
      if (hasVoice) {
        await this.handleVoiceMessage(sessionId, message.voice!.file_id, message.message_thread_id);
        continue;
      }

      const isSlashCommand =
        rawText.startsWith("/") && !rawText.toLowerCase().startsWith("/telegram");

      let images: BridgeImage[] | undefined;
      if (hasPhoto) {
        const photo = message.photo![message.photo!.length - 1];
        this.logger.info(
          `[telegram-bridge] Photo detected, file_id=${photo.file_id}`,
        );
        try {
          const file = await this.api.getFile(photo.file_id);
          if (!file.file_path) {
            throw new Error("getFile returned no file_path");
          }
          this.logger.info(
            `[telegram-bridge] Download started for ${photo.file_id}`,
          );
          const downloaded = await this.api.downloadFile(file.file_path);
          images = [
            {
              type: "image",
              data: downloaded.base64,
              mimeType: downloaded.mimeType,
            },
          ];
          this.logger.info(
            `[telegram-bridge] Image injected for ${photo.file_id}`,
          );
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logger.info(
            `[telegram-bridge] Failed to download photo: ${redactToken(errMsg, this.botToken)}`,
          );
          if (!rawText) {
            this.logger.info(
              "[telegram-bridge] No caption/text after download failure, skipping message",
            );
            continue;
          }
        }
      }

      const text = rawText;
      const routeLabel = isSlashCommand ? "command" : hasPhoto ? "photo" : "text";
      this.enqueueMessage(sessionId, { text, images, routeLabel });
    }
  }

  private async handleVoiceMessage(sessionId: string, fileId: string, threadId: number): Promise<void> {
    this.logger.info(`[telegram-bridge] Voice message received for ${sessionId}, file_id=${fileId}`);

    if (!this.getOpenAiKey) {
      this.logger.info("[telegram-bridge] No OpenAI key provider — cannot transcribe voice");
      await this.api.sendMessage(this.chatId, "⚠️ Voice transcription is not configured. Run <b>Rokket GSD: Set OpenAI API Key</b> from the Command Palette.", {
        message_thread_id: threadId,
        parse_mode: "HTML",
      }).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
      return;
    }

    const apiKey = await this.getOpenAiKey();
    if (!apiKey) {
      this.logger.info("[telegram-bridge] OpenAI key not set — cannot transcribe voice");
      await this.api.sendMessage(this.chatId, "⚠️ No OpenAI API key set. Run <b>Rokket GSD: Set OpenAI API Key</b> from the Command Palette.", {
        message_thread_id: threadId,
        parse_mode: "HTML",
      }).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
      return;
    }

    let statusMsgId: number | null = null;
    try {
      const statusMsg = await this.api.sendMessage(this.chatId, "🎙️ Transcribing…", {
        message_thread_id: threadId,
      });
      statusMsgId = statusMsg.message_id;
    } catch {
      // non-fatal — continue without status message
    }

    try {
      const file = await this.api.getFile(fileId);
      if (!file.file_path) throw new Error("getFile returned no file_path");

      const audioBuffer = await this.api.downloadFileBuffer(file.file_path);
      const transcript = await transcribeAudio(apiKey, audioBuffer, "voice.ogg");

      this.logger.info(`[telegram-bridge] Transcribed voice for ${sessionId}: ${transcript.slice(0, 80)}`);

      if (statusMsgId !== null) {
        await this.api.editMessageText(this.chatId, statusMsgId, `🎙️ ${transcript}`, {
          message_thread_id: threadId,
        }).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
      }

      this.enqueueMessage(sessionId, { text: transcript, routeLabel: "voice" });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.info(`[telegram-bridge] Voice transcription failed: ${errMsg}`);
      const userMsg = err instanceof TranscriptionError
        ? `❌ Transcription failed: ${errMsg}`
        : "❌ Voice transcription failed — check the output channel for details.";
      if (statusMsgId !== null) {
        await this.api.editMessageText(this.chatId, statusMsgId, userMsg, { message_thread_id: threadId }).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
      } else {
        await this.api.sendMessage(this.chatId, userMsg, { message_thread_id: threadId }).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
      }
    }
  }

  private enqueueMessage(sessionId: string, msg: QueuedMessage): void {
    let queue = this.messageQueue.get(sessionId);
    if (!queue) {
      queue = [];
      this.messageQueue.set(sessionId, queue);
    }
    queue.push(msg);

    const isProcessing = this.processingSession.has(sessionId);
    this.logger.info(`[telegram-bridge] Enqueued ${msg.routeLabel} for ${sessionId} (queueLen=${queue.length}, processing=${isProcessing})`);
    if (!isProcessing) {
      this.drainQueue(sessionId);
    }
  }

  private readonly CLIENT_RETRY_MS = 2000;
  private readonly CLIENT_MAX_RETRIES = 5;
  private readonly PROMPT_TIMEOUT_MS = 120_000;

  private drainQueue(sessionId: string): void {
    const queue = this.messageQueue.get(sessionId);
    if (!queue || queue.length === 0) {
      this.processingSession.delete(sessionId);
      this.messageQueue.delete(sessionId);
      this.logger.info(`[telegram-bridge] Drain complete for ${sessionId}`);
      return;
    }

    this.processingSession.add(sessionId);
    const msg = queue.shift()!;
    this.logger.info(`[telegram-bridge] Draining ${msg.routeLabel} for ${sessionId} (remaining=${queue.length})`);

    const waitForClient = async (): Promise<BridgeSessionState | undefined> => {
      for (let attempt = 0; attempt < this.CLIENT_MAX_RETRIES; attempt++) {
        const s = this.resolveSession(sessionId);
        if (s?.client) return s;
        this.logger.info(`[telegram-bridge] Waiting for client ${sessionId} (attempt ${attempt + 1}/${this.CLIENT_MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, this.CLIENT_RETRY_MS));
      }
      return undefined;
    };

    const deliver = async () => {
      let current = await waitForClient();
      if (!current?.client) {
        this.logger.info(`[telegram-bridge] No client for ${sessionId} after retries, dropping message`);
        return;
      }

      if (current.isStreaming) {
        this.logger.info(`[telegram-bridge] Session ${sessionId} is streaming — aborting first`);
        try {
          await current.client.abort();
        } catch { /* may not be streaming */ }
        await new Promise((r) => setTimeout(r, 800));
        current = await waitForClient();
        if (!current?.client) {
          this.logger.info(`[telegram-bridge] No client for ${sessionId} after abort settle, dropping message`);
          return;
        }
      }

      this.onInboundMessage?.(sessionId, msg.text, msg.images);
      const threadId = this.topicManager.getTopicForSession(sessionId);
      if (threadId != null) {
        this.startTypingLoop(sessionId, threadId);
      }
      this.logger.info(`[telegram-bridge] Calling prompt for ${sessionId}`);
      const promptPromise = current.client.prompt(msg.text, msg.images);
      const timeoutPromise = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), this.PROMPT_TIMEOUT_MS));
      const result = await Promise.race([promptPromise, timeoutPromise]);
      if (result === "timeout") {
        this.stopTypingLoop(sessionId);
        this.logger.info(`[telegram-bridge] prompt timed out for ${sessionId} — continuing drain`);
      } else {
        this.logger.info(`[telegram-bridge] Routed ${msg.routeLabel} to ${sessionId}`);
      }
    };

    const deliveryPromise = deliver()
      .catch((err: unknown) => {
        this.stopTypingLoop(sessionId);
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.info(`[telegram-bridge] prompt error for ${sessionId}: ${redactToken(errMsg, this.botToken)}`);
      })
      .finally(() => {
        this._activeDeliveries.delete(deliveryPromise);
        this.drainQueue(sessionId);
      });
    this._activeDeliveries.add(deliveryPromise);
  }

  async sendQuestion(
    sessionId: string,
    requestId: string,
    title: string,
    options: string[],
  ): Promise<string | null> {
    const threadId = this.topicManager.getTopicForSession(sessionId);
    if (threadId == null) {
      this.logger.info(`[telegram-bridge] sendQuestion: no topic for session ${sessionId}`);
      return null;
    }

    const callbackPrefix = `q:${requestId}:`;
    const inlineKeyboard = options.map((opt, i) => [{
      text: opt,
      callback_data: `${callbackPrefix}${i}`,
    }]);

    try {
      const msg = await this.api.sendMessage(this.chatId, `❓ ${title}`, {
        message_thread_id: threadId,
        reply_markup: { inline_keyboard: inlineKeyboard },
      });

      const optionMap = new Map<string, string>();
      options.forEach((opt, i) => optionMap.set(`${callbackPrefix}${i}`, opt));

      return new Promise<string | null>((resolve) => {
        this.pendingQuestions.set(requestId, {
          resolve,
          optionMap,
          messageId: msg.message_id,
          threadId,
        });
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.info(`[telegram-bridge] sendQuestion error: ${redactToken(errMsg, this.botToken)}`);
      return null;
    }
  }

  cancelQuestion(requestId: string): void {
    const pending = this.pendingQuestions.get(requestId);
    if (pending) {
      this.pendingQuestions.delete(requestId);
      pending.resolve(null);
      this.api.editMessageText(this.chatId, pending.messageId, "⏭ Answered locally", {
        message_thread_id: pending.threadId,
        reply_markup: { inline_keyboard: [] },
      }).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
    }
  }

  private async handleCallbackQuery(query: CallbackQuery): Promise<void> {
    const data = query.data;
    if (!data) return;

    const match = data.match(/^q:([^:]+):(\d+)$/);
    if (!match) return;

    const requestId = match[1];
    const pending = this.pendingQuestions.get(requestId);
    if (!pending) {
      this.logger.info(`[telegram-bridge] callback_query for unknown request ${requestId}`);
      await this.api.answerCallbackQuery(query.id, "Already answered").catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
      return;
    }

    const selectedOption = pending.optionMap.get(data);
    if (!selectedOption) {
      await this.api.answerCallbackQuery(query.id, "Invalid option").catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
      return;
    }

    this.pendingQuestions.delete(requestId);
    await this.api.answerCallbackQuery(query.id, `✓ ${selectedOption}`).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
    this.api.editMessageText(this.chatId, pending.messageId, `❓ Answered: ${selectedOption}`, {
      message_thread_id: pending.threadId,
      reply_markup: { inline_keyboard: [] },
    }).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));

    this.logger.info(`[telegram-bridge] Question ${requestId} answered via Telegram: ${selectedOption}`);
    pending.resolve(selectedOption);
  }

  private startTypingLoop(sessionId: string, threadId: number): void {
    if (this.typingLoops.has(sessionId)) return;
    this.turnStartMs.set(sessionId, Date.now());
    const sendAction = () => {
      this.api.sendChatAction(this.chatId, "typing", { message_thread_id: threadId }).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
    };
    sendAction();
    const handle = setInterval(sendAction, this.TYPING_INTERVAL_MS);
    this.typingLoops.set(sessionId, handle);
    this.logger.info(`[telegram-bridge] Typing loop started for ${sessionId}`);
  }

  private stopTypingLoop(sessionId: string): number | undefined {
    const handle = this.typingLoops.get(sessionId);
    if (handle !== undefined) {
      clearInterval(handle);
      this.typingLoops.delete(sessionId);
      this.logger.info(`[telegram-bridge] Typing loop stopped for ${sessionId}`);
    }
    const startMs = this.turnStartMs.get(sessionId);
    this.turnStartMs.delete(sessionId);
    return startMs !== undefined ? Date.now() - startMs : undefined;
  }

  handleStreamingChunk(sessionId: string, delta: string): void {
    if (this.streamingGranularity === "off" || this.streamingGranularity === "final-only") {
      this.logger.info(`[telegram-bridge] handleStreamingChunk: skipped (granularity=${this.streamingGranularity})`);
      return;
    }

    const threadId = this.topicManager.getTopicForSession(sessionId);
    if (threadId == null) {
      this.logger.info(`[telegram-bridge] handleStreamingChunk: no topic for session ${sessionId} (known sessions: ${this.topicManager.activeSessions.join(",")})`);
      return;
    }

    let state = this.streamingState.get(sessionId);
    if (!state) {
      state = { messageId: null, accumulatedText: "", pendingEdit: null, sendingPlaceholder: false, placeholderPromise: null, queuedDeltas: [] };
      this.streamingState.set(sessionId, state);
    }

    state.accumulatedText += delta;

    if (state.messageId === null && !state.sendingPlaceholder) {
      state.sendingPlaceholder = true;
      state.placeholderPromise = this.api.sendMessage(this.chatId, "…", { message_thread_id: threadId })
        .then((msg) => {
          state!.messageId = msg.message_id;
          state!.sendingPlaceholder = false;
          state!.placeholderPromise = null;
          if (state!.queuedDeltas.length > 0) {
            state!.accumulatedText += state!.queuedDeltas.join("");
            state!.queuedDeltas = [];
          }
          this.scheduleEdit(sessionId);
          this.logger.info(`[telegram-bridge] Streaming started for ${sessionId}, placeholder msg=${msg.message_id}`);
          return msg.message_id;
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.info(`[telegram-bridge] Placeholder send error: ${redactToken(msg, this.botToken)}`);
          state!.sendingPlaceholder = false;
          state!.placeholderPromise = null;
          this.streamingState.delete(sessionId);
          return null;
        });
      return;
    }

    if (state.sendingPlaceholder) {
      state.queuedDeltas.push(delta);
      return;
    }

    if (!state.pendingEdit) {
      this.scheduleEdit(sessionId);
    }
  }

  handleStreamEnd(sessionId: string, finalText: string): void {
    const state = this.streamingState.get(sessionId);
    if (!state && this.streamingGranularity !== "final-only") {
      return;
    }
    const threadId = this.topicManager.getTopicForSession(sessionId);
    if (threadId == null) {
      this.logger.info(`[telegram-bridge] handleStreamEnd: no topic for session ${sessionId} (known sessions: ${this.topicManager.activeSessions.join(",")})`);
      return;
    }
    this.logger.info(`[telegram-bridge] handleStreamEnd: session=${sessionId}, hasState=${!!state}, messageId=${state?.messageId}, textLen=${finalText.length}`);

    const doFlush = async (resolvedMessageId: number | null) => {
      if (state?.pendingEdit) {
        clearTimeout(state.pendingEdit);
        state.pendingEdit = null;
      }

      const elapsedMs = this.stopTypingLoop(sessionId);
      const elapsedStr = elapsedMs != null ? `  <i>${(elapsedMs / 1000).toFixed(1)}s</i>` : "";

      const text = markdownToTelegramHtml(truncateMessage(finalText));

      if (!resolvedMessageId) {
        this.streamingState.delete(sessionId);
        if (finalText) {
          await this.api.sendMessage(this.chatId, text, { message_thread_id: threadId, parse_mode: "HTML" })
            .then(() => this.logger.info(`[telegram-bridge] Sent final (no stream) for ${sessionId}`))
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              this.logger.info(`[telegram-bridge] Send final error: ${redactToken(msg, this.botToken)}`);
            });
        }
        await this.api.sendMessage(this.chatId, `✅ Done${elapsedStr}`, { message_thread_id: threadId, parse_mode: "HTML" })
          .catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
        return;
      }

      await this.api.editMessageText(this.chatId, resolvedMessageId, text, { parse_mode: "HTML" })
        .then(() => this.logger.info(`[telegram-bridge] Final flush for ${sessionId}`))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.info(`[telegram-bridge] Final edit error: ${redactToken(msg, this.botToken)}`);
        })
        .finally(() => this.streamingState.delete(sessionId));

      await this.api.sendMessage(this.chatId, `✅ Done${elapsedStr}`, { message_thread_id: threadId, parse_mode: "HTML" })
        .catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
    };

    if (state?.placeholderPromise) {
      // Placeholder send is still in-flight — wait for it before flushing
      state.placeholderPromise.then((msgId) => doFlush(msgId)).catch(() => doFlush(null));
    } else {
      doFlush(state?.messageId ?? null);
    }
  }

  clearStreamingState(sessionId?: string): void {
    if (sessionId) {
      const state = this.streamingState.get(sessionId);
      if (state?.pendingEdit) clearTimeout(state.pendingEdit);
      this.streamingState.delete(sessionId);
      this.logger.info(`[telegram-bridge] Cleared streaming state for ${sessionId}`);
    } else {
      for (const [id, state] of this.streamingState) {
        if (state.pendingEdit) clearTimeout(state.pendingEdit);
        this.logger.info(`[telegram-bridge] Cleared streaming state for ${id}`);
      }
      this.streamingState.clear();
    }
  }

  private scheduleEdit(sessionId: string): void {
    const state = this.streamingState.get(sessionId);
    if (!state || state.messageId === null) return;

    state.pendingEdit = setTimeout(() => {
      this.flushEdit(sessionId);
    }, this.EDIT_THROTTLE_MS);
  }

  private flushEdit(sessionId: string): void {
    const state = this.streamingState.get(sessionId);
    if (!state || state.messageId === null) return;

    state.pendingEdit = null;
    const text = markdownToTelegramHtml(truncateMessage(state.accumulatedText));

    this.api.editMessageText(this.chatId, state.messageId, text, { parse_mode: "HTML" })
      .then(() => {
        this.logger.info(`[telegram-bridge] Throttled edit for ${sessionId}`);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("message is not modified") || msg.includes("message to edit not found")) {
          this.logger.info(`[telegram-bridge] Edit skipped (${msg.includes("not modified") ? "not modified" : "deleted"}): ${sessionId}`);
        } else {
          this.logger.info(`[telegram-bridge] Edit error: ${redactToken(msg, this.botToken)}`);
        }
      });
  }

  async handleAssistantMessage(
    sessionId: string,
    text: string,
  ): Promise<void> {
    const threadId = this.topicManager.getTopicForSession(sessionId);
    if (threadId == null) return;

    // If streaming already sent/edited a message for this turn, skip the duplicate
    if (this.streamingState.has(sessionId)) return;
    if (this.streamingGranularity === "throttled" || this.streamingGranularity === "final-only") {
      // Streaming modes handle delivery via handleStreamEnd — don't double-send
      return;
    }

    try {
      await this.api.sendMessage(this.chatId, markdownToTelegramHtml(text), {
        message_thread_id: threadId,
        parse_mode: "HTML",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.info(
        `[telegram-bridge] sendMessage error: ${redactToken(msg, this.botToken)}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Tool call status messages
  // -----------------------------------------------------------------------

  private toolStatusText(toolName: string, args: Record<string, unknown>): string {
    const name = escapeHtml(toolName);
    const filePath = args["file_path"] ?? args["path"] ?? args["filePath"];
    const command = args["command"];
    const pattern = args["pattern"] ?? args["query"];
    const description = args["description"];

    if (typeof filePath === "string") {
      const short = filePath.replace(/\\/g, "/").split("/").slice(-2).join("/");
      return `<b>${name}</b>  <code>${escapeHtml(short)}</code>`;
    }
    if (typeof description === "string" && description.length > 0) {
      const short = description.slice(0, 60);
      return `<b>${name}</b>  <i>${escapeHtml(short)}</i>`;
    }
    if (typeof command === "string") {
      const short = command.slice(0, 60);
      return `<b>${name}</b>  <code>${escapeHtml(short)}</code>`;
    }
    if (typeof pattern === "string") {
      return `<b>${name}</b>  <code>${escapeHtml(pattern.slice(0, 50))}</code>`;
    }
    return `<b>${name}</b>`;
  }

  handleToolStart(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void {
    const threadId = this.topicManager.getTopicForSession(sessionId);
    if (threadId == null) return;

    const summary = this.toolStatusText(toolName, args);
    const messageText = `⏳ ${summary}`;

    this.api.sendMessage(this.chatId, messageText, {
      message_thread_id: threadId,
      parse_mode: "HTML",
    }).then((msg) => {
      const tool: ActiveTool = {
        messageId: msg.message_id,
        threadId,
        toolName,
        summary,
        startMs: Date.now(),
      };
      this.logger.info(`[telegram-bridge] Tool start: ${toolName} (${toolCallId})`);
      const pending = this.pendingToolEnds.get(toolCallId);
      if (pending) {
        this.pendingToolEnds.delete(toolCallId);
        const icon = pending.isError ? "❌" : "✅";
        const durationStr = pending.durationMs != null
          ? `  <i>${(pending.durationMs / 1000).toFixed(1)}s</i>`
          : "";
        this.api.editMessageText(this.chatId, msg.message_id, `${icon} ${summary}${durationStr}`, {
          message_thread_id: threadId,
          parse_mode: "HTML",
        }).catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logger.info(`[telegram-bridge] Tool end (deferred) edit error: ${redactToken(errMsg, this.botToken)}`);
        });
      } else {
        this.activeTools.set(toolCallId, tool);
      }
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.info(`[telegram-bridge] Tool start send error: ${redactToken(msg, this.botToken)}`);
    });
  }

  handleToolEnd(
    toolCallId: string,
    isError: boolean,
    durationMs?: number,
  ): void {
    const tool = this.activeTools.get(toolCallId);
    if (!tool) {
      this.pendingToolEnds.set(toolCallId, { isError, durationMs });
      return;
    }
    this.activeTools.delete(toolCallId);

    const icon = isError ? "❌" : "✅";
    const durationStr = durationMs != null
      ? `  <i>${(durationMs / 1000).toFixed(1)}s</i>`
      : "";
    const newText = `${icon} ${tool.summary}${durationStr}`;

    this.api.editMessageText(this.chatId, tool.messageId, newText, {
      message_thread_id: tool.threadId,
      parse_mode: "HTML",
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.info(`[telegram-bridge] Tool end edit error: ${redactToken(msg, this.botToken)}`);
    });
  }
}
