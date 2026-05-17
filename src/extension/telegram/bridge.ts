import type { TelegramApi, TelegramUpdate, CallbackQuery } from "./api";
import { redactToken } from "./api";
import { TranscriptionError } from "../openai/transcribe";
import { truncateMessage, markdownToTelegramHtml, escapeHtml } from "./formatter";
import type { TopicManager, TopicManagerLogger } from "./topicManager";
import { PollerCoordinator } from "./poller-coordinator";
import * as fs from "fs";
import * as path from "path";

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
  originThreadId?: number | null; // number = topic thread, null = General topic
  isGeneralTopic?: boolean;
}

export type InboundMessageCallback = (sessionId: string, text: string, images?: BridgeImage[], opts?: { isGeneralTopic?: boolean }) => void;
export type RestartRequestCallback = (sessionId: string) => Promise<boolean>;
export type LaunchRequestCallback = (folderPath: string) => Promise<void>;

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
  private onRestartRequest: RestartRequestCallback | undefined;
  private readonly messageQueue = new Map<string, QueuedMessage[]>();
  private readonly processingSession = new Set<string>();
  private readonly pendingQuestions = new Map<string, PendingQuestion>();
  private readonly activeTools = new Map<string, ActiveTool>();
  private readonly pendingToolEnds = new Map<string, { isError: boolean; durationMs?: number }>();
  private readonly activeToolsBySession = new Map<string, Set<string>>();
  private readonly toolTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly ORPHANED_TOOL_TIMEOUT_MS = 5 * 60 * 1000;
  private coordinator: PollerCoordinator | null = null;
  private polling = false;
  private transcribeVoice: ((audioBuffer: Buffer) => Promise<string>) | undefined;
  private readonly typingLoops = new Map<string, ReturnType<typeof setInterval>>();
  private readonly turnStartMs = new Map<string, number>();
  private readonly TYPING_INTERVAL_MS = 4500;
  private readonly _activeDeliveries = new Set<Promise<void>>();
  private generalSessionId: string | null = null;
  private onLaunchRequest: LaunchRequestCallback | undefined;
  private ownerId: number | null = null;
  private projectSearchDirs: string[] = [];
  private pendingLaunchChoices: string[] = [];
  // Tracks which thread the current active prompt should respond to.
  // null = General topic (omit message_thread_id), number = specific topic thread.
  private readonly activeResponseThread = new Map<string, number | null>();

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
    transcribeVoice?: (audioBuffer: Buffer) => Promise<string>,
  ) {
    this.chatId = chatId;
    this.transcribeVoice = transcribeVoice;
  }

  setStreamingGranularity(value: "off" | "throttled" | "final-only"): void {
    this.streamingGranularity = value;
  }

  setOnInboundMessage(cb: InboundMessageCallback): void {
    this.onInboundMessage = cb;
  }

  setOnRestartRequest(cb: RestartRequestCallback): void {
    this.onRestartRequest = cb;
  }

  getGeneralSessionId(): string | null {
    return this.generalSessionId;
  }

  setGeneralSession(sessionId: string | null): void {
    this.generalSessionId = sessionId;
    this.logger.info(`[telegram-bridge] General session set to ${sessionId}`);
  }

  setOnLaunchRequest(cb: LaunchRequestCallback): void {
    this.onLaunchRequest = cb;
  }

  setOwnerId(id: number | null): void {
    this.ownerId = id;
  }

  setProjectSearchDirs(dirs: string[]): void {
    this.projectSearchDirs = dirs;
  }

  findProjects(query: string): string[] {
    const stopWords = new Set([
      "hey", "hi", "hello", "please", "can", "you", "the", "a", "an",
      "my", "in", "it", "its", "is", "at", "to", "for", "of", "on",
      "and", "or", "with", "this", "that", "from", "i", "me",
      "folder", "folders", "directory", "dir", "project", "projects",
      "launch", "open", "start", "go", "find", "switch", "load",
      "gsd", "vscode", "code", "session", "workspace", "up",
    ]);
    const words = query
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w));

    if (words.length === 0 || this.projectSearchDirs.length === 0) return [];

    const matches: { dir: string; score: number }[] = [];

    for (const baseDir of this.projectSearchDirs) {
      if (!fs.existsSync(baseDir)) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(baseDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        const folderLower = entry.name.toLowerCase().replace(/[-_\s]/g, "");
        const score = words.reduce((s, w) => {
          const wNorm = w.replace(/[-_\s]/g, "");
          if (folderLower === wNorm) return s + 3;
          if (folderLower.includes(wNorm) && wNorm.length >= 3) return s + 2;
          return s;
        }, 0);
        if (score >= 2) {
          matches.push({ dir: path.join(baseDir, entry.name), score });
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.map((m) => m.dir);
  }

  private getResponseThread(sessionId: string): number | null | undefined {
    if (this.activeResponseThread.has(sessionId)) {
      return this.activeResponseThread.get(sessionId)!;
    }
    const t = this.topicManager.getTopicForSession(sessionId);
    return t ?? undefined;
  }

  private sendToThread(threadId: number | null | undefined, text: string, opts: Record<string, unknown> = {}): Promise<{ message_id: number }> {
    const sendOpts: Record<string, unknown> = { ...opts };
    if (threadId != null) sendOpts.message_thread_id = threadId;
    return this.api.sendMessage(this.chatId, text, sendOpts);
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
      if (message.from?.is_bot) {
        this.logger.info("[telegram-bridge] Skipping bot message");
        continue;
      }

      // Strip @botname suffix that Telegram appends to slash commands in groups
      // e.g. "/gsd@MyBot" → "/gsd", "/restart@MyBot arg" → "/restart arg"
      const normalizeCommand = (t: string) =>
        t.replace(/^(\/\w+)@\w+/, "$1");
      const rawText = normalizeCommand(
        hasPhoto
          ? (message.caption ?? message.text ?? "")
          : (message.text ?? ""),
      );
      if (rawText.toLowerCase().startsWith("/telegram")) {
        this.logger.info("[telegram-bridge] Skipping /telegram command");
        continue;
      }

      if (rawText.toLowerCase() === "/whoami") {
        const userId = message.from?.id;
        const username = message.from?.username ? ` (@${message.from.username})` : "";
        const whoamiOpts: Record<string, unknown> = { parse_mode: "Markdown" };
        if (message.message_thread_id != null) whoamiOpts.message_thread_id = message.message_thread_id;
        await this.api.sendMessage(
          this.chatId,
          `Your Telegram user ID: \`${String(userId)}\`${username}`,
          whoamiOpts,
        );
        continue;
      }

      // Owner gate: deny all commands (except /whoami above) when sender isn't the owner
      if (!this.ownerId) {
        this.logger.info(`[telegram-bridge] Command denied — no owner ID configured. Use /whoami to get your ID.`);
        await this.sendToThread(
          message.message_thread_id ?? null,
          "⛔ No owner ID configured. Send /whoami to get your Telegram ID, then set it in the GSD extension settings.",
        ).catch(() => {});
        continue;
      }
      if (message.from?.id !== this.ownerId) {
        this.logger.info(`[telegram-bridge] Command denied — sender ${message.from?.id} is not owner ${this.ownerId}`);
        continue;
      }

      const isGeneralTopic = message.message_thread_id == null;

      // General topic: commands, project search, then fall through to general session
      if (isGeneralTopic) {
        if (await this.tryNumberedSelection(rawText)) continue;

        // Explicit /launch <path> — literal path
        const launchPath = this.parseLaunchCommand(rawText);
        if (rawText.trim().startsWith("/") && launchPath) {
          await this.handleLaunchCommand(launchPath);
          continue;
        }

        // Natural language project search
        const handled = await this.tryProjectSearch(rawText);
        if (handled) continue;

        // Route to general session if one exists
        if (this.generalSessionId) {
          const sessionId = this.generalSessionId;
          this.enqueueMessage(sessionId, {
            text: rawText,
            routeLabel: "text",
            originThreadId: null,
            isGeneralTopic: true,
          });
          continue;
        }

        // No session, no match
        this.logger.info(`[telegram-bridge] General topic: no general session`);
        const hint = this.projectSearchDirs.length > 0
          ? "💬 No active session. Try telling me which project to launch — e.g. \"open RokketDocs\"."
          : "⚠️ No active session and no project search directories configured. Use <code>/launch &lt;path&gt;</code> or configure <code>gsd.telegramProjectDirs</code>.";
        await this.sendToThread(null, hint, { parse_mode: "HTML" }).catch(() => {});
        continue;
      }

      // At this point, isGeneralTopic messages have already been handled above
      const sessionId = this.topicManager.getSessionForTopic(message.message_thread_id!);
      if (!sessionId) {
        this.logger.info(
          `[telegram-bridge] No session for topic ${message.message_thread_id}`,
        );
        continue;
      }

      const originThreadId = message.message_thread_id!;

      if (rawText.toLowerCase() === "/restart") {
        if (originThreadId != null) {
          await this.handleRestartCommand(sessionId, originThreadId);
        }
        continue;
      }

      // Handle voice transcription
      if (hasVoice) {
        const voiceThreadId = originThreadId ?? undefined;
        if (voiceThreadId != null) {
          await this.handleVoiceMessage(sessionId, message.voice!.file_id, voiceThreadId);
        } else {
          await this.handleVoiceMessage(sessionId, message.voice!.file_id, undefined as unknown as number);
        }
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
      this.enqueueMessage(sessionId, { text, images, routeLabel, originThreadId, isGeneralTopic: false });
    }
  }

  parseLaunchCommand(text: string): string | null {
    const trimmed = text.trim();
    // /launch <path>
    const slashMatch = trimmed.match(/^\/launch\s+(.+)$/i);
    if (slashMatch) return slashMatch[1].trim();
    // "launch gsd in <path>" / "launch <path>" / "open <path>"
    const naturalMatch = trimmed.match(/^(?:launch\s+(?:gsd\s+in\s+)?|open\s+(?:project\s+)?)(.+)$/i);
    if (naturalMatch) return naturalMatch[1].trim();
    return null;
  }

  private async tryProjectSearch(text: string): Promise<boolean> {
    if (this.projectSearchDirs.length === 0) return false;
    const matches = this.findProjects(text);
    if (matches.length === 0) return false;
    if (matches.length === 1) {
      await this.handleLaunchCommand(matches[0]);
      return true;
    }
    const top = matches.slice(0, 5);
    this.pendingLaunchChoices = top;
    const lines = top.map((p, i) => `${i + 1}. ${escapeHtml(path.basename(p))}`);
    lines.unshift("Found multiple matches — reply with a number:");
    await this.sendToThread(null, lines.join("\n"), { parse_mode: "HTML" }).catch(() => {});
    return true;
  }

  private async tryNumberedSelection(text: string): Promise<boolean> {
    if (this.pendingLaunchChoices.length === 0) return false;
    const num = parseInt(text.trim(), 10);
    if (isNaN(num) || num < 1 || num > this.pendingLaunchChoices.length) return false;
    const chosen = this.pendingLaunchChoices[num - 1];
    this.pendingLaunchChoices = [];
    await this.handleLaunchCommand(chosen);
    return true;
  }

  private async handleLaunchCommand(folderPath: string): Promise<void> {
    this.logger.info(`[telegram-bridge] Launch command: "${folderPath}"`);
    if (!this.onLaunchRequest) {
      await this.sendToThread(null, "⚠️ Launch is not available — no handler configured.").catch(() => {});
      return;
    }
    await this.sendToThread(null, `🚀 Launching GSD in <code>${escapeHtml(folderPath)}</code>…`, { parse_mode: "HTML" }).catch(() => {});
    try {
      await this.onLaunchRequest(folderPath);
      await this.sendToThread(null, `✅ Opened <code>${escapeHtml(folderPath)}</code> — a new topic will appear when sync starts.`, { parse_mode: "HTML" }).catch(() => {});
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.info(`[telegram-bridge] Launch failed: ${errMsg}`);
      await this.sendToThread(null, `❌ Launch failed: ${escapeHtml(errMsg)}`, { parse_mode: "HTML" }).catch(() => {});
    }
  }

  private async handleVoiceMessage(sessionId: string, fileId: string, threadId: number): Promise<void> {
    this.logger.info(`[telegram-bridge] Voice message received for ${sessionId}, file_id=${fileId}`);

    if (!this.transcribeVoice) {
      this.logger.info("[telegram-bridge] No transcription provider configured — cannot transcribe voice");
      await this.api.sendMessage(this.chatId, "⚠️ Voice transcription is not configured. Set an API key for your chosen provider in the voice settings.", {
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
      const transcript = await this.transcribeVoice(audioBuffer);

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

    const notifyUnavailable = (reason: string, responseThread: number | null | undefined) => {
      this.logger.info(`[telegram-bridge] GSD unavailable for ${sessionId}: ${reason}`);
      if (responseThread === undefined) return;
      const sendOpts: Record<string, unknown> = {
        reply_markup: {
          inline_keyboard: [[{ text: "🔄 Restart GSD", callback_data: `restart:${sessionId}` }]],
        },
      };
      if (responseThread != null) sendOpts.message_thread_id = responseThread;
      this.api.sendMessage(
        this.chatId,
        `⚠️ GSD is not responding — ${reason}. Your message was received but could not be delivered.`,
        sendOpts,
      ).catch((err: unknown) => this.logger.info(`[telegram-bridge] failed to send unavailable notice: ${err instanceof Error ? err.message : String(err)}`));
    };

    const deliver = async () => {
      // Determine response thread: use originThreadId from the queued message,
      // falling back to the session's registered topic
      const responseThread: number | null | undefined = msg.originThreadId !== undefined
        ? msg.originThreadId
        : (this.topicManager.getTopicForSession(sessionId) ?? undefined);

      // Set active response thread so outbound methods route to the right place
      if (responseThread !== undefined) {
        this.activeResponseThread.set(sessionId, responseThread);
      }

      let current = await waitForClient();
      if (!current?.client) {
        notifyUnavailable("the session is not running", responseThread);
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
          notifyUnavailable("the session stopped while handling a previous message", responseThread);
          return;
        }
      }

      this.onInboundMessage?.(sessionId, msg.text, msg.images, { isGeneralTopic: msg.isGeneralTopic });
      if (responseThread !== undefined) {
        this.startTypingLoop(sessionId, responseThread);
      }
      this.logger.info(`[telegram-bridge] Calling prompt for ${sessionId}`);
      const promptPromise = current.client.prompt(msg.text, msg.images);
      const timeoutPromise = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), this.PROMPT_TIMEOUT_MS));
      const result = await Promise.race([promptPromise, timeoutPromise]);
      if (result === "timeout") {
        this.stopTypingLoop(sessionId);
        this.logger.info(`[telegram-bridge] prompt timed out for ${sessionId} — continuing drain`);
        notifyUnavailable("the process stopped responding", responseThread);
      } else {
        this.logger.info(`[telegram-bridge] Routed ${msg.routeLabel} to ${sessionId}`);
      }
    };

    const deliveryPromise = deliver()
      .catch((err: unknown) => {
        this.stopTypingLoop(sessionId);
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.info(`[telegram-bridge] prompt error for ${sessionId}: ${redactToken(errMsg, this.botToken)}`);
        const catchResponseThread = this.getResponseThread(sessionId);
        notifyUnavailable("an unexpected error occurred", catchResponseThread);
      })
      .finally(() => {
        this.activeResponseThread.delete(sessionId);
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
    const threadId = this.getResponseThread(sessionId);
    if (threadId === undefined) {
      this.logger.info(`[telegram-bridge] sendQuestion: no topic for session ${sessionId}`);
      return null;
    }

    const callbackPrefix = `q:${requestId}:`;
    const inlineKeyboard = options.map((opt, i) => [{
      text: opt,
      callback_data: `${callbackPrefix}${i}`,
    }]);

    try {
      const sendOpts: Record<string, unknown> = {
        reply_markup: { inline_keyboard: inlineKeyboard },
      };
      if (threadId != null) sendOpts.message_thread_id = threadId;
      const msg = await this.api.sendMessage(this.chatId, `❓ ${title}`, sendOpts);

      const optionMap = new Map<string, string>();
      options.forEach((opt, i) => optionMap.set(`${callbackPrefix}${i}`, opt));

      return new Promise<string | null>((resolve) => {
        this.pendingQuestions.set(requestId, {
          resolve,
          optionMap,
          messageId: msg.message_id,
          threadId: threadId ?? 0,
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

  private async handleRestartCommand(sessionId: string, threadId: number): Promise<void> {
    this.logger.info(`[telegram-bridge] /restart command for ${sessionId}`);
    if (!this.onRestartRequest) {
      await this.api.sendMessage(this.chatId, "⚠️ Restart is not available.", { message_thread_id: threadId })
        .catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
      return;
    }
    const statusMsg = await this.api.sendMessage(this.chatId, "🔄 Restarting GSD…", { message_thread_id: threadId })
      .catch(() => null);
    const ok = await this.onRestartRequest(sessionId).catch(() => false);
    const resultText = ok ? "✅ GSD restarted." : "❌ Restart failed — no active session to restart.";
    if (statusMsg) {
      await this.api.editMessageText(this.chatId, statusMsg.message_id, resultText, { message_thread_id: threadId })
        .catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
    } else {
      await this.api.sendMessage(this.chatId, resultText, { message_thread_id: threadId })
        .catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
    }
  }

  private async handleCallbackQuery(query: CallbackQuery): Promise<void> {
    const data = query.data;
    if (!data) return;

    if (data.startsWith("restart:")) {
      const sessionId = data.slice("restart:".length);
      const threadId = this.topicManager.getTopicForSession(sessionId);
      await this.api.answerCallbackQuery(query.id, "Restarting…").catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
      if (threadId != null) {
        await this.handleRestartCommand(sessionId, threadId);
      }
      return;
    }

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

  private startTypingLoop(sessionId: string, threadId: number | null): void {
    if (this.typingLoops.has(sessionId)) return;
    this.turnStartMs.set(sessionId, Date.now());
    const sendAction = () => {
      const opts: Record<string, unknown> = {};
      if (threadId != null) opts.message_thread_id = threadId;
      this.api.sendChatAction(this.chatId, "typing", opts).catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
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

    const threadId = this.getResponseThread(sessionId);
    if (threadId === undefined) {
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
      const sendOpts: Record<string, unknown> = {};
      if (threadId != null) sendOpts.message_thread_id = threadId;
      state.placeholderPromise = this.api.sendMessage(this.chatId, "…", sendOpts)
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
    const threadId = this.getResponseThread(sessionId);
    if (threadId === undefined) {
      this.logger.info(`[telegram-bridge] handleStreamEnd: no topic for session ${sessionId} (known sessions: ${this.topicManager.activeSessions.join(",")})`);
      return;
    }
    this.logger.info(`[telegram-bridge] handleStreamEnd: session=${sessionId}, hasState=${!!state}, messageId=${state?.messageId}, textLen=${finalText.length}`);

    const doFlush = async (resolvedMessageId: number | null) => {
      if (state?.pendingEdit) {
        clearTimeout(state.pendingEdit);
        state.pendingEdit = null;
      }

      const text = markdownToTelegramHtml(truncateMessage(finalText));

      if (!resolvedMessageId) {
        this.streamingState.delete(sessionId);
        if (finalText) {
          const sendOpts: Record<string, unknown> = { parse_mode: "HTML" };
          if (threadId != null) sendOpts.message_thread_id = threadId;
          await this.api.sendMessage(this.chatId, text, sendOpts)
            .then(() => this.logger.info(`[telegram-bridge] Sent final (no stream) for ${sessionId}`))
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              this.logger.info(`[telegram-bridge] Send final error: ${redactToken(msg, this.botToken)}`);
            });
        }
      } else {
        await this.api.editMessageText(this.chatId, resolvedMessageId, text, { parse_mode: "HTML" })
          .then(() => this.logger.info(`[telegram-bridge] Final flush for ${sessionId}`))
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.info(`[telegram-bridge] Final edit error: ${redactToken(msg, this.botToken)}`);
          })
          .finally(() => this.streamingState.delete(sessionId));
      }
    };

    if (state?.placeholderPromise) {
      // Placeholder send is still in-flight — wait for it before flushing
      state.placeholderPromise.then((msgId) => doFlush(msgId)).catch(() => doFlush(null));
    } else {
      doFlush(state?.messageId ?? null);
    }
  }

  handleAgentEnd(sessionId: string): void {
    const threadId = this.getResponseThread(sessionId);
    if (threadId === undefined) return;

    const elapsedMs = this.stopTypingLoop(sessionId);
    const elapsedStr = elapsedMs != null ? `  <i>${(elapsedMs / 1000).toFixed(1)}s</i>` : "";
    this.logger.info(`[telegram-bridge] Agent end for ${sessionId}, elapsed=${elapsedMs}ms`);

    const sendOpts: Record<string, unknown> = { parse_mode: "HTML" };
    if (threadId != null) sendOpts.message_thread_id = threadId;
    this.api.sendMessage(this.chatId, `✅ Done${elapsedStr}`, sendOpts)
      .catch((err: unknown) => console.warn("[telegram]", err instanceof Error ? err.message : err));
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
    const threadId = this.getResponseThread(sessionId);
    if (threadId === undefined) return;

    // If streaming already sent/edited a message for this turn, skip the duplicate
    if (this.streamingState.has(sessionId)) return;
    if (this.streamingGranularity === "throttled" || this.streamingGranularity === "final-only") {
      return;
    }

    try {
      const sendOpts: Record<string, unknown> = { parse_mode: "HTML" };
      if (threadId != null) sendOpts.message_thread_id = threadId;
      await this.api.sendMessage(this.chatId, markdownToTelegramHtml(text), sendOpts);
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
    const threadId = this.getResponseThread(sessionId);
    if (threadId === undefined) return;

    let sessionTools = this.activeToolsBySession.get(sessionId);
    if (!sessionTools) {
      sessionTools = new Set();
      this.activeToolsBySession.set(sessionId, sessionTools);
    }
    sessionTools.add(toolCallId);

    // Safety net: if the tool never resolves, treat it as complete after timeout
    const orphanTimer = setTimeout(() => {
      this.logger.info(`[telegram-bridge] Orphaned tool timeout: ${toolName} (${toolCallId})`);
      this.toolTimeouts.delete(toolCallId);
      this.handleToolEnd(toolCallId, true);
    }, this.ORPHANED_TOOL_TIMEOUT_MS);
    this.toolTimeouts.set(toolCallId, orphanTimer);


    const summary = this.toolStatusText(toolName, args);
    const messageText = `⏳ ${summary}`;

    const sendOpts: Record<string, unknown> = { parse_mode: "HTML" };
    if (threadId != null) sendOpts.message_thread_id = threadId;
    this.api.sendMessage(this.chatId, messageText, sendOpts).then((msg) => {
      const resolvedThreadId = threadId ?? 0;
      const tool: ActiveTool = {
        messageId: msg.message_id,
        threadId: resolvedThreadId,
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
        const editOpts: Record<string, unknown> = { parse_mode: "HTML" };
        if (resolvedThreadId) editOpts.message_thread_id = resolvedThreadId;
        this.api.editMessageText(this.chatId, msg.message_id, `${icon} ${summary}${durationStr}`, editOpts).catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logger.info(`[telegram-bridge] Tool end (deferred) edit error: ${redactToken(errMsg, this.botToken)}`);
        }).finally(() => {
          this._removeFromSessionTools(toolCallId);
        });
      } else {
        this.activeTools.set(toolCallId, tool);
      }
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.info(`[telegram-bridge] Tool start send error: ${redactToken(msg, this.botToken)}`);
      this._removeFromSessionTools(toolCallId);
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

    this._removeFromSessionTools(toolCallId);
  }

  private _removeFromSessionTools(toolCallId: string): void {
    const timer = this.toolTimeouts.get(toolCallId);
    if (timer) {
      clearTimeout(timer);
      this.toolTimeouts.delete(toolCallId);
    }
    for (const [sessionId, toolSet] of this.activeToolsBySession) {
      if (toolSet.has(toolCallId)) {
        toolSet.delete(toolCallId);
        if (toolSet.size === 0) {
          this.activeToolsBySession.delete(sessionId);
        }
        break;
      }
    }
  }
}
