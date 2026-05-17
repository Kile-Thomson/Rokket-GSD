import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramBridge } from "./bridge";
import type { TelegramApi, TelegramUpdate } from "./api";
import type { TopicManager, TopicManagerLogger } from "./topicManager";
import type { BridgeClient, BridgeSessionState } from "./bridge";
import * as fs from "fs";

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockReturnValue([]),
  },
}));

function createMockApi(updates: TelegramUpdate[] = []): TelegramApi {
  let callCount = 0;
  return {
    getUpdates: vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? updates : []);
    }),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 1, type: "supergroup" } }),
    editMessageText: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 1, type: "supergroup" } }),
    sendChatAction: vi.fn().mockResolvedValue(true),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    getFile: vi.fn().mockResolvedValue({ file_id: "fid", file_unique_id: "u", file_path: "photos/file_0.jpg" }),
    downloadFile: vi.fn().mockResolvedValue({ base64: "aW1hZ2VkYXRh", mimeType: "image/jpeg" }),
  } as unknown as TelegramApi;
}

function createMockTopicManager(
  topicToSession: Map<number, string> = new Map(),
  sessionToTopic: Map<string, number> = new Map(),
): TopicManager {
  return {
    getSessionForTopic: vi.fn().mockImplementation((threadId: number) =>
      topicToSession.get(threadId),
    ),
    getTopicForSession: vi.fn().mockImplementation((sessionId: string) =>
      sessionToTopic.get(sessionId),
    ),
  } as unknown as TopicManager;
}

function createMockClient(): BridgeClient {
  return {
    abort: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
  };
}

function createLogger(): TopicManagerLogger {
  return { info: vi.fn(), warn: vi.fn() };
}

const CHAT_ID = -100123;
const BOT_TOKEN = "123:ABC";

