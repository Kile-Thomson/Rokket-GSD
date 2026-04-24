import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramBridge } from "./bridge";
import type { TelegramApi, TelegramUpdate } from "./api";
import type { TopicManager, TopicManagerLogger } from "./topicManager";
import type { BridgeClient, BridgeSessionState } from "./bridge";

function createMockApi(updates: TelegramUpdate[] = []): TelegramApi {
  let callCount = 0;
  return {
    getUpdates: vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? updates : []);
    }),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 1, type: "supergroup" } }),
    editMessageText: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 1, type: "supergroup" } }),
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
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "hello",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).toHaveBeenCalledWith("hello", undefined);
    });

    it("routes slash command to session", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "/gsd status",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).toHaveBeenCalledWith("/gsd status", undefined);
    });

    it("aborts before prompting when session is streaming", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "hi",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: true }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      // Need to flush the 500ms delay after abort
      await vi.advanceTimersByTimeAsync(500);
      expect(client.abort).toHaveBeenCalled();
      expect(client.prompt).toHaveBeenCalledWith("hi", undefined);
    });

    it("skips bot messages", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: true, first_name: "Bot" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "bot msg",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).not.toHaveBeenCalled();
    });

    it("skips /telegram commands", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "/telegram setup",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).not.toHaveBeenCalled();
    });

    it("skips updates without message", async () => {
      setup([{ update_id: 1 }]);
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("without message"),
      );
    });

    it("skips messages without text or photo", async () => {
      setup([{
        update_id: 1,
        message: { message_id: 1, chat: { id: 1, type: "g" }, message_thread_id: 200 },
      }]);
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("without text or photo"),
      );
    });

    it("skips messages without thread_id", async () => {
      setup([{
        update_id: 1,
        message: { message_id: 1, chat: { id: 1, type: "g" }, text: "hi" },
      }]);
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("without thread_id"),
      );
    });

    it("skips when no session for topic", async () => {
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "hi",
            message_thread_id: 999,
          },
        }],
        new Map(),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("No session for topic"),
      );
    });

    it("skips when session has no client", async () => {
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "hi",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client: null, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("No client"),
      );
    });
  });

  describe("handleAssistantMessage", () => {
    it("sends message to correct topic", async () => {
      setup([], new Map(), new Map([["s1", 300]]));
      await bridge.handleAssistantMessage("s1", "response text");
      expect(api.sendMessage).toHaveBeenCalledWith(CHAT_ID, "response text", {
        message_thread_id: 300,
      });
    });

    it("does nothing when no topic for session", async () => {
      setup();
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
        CHAT_ID, 1, expect.stringContaining("abc"),
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
      expect(api.editMessageText).toHaveBeenCalledWith(CHAT_ID, 1, "final text");
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
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "hi",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("prompt error"),
      );
      // Prompt errors don't trigger backoff (only getUpdates errors do), next poll at BASE_DELAY
      await vi.advanceTimersByTimeAsync(2000);
      expect(api.getUpdates).toHaveBeenCalledTimes(2);
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
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            photo: photoSizes,
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.getFile).toHaveBeenCalledWith("large");
      expect(api.downloadFile).toHaveBeenCalledWith("photos/file_0.jpg");
      expect(client.prompt).toHaveBeenCalledWith("", [
        { type: "image", data: "aW1hZ2VkYXRh", mimeType: "image/jpeg" },
      ]);
    });

    it("routes photo+caption with caption as text and image", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            photo: photoSizes,
            caption: "Check this out",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).toHaveBeenCalledWith("Check this out", [
        { type: "image", data: "aW1hZ2VkYXRh", mimeType: "image/jpeg" },
      ]);
    });

    it("download failure with caption falls back to text-only prompt", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            photo: photoSizes,
            caption: "Fallback text",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      (api.downloadFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).toHaveBeenCalledWith("Fallback text", undefined);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Failed to download photo"),
      );
    });

    it("download failure without caption skips message", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            photo: photoSizes,
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      (api.downloadFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("timeout"));
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("No caption/text after download failure"),
      );
    });

    it("getFile returns no file_path — falls back gracefully", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            photo: photoSizes,
            caption: "Has caption",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      (api.getFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        file_id: "large", file_unique_id: "l",
      });
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).toHaveBeenCalledWith("Has caption", undefined);
    });

    it("text message still routes normally (regression guard)", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "plain text",
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).toHaveBeenCalledWith("plain text", undefined);
      expect(api.getFile).not.toHaveBeenCalled();
    });

    it("empty photo array treated as text-only", async () => {
      const client = createMockClient();
      setup(
        [{
          update_id: 1,
          message: {
            message_id: 1,
            from: { id: 99, is_bot: false, first_name: "User" },
            chat: { id: CHAT_ID, type: "supergroup" },
            text: "has text",
            photo: [],
            message_thread_id: 200,
          },
        }],
        new Map([[200, "s1"]]),
        new Map(),
        new Map([["s1", { client, isStreaming: false }]]),
      );
      bridge.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.prompt).toHaveBeenCalledWith("has text", undefined);
      expect(api.getFile).not.toHaveBeenCalled();
    });
  });
});