describe("TelegramBridge", () => {
  let api: ReturnType<typeof createMockApi>;
  let topicManager: ReturnType<typeof createMockTopicManager>;
  let logger: ReturnType<typeof createLogger>;
  let sessions: Map<string, BridgeSessionState>;
  let bridge: TelegramBridge;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    bridge?.stopPolling();
    vi.useRealTimers();
  });

  function setup(
    updates: TelegramUpdate[] = [],
    topicToSession = new Map<number, string>(),
    sessionToTopic = new Map<string, number>(),
    sessionMap = new Map<string, BridgeSessionState>(),
  ) {
    api = createMockApi(updates);
    topicManager = createMockTopicManager(topicToSession, sessionToTopic);
    logger = createLogger();
    sessions = sessionMap;
    bridge = new TelegramBridge(
      api,
      topicManager as unknown as TopicManager,
      (id) => sessions.get(id),
      logger,
      BOT_TOKEN,
      CHAT_ID,
    );
    bridge.setOwnerId(99);
  }

  describe("polling", () => {
    it("calls getUpdates and schedules next poll", async () => {
      setup();
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.getUpdates).toHaveBeenCalledWith(undefined);

      await vi.advanceTimersByTimeAsync(2000);
      expect(api.getUpdates).toHaveBeenCalledTimes(2);
    });

    it("tracks offset from last update_id + 1", async () => {
      setup([{ update_id: 42, message: { message_id: 1, chat: { id: 1, type: "g" } } }]);
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(api.getUpdates).toHaveBeenLastCalledWith(43);
    });

    it("stopPolling prevents further polls", async () => {
      setup();
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      bridge.stopPolling();
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.getUpdates).toHaveBeenCalledTimes(1);
    });
  });

  describe("inbound routing", () => {
    it("routes text message to correct session", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hello",
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).toHaveBeenCalledWith("hello", undefined);
    });

    it("routes slash command to session", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "/gsd status",
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).toHaveBeenCalledWith("/gsd status", undefined);
    });

    it("aborts before prompting when session is streaming", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: true }]]));
      const injectPromise = bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hi",
          message_thread_id: 200,
        },
      }]);
      // Advance past the 800ms settle delay after abort
      await vi.advanceTimersByTimeAsync(1000);
      await injectPromise;
      expect(client.abort).toHaveBeenCalled();
      expect(client.prompt).toHaveBeenCalledWith("hi", undefined);
    });

    it("skips bot messages", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: true, first_name: "Bot" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "bot msg",
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).not.toHaveBeenCalled();
    });

    it("skips /telegram commands", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "/telegram setup",
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).not.toHaveBeenCalled();
    });

    it("skips updates without message", async () => {
      setup();
      await bridge._testInjectUpdates([{ update_id: 1 }]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("without message"),
      );
    });

    it("skips messages without text or photo", async () => {
      setup();
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: { message_id: 1, chat: { id: 1, type: "g" }, message_thread_id: 200 },
      }]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("without text, photo, or voice"),
      );
    });

    it("sends concierge-unavailable for General topic when no general session", async () => {
      setup();
      bridge.setOwnerId(99);
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hi",
        },
      }]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("no general session"),
      );
      expect(api.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("No active session"),
        expect.anything(),
      );
    });

    it("skips when no session for topic", async () => {
      setup([], new Map());
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hi",
          message_thread_id: 999,
        },
      }]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("No session for topic"),
      );
    });

    it("skips when session has no client", async () => {
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client: null, isStreaming: false }]]));
      const injectPromise = bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hi",
          message_thread_id: 200,
        },
      }]);
      // CLIENT_MAX_RETRIES * CLIENT_RETRY_MS = 5 * 2000 = 10000ms
      await vi.advanceTimersByTimeAsync(11000);
      await injectPromise;
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("GSD unavailable for s1"),
      );
    });
  });

  describe("handleAssistantMessage", () => {
    it("sends message to correct topic", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      bridge.setStreamingGranularity("off");
      await bridge.handleAssistantMessage("s1", "response text");
      expect(api.sendMessage).toHaveBeenCalledWith(CHAT_ID, "response text", {
        message_thread_id: 300,
        parse_mode: "HTML",
      });
    });

    it("does nothing when no topic for session", async () => {
      setup();
      bridge.setStreamingGranularity("off");
      await bridge.handleAssistantMessage("s1", "text");
      expect(api.sendMessage).not.toHaveBeenCalled();
    });

    it("does nothing in throttled streaming mode (default)", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      await bridge.handleAssistantMessage("s1", "text");
      expect(api.sendMessage).not.toHaveBeenCalled();
    });

    it("logs error but does not throw on sendMessage failure", async () => {
      api = {
        getUpdates: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockRejectedValue(new Error("network error")),
      } as unknown as TelegramApi;
      topicManager = createMockTopicManager(new Map(), new Map([["s1", 300]]));
      logger = createLogger();
      sessions = new Map();
      bridge = new TelegramBridge(
        api,
        topicManager as unknown as TopicManager,
        (id) => sessions.get(id),
        logger,
        BOT_TOKEN,
        CHAT_ID,
      );
      bridge.setStreamingGranularity("off");
      await bridge.handleAssistantMessage("s1", "text");
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("sendMessage error"),
      );
    });
  });

  describe("streaming", () => {
    it("sends placeholder on first chunk and stores message_id", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      bridge.handleStreamingChunk("s1", "hello");
      await vi.advanceTimersByTimeAsync(0);
      expect(api.sendMessage).toHaveBeenCalledWith(CHAT_ID, "…", { message_thread_id: 300 });
    });

    it("accumulates multiple rapid chunks", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      bridge.handleStreamingChunk("s1", "a");
      await vi.advanceTimersByTimeAsync(0); // placeholder sends
      bridge.handleStreamingChunk("s1", "b");
      bridge.handleStreamingChunk("s1", "c");
      await vi.advanceTimersByTimeAsync(2000); // throttle fires
      expect(api.editMessageText).toHaveBeenCalledWith(
        CHAT_ID, 1, expect.stringContaining("abc"), { parse_mode: "HTML" },
      );
    });

    it("throttles edits to one per 2s window", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      bridge.handleStreamingChunk("s1", "a");
      await vi.advanceTimersByTimeAsync(0);
      bridge.handleStreamingChunk("s1", "b");
      await vi.advanceTimersByTimeAsync(500);
      bridge.handleStreamingChunk("s1", "c");
      await vi.advanceTimersByTimeAsync(500);
      // Only 1s elapsed since schedule — no edit yet
      expect(api.editMessageText).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000); // 2s total
      expect(api.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("final flush clears timer and edits immediately", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      bridge.handleStreamingChunk("s1", "partial");
      await vi.advanceTimersByTimeAsync(0); // placeholder
      bridge.handleStreamingChunk("s1", " more");
      // Don't advance timer — pending edit is scheduled
      bridge.handleStreamEnd("s1", "final text");
      await vi.advanceTimersByTimeAsync(0);
      expect(api.editMessageText).toHaveBeenCalledWith(CHAT_ID, 1, "final text", { parse_mode: "HTML" });
    });

    it("clearStreamingState cancels pending timers", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      bridge.handleStreamingChunk("s1", "data");
      await vi.advanceTimersByTimeAsync(0);
      bridge.clearStreamingState("s1");
      await vi.advanceTimersByTimeAsync(3000);
      expect(api.editMessageText).not.toHaveBeenCalled();
    });

    it("does nothing when granularity is off", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      bridge.setStreamingGranularity("off");
      bridge.handleStreamingChunk("s1", "data");
      await vi.advanceTimersByTimeAsync(0);
      expect(api.sendMessage).not.toHaveBeenCalled();
    });

    it("final-only mode skips chunks, handleStreamEnd sends nothing without prior chunks state", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      bridge.setStreamingGranularity("final-only");
      bridge.handleStreamingChunk("s1", "data");
      await vi.advanceTimersByTimeAsync(0);
      expect(api.sendMessage).not.toHaveBeenCalled();
      // handleStreamEnd with no streaming state (no messageId) does nothing
      bridge.handleStreamEnd("s1", "final");
      await vi.advanceTimersByTimeAsync(0);
      expect(api.editMessageText).not.toHaveBeenCalled();
    });

    it("swallows 'message is not modified' error", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      (api.editMessageText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("message is not modified"),
      );
      bridge.handleStreamingChunk("s1", "data");
      await vi.advanceTimersByTimeAsync(0); // placeholder
      bridge.handleStreamingChunk("s1", "more");
      await vi.advanceTimersByTimeAsync(2000); // throttle fires, edit throws
      // Should not crash — logger captures it
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("not modified"),
      );
    });

    it("swallows 400 deleted message error", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      (api.editMessageText as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("message to edit not found"),
      );
      bridge.handleStreamingChunk("s1", "data");
      await vi.advanceTimersByTimeAsync(0);
      bridge.handleStreamingChunk("s1", "more");
      await vi.advanceTimersByTimeAsync(2000);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("deleted"),
      );
    });

    it("truncates text over 4096 chars on edit", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      bridge.handleStreamingChunk("s1", "x".repeat(5000));
      await vi.advanceTimersByTimeAsync(0); // placeholder
      bridge.handleStreamEnd("s1", "y".repeat(5000));
      await vi.advanceTimersByTimeAsync(0);
      const editCall = (api.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((editCall[2] as string).length).toBe(4096);
      expect((editCall[2] as string).endsWith("…(truncated)")).toBe(true);
    });

    it("handleStreamEnd with no prior chunks deletes state silently", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      // No chunks sent, call handleStreamEnd directly
      bridge.handleStreamEnd("s1", "final text");
      await vi.advanceTimersByTimeAsync(0);
      expect(api.editMessageText).not.toHaveBeenCalled();
      expect(api.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("continues polling after getUpdates error", async () => {
      api = {
        getUpdates: vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue([]),
        sendMessage: vi.fn(),
      } as unknown as TelegramApi;
      topicManager = createMockTopicManager();
      logger = createLogger();
      sessions = new Map();
      bridge = new TelegramBridge(
        api,
        topicManager as unknown as TopicManager,
        (id) => sessions.get(id),
        logger,
        BOT_TOKEN,
        CHAT_ID,
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("getUpdates error"),
      );
      // After error, backoff ~4000-4999ms; advance past it
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.getUpdates).toHaveBeenCalledTimes(2); // retried after backoff
    });

    it("continues polling after prompt error", async () => {
      const client = createMockClient();
      (client.prompt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("prompt fail"));
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hi",
          message_thread_id: 200,
        },
      }]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("prompt error"),
      );
    });
  });

  describe("exponential backoff", () => {
    it("increases delay on consecutive errors", async () => {
      api = {
        getUpdates: vi.fn().mockRejectedValue(new Error("network down")),
        sendMessage: vi.fn(),
      } as unknown as TelegramApi;
      topicManager = createMockTopicManager();
      logger = createLogger();
      sessions = new Map();
      bridge = new TelegramBridge(
        api, topicManager as unknown as TopicManager,
        (id) => sessions.get(id), logger, BOT_TOKEN, CHAT_ID,
      );

      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0); // first poll fails
      expect(api.getUpdates).toHaveBeenCalledTimes(1);

      // After first error: backoff = min(2000*2^1, 30000) + jitter(0-999) = 4000-4999ms
      // Advance past max possible delay
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.getUpdates).toHaveBeenCalledTimes(2);

      // After second error: backoff = min(2000*2^2, 30000) + jitter = 8000-8999ms
      await vi.advanceTimersByTimeAsync(9000);
      expect(api.getUpdates).toHaveBeenCalledTimes(3);
    });

    it("resets backoff on success", async () => {
      let callCount = 0;
      api = {
        getUpdates: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error("fail"));
          return Promise.resolve([]);
        }),
        sendMessage: vi.fn(),
      } as unknown as TelegramApi;
      topicManager = createMockTopicManager();
      logger = createLogger();
      sessions = new Map();
      bridge = new TelegramBridge(
        api, topicManager as unknown as TopicManager,
        (id) => sessions.get(id), logger, BOT_TOKEN, CHAT_ID,
      );

      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0); // first poll fails

      // Advance past backoff
      await vi.advanceTimersByTimeAsync(5000);
      expect(api.getUpdates).toHaveBeenCalledTimes(2); // second call succeeds

      // After success, next poll should be at BASE_DELAY (2000ms), not backoff
      await vi.advanceTimersByTimeAsync(2000);
      expect(api.getUpdates).toHaveBeenCalledTimes(3);
    });

    it("caps delay at MAX_DELAY_MS even after 100 errors", async () => {
      api = {
        getUpdates: vi.fn().mockRejectedValue(new Error("down")),
        sendMessage: vi.fn(),
      } as unknown as TelegramApi;
      topicManager = createMockTopicManager();
      logger = createLogger();
      sessions = new Map();
      bridge = new TelegramBridge(
        api, topicManager as unknown as TopicManager,
        (id) => sessions.get(id), logger, BOT_TOKEN, CHAT_ID,
      );

      bridge.startPolling();
      // Run through many errors
      for (let i = 0; i < 100; i++) {
        await vi.advanceTimersByTimeAsync(31000); // MAX_DELAY + max jitter
      }

      // Verify backoff log message shows delay <= 31000 (30000 + 999 jitter)
      const calls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
      const backoffLogs = calls.filter((c: string[]) => c[0].includes("backoff"));
      for (const log of backoffLogs) {
        const match = log[0].match(/backoff (\d+)ms/);
        if (match) {
          expect(parseInt(match[1], 10)).toBeLessThanOrEqual(31000);
        }
      }
    });

    it("stopPolling clears backoff state", async () => {
      api = {
        getUpdates: vi.fn()
          .mockRejectedValueOnce(new Error("fail"))
          .mockRejectedValueOnce(new Error("fail"))
          .mockResolvedValue([]),
        sendMessage: vi.fn(),
      } as unknown as TelegramApi;
      topicManager = createMockTopicManager();
      logger = createLogger();
      sessions = new Map();
      bridge = new TelegramBridge(
        api, topicManager as unknown as TopicManager,
        (id) => sessions.get(id), logger, BOT_TOKEN, CHAT_ID,
      );

      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0); // error 1
      await vi.advanceTimersByTimeAsync(5000); // error 2
      bridge.stopPolling();

      // Restart — should use BASE_DELAY, not continued backoff
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0); // succeeds
      // Next poll at BASE_DELAY
      await vi.advanceTimersByTimeAsync(2000);
      expect(api.getUpdates).toHaveBeenCalledTimes(4); // 2 errors + 1 restart + 1 base delay
    });

    it("stopPolling during backoff wait clears timer", async () => {
      api = {
        getUpdates: vi.fn().mockRejectedValue(new Error("fail")),
        sendMessage: vi.fn(),
      } as unknown as TelegramApi;
      topicManager = createMockTopicManager();
      logger = createLogger();
      sessions = new Map();
      bridge = new TelegramBridge(
        api, topicManager as unknown as TopicManager,
        (id) => sessions.get(id), logger, BOT_TOKEN, CHAT_ID,
      );

      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0); // first poll fails, backoff timer set
      bridge.stopPolling(); // should clear the timer

      await vi.advanceTimersByTimeAsync(60000); // wait well past any backoff
      expect(api.getUpdates).toHaveBeenCalledTimes(1); // no zombie poll
    });

    it("logs backoff delay and consecutive error count", async () => {
      api = {
        getUpdates: vi.fn().mockRejectedValue(new Error("timeout")),
        sendMessage: vi.fn(),
      } as unknown as TelegramApi;
      topicManager = createMockTopicManager();
      logger = createLogger();
      sessions = new Map();
      bridge = new TelegramBridge(
        api, topicManager as unknown as TopicManager,
        (id) => sessions.get(id), logger, BOT_TOKEN, CHAT_ID,
      );

      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/attempt 1, backoff \d+ms/),
      );
    });
  });

  describe("photo routing", () => {
    const photoSizes = [
      { file_id: "small", file_unique_id: "s", width: 90, height: 90 },
      { file_id: "large", file_unique_id: "l", width: 800, height: 600 },
    ];

    it("routes photo-only message with image", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          photo: photoSizes,
          message_thread_id: 200,
        },
      }]);
      expect(api.getFile).toHaveBeenCalledWith("large");
      expect(api.downloadFile).toHaveBeenCalledWith("photos/file_0.jpg");
      expect(client.prompt).toHaveBeenCalledWith("", [
        { type: "image", data: "aW1hZ2VkYXRh", mimeType: "image/jpeg" },
      ]);
    });

    it("routes photo+caption with caption as text and image", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          photo: photoSizes,
          caption: "Check this out",
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).toHaveBeenCalledWith("Check this out", [
        { type: "image", data: "aW1hZ2VkYXRh", mimeType: "image/jpeg" },
      ]);
    });

    it("download failure with caption falls back to text-only prompt", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      (api.downloadFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          photo: photoSizes,
          caption: "Fallback text",
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).toHaveBeenCalledWith("Fallback text", undefined);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Failed to download photo"),
      );
    });

    it("download failure without caption skips message", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      (api.downloadFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("timeout"));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          photo: photoSizes,
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("No caption/text after download failure"),
      );
    });

    it("getFile returns no file_path — falls back gracefully", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      (api.getFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        file_id: "large", file_unique_id: "l",
      });
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          photo: photoSizes,
          caption: "Has caption",
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).toHaveBeenCalledWith("Has caption", undefined);
    });

    it("text message still routes normally (regression guard)", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "plain text",
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).toHaveBeenCalledWith("plain text", undefined);
      expect(api.getFile).not.toHaveBeenCalled();
    });

    it("empty photo array treated as text-only", async () => {
      const client = createMockClient();
      setup([], new Map([[200, "s1"]]), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "has text",
          photo: [],
          message_thread_id: 200,
        },
      }]);
      expect(client.prompt).toHaveBeenCalledWith("has text", undefined);
      expect(api.getFile).not.toHaveBeenCalled();
    });
  });

  describe("General topic routing", () => {
    it("routes General topic messages to the general session's GSD process", async () => {
      const client = createMockClient();
      setup([], new Map(), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      bridge.setGeneralSession("s1");
      bridge.setOwnerId(99);
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hello from general",
        },
      }]);
      expect(client.prompt).toHaveBeenCalledWith("hello from general", undefined);
    });

    it("sends concierge-unavailable message when no general session exists", async () => {
      setup();
      bridge.setOwnerId(99);
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hi",
        },
      }]);
      expect(api.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("No active session"),
        expect.anything(),
      );
    });
  });

  describe("launch command parsing", () => {
    it("parses /launch <path>", () => {
      setup();
      expect(bridge.parseLaunchCommand("/launch ~/projects/foo")).toBe("~/projects/foo");
    });

    it("parses /launch with absolute path", () => {
      setup();
      expect(bridge.parseLaunchCommand("/launch C:\\Users\\me\\project")).toBe("C:\\Users\\me\\project");
    });

    it("parses 'launch gsd in <path>'", () => {
      setup();
      expect(bridge.parseLaunchCommand("launch gsd in ~/my-project")).toBe("~/my-project");
    });

    it("parses 'launch <path>'", () => {
      setup();
      expect(bridge.parseLaunchCommand("launch ~/foo")).toBe("~/foo");
    });

    it("parses 'open <path>'", () => {
      setup();
      expect(bridge.parseLaunchCommand("open ~/bar")).toBe("~/bar");
    });

    it("parses 'open project <path>'", () => {
      setup();
      expect(bridge.parseLaunchCommand("open project ~/baz")).toBe("~/baz");
    });

    it("returns null for non-launch messages", () => {
      setup();
      expect(bridge.parseLaunchCommand("hello world")).toBeNull();
      expect(bridge.parseLaunchCommand("how are you")).toBeNull();
    });

    it("handles launch commands from General topic", async () => {
      const launchHandler = vi.fn().mockResolvedValue(undefined);
      setup();
      bridge.setOnLaunchRequest(launchHandler);
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "/launch ~/projects/foo",
        },
      }]);
      expect(launchHandler).toHaveBeenCalledWith("~/projects/foo");
    });

    it("blocks all commands from non-owner when ownerId is set", async () => {
      const launchHandler = vi.fn().mockResolvedValue(undefined);
      setup();
      bridge.setOnLaunchRequest(launchHandler);
      bridge.setOwnerId(42);
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "Stranger" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "/launch ~/projects/foo",
        },
      }]);
      expect(launchHandler).not.toHaveBeenCalled();
    });

    it("allows launch commands from owner when ownerId is set", async () => {
      const launchHandler = vi.fn().mockResolvedValue(undefined);
      setup();
      bridge.setOnLaunchRequest(launchHandler);
      bridge.setOwnerId(42);
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 42, is_bot: false, first_name: "Owner" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "/launch ~/projects/foo",
        },
      }]);
      expect(launchHandler).toHaveBeenCalledWith("~/projects/foo");
    });

    it("blocks all commands when ownerId is not set", async () => {
      const launchHandler = vi.fn().mockResolvedValue(undefined);
      setup();
      bridge.setOnLaunchRequest(launchHandler);
      bridge.setOwnerId(null);
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 999, is_bot: false, first_name: "Anyone" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "/launch ~/projects/foo",
        },
      }]);
      expect(launchHandler).not.toHaveBeenCalled();
      expect(api.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("No owner ID configured"),
        expect.anything(),
      );
    });

    it("allows /whoami even when ownerId is not set", async () => {
      setup();
      bridge.setOwnerId(null);
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 999, is_bot: false, first_name: "Anyone", username: "anyone" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "/whoami",
        },
      }]);
      expect(api.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("999"),
        expect.objectContaining({ parse_mode: "Markdown" }),
      );
    });
  });

  describe("project finder", () => {
    beforeEach(() => {
      setup();
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([]);
    });

    function mockDirs(baseDir: string, subdirs: string[]) {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(
        subdirs.map((name) => ({
          name,
          isDirectory: () => true,
          isFile: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: baseDir,
          parentPath: baseDir,
        } as fs.Dirent)) as any,
      );
    }

    it("returns empty when no search dirs configured", () => {
      expect(bridge.findProjects("rokketdocs")).toEqual([]);
    });

    it("finds exact folder name match", () => {
      bridge.setProjectSearchDirs(["/projects"]);
      mockDirs("/projects", ["RokketDocs", "OtherProject"]);
      const results = bridge.findProjects("rokketdocs");
      expect(results).toHaveLength(1);
      expect(results[0]).toContain("RokketDocs");
    });

    it("finds partial match", () => {
      bridge.setProjectSearchDirs(["/projects"]);
      mockDirs("/projects", ["RokketDocs-Frontend", "Backend"]);
      const results = bridge.findProjects("rokketdocs");
      expect(results).toHaveLength(1);
      expect(results[0]).toContain("RokketDocs-Frontend");
    });

    it("strips stop words from query", () => {
      bridge.setProjectSearchDirs(["/projects"]);
      mockDirs("/projects", ["RokketDocs", "MyApp"]);
      const results = bridge.findProjects("hey launch my rokketdocs folder please");
      expect(results).toHaveLength(1);
      expect(results[0]).toContain("RokketDocs");
    });

    it("ranks exact match higher than partial", () => {
      bridge.setProjectSearchDirs(["/projects"]);
      mockDirs("/projects", ["RokketDocs-Old", "RokketDocs"]);
      const results = bridge.findProjects("rokketdocs");
      expect(results[0]).toContain("RokketDocs");
    });

    it("returns multiple matches sorted by score", () => {
      bridge.setProjectSearchDirs(["/projects"]);
      mockDirs("/projects", ["Alpha", "Beta", "AlphaBeta"]);
      const results = bridge.findProjects("alpha");
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("skips hidden directories", () => {
      bridge.setProjectSearchDirs(["/projects"]);
      mockDirs("/projects", [".hidden", "Visible"]);
      const results = bridge.findProjects("hidden");
      expect(results).toEqual([]);
    });

    it("returns empty when all words are stop words", () => {
      bridge.setProjectSearchDirs(["/projects"]);
      mockDirs("/projects", ["SomeProject"]);
      const results = bridge.findProjects("hey launch my project");
      expect(results).toEqual([]);
    });
  });

  describe("general chat project search", () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([]);
    });

    function mockProjectDirs(subdirs: string[]) {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(
        subdirs.map((name) => ({
          name,
          isDirectory: () => true,
          isFile: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: "/projects",
          parentPath: "/projects",
        } as fs.Dirent)) as any,
      );
    }

    it("auto-launches when single project match found", async () => {
      setup();
      const launchHandler = vi.fn().mockResolvedValue(undefined);
      bridge.setOnLaunchRequest(launchHandler);
      bridge.setProjectSearchDirs(["/projects"]);
      mockProjectDirs(["RokketDocs"]);

      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hey launch rokketdocs",
        },
      }]);

      expect(launchHandler).toHaveBeenCalled();
      expect(launchHandler.mock.calls[0][0]).toContain("RokketDocs");
    });

    it("shows list when multiple matches found", async () => {
      setup();
      bridge.setProjectSearchDirs(["/projects"]);
      mockProjectDirs(["RokketDocs", "RokketDocsV2"]);

      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "rokketdocs",
        },
      }]);

      expect(api.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("Found multiple matches"),
        expect.anything(),
      );
    });

    it("shows hint when no session and search dirs configured but no match", async () => {
      setup();
      bridge.setProjectSearchDirs(["/projects"]);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "something unrelated",
        },
      }]);

      expect(api.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("Try telling me which project to launch"),
        expect.anything(),
      );
    });

    it("shows no-dirs message when no search dirs and no session", async () => {
      setup();
      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "some message",
        },
      }]);

      expect(api.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("No active session and no project search directories"),
        expect.anything(),
      );
    });

    it("routes to session when project search finds nothing but session exists", async () => {
      const client = createMockClient();
      setup([], new Map(), new Map(), new Map([["s1", { client, isStreaming: false }]]));
      bridge.setGeneralSession("s1");
      bridge.setProjectSearchDirs(["/projects"]);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await bridge._testInjectUpdates([{
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 99, is_bot: false, first_name: "User" },
          chat: { id: CHAT_ID, type: "supergroup" },
          text: "hello from general",
        },
      }]);

      expect(client.prompt).toHaveBeenCalledWith("hello from general", undefined);
    });
  });
});
