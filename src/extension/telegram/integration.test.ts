import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramApi } from "./api";
import type { TelegramUpdate, TelegramMessage, ForumTopic, TelegramFile } from "./api";
import { TopicManager } from "./topicManager";
import type { GlobalStateStore, TopicRegistryEntry } from "./topicManager";
import { TelegramBridge } from "./bridge";
import type { BridgeClient, BridgeSessionState } from "./bridge";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
const BOT_TOKEN = "123:TEST_TOKEN";
const CHAT_ID = -100999;
const MACHINE_ID = "test-machine-001";
const SESSION_ID = "session-abc";
const THREAD_ID = 42;

// ---------------------------------------------------------------------------
// Mock fetch that intercepts Telegram API calls
// ---------------------------------------------------------------------------
type FetchFn = typeof globalThis.fetch;

function buildMockFetch(): {
  fetch: FetchFn;
  apiCalls: Array<{ method: string; body: Record<string, unknown> | null }>;
  updateQueue: TelegramUpdate[][];
} {
  const apiCalls: Array<{ method: string; body: Record<string, unknown> | null }> = [];
  const updateQueue: TelegramUpdate[][] = [];

  const handlers: Record<string, (body: Record<string, unknown> | null) => unknown> = {
    getMe: () => ({ id: 111, is_bot: true, first_name: "TestBot", username: "testbot" }),

    createForumTopic: (_b) => ({
      message_thread_id: THREAD_ID,
      name: _b?.name ?? "topic",
    } satisfies ForumTopic),

    getUpdates: () => updateQueue.shift() ?? [],

    sendMessage: (b) => ({
      message_id: 900 + apiCalls.length,
      chat: { id: CHAT_ID, type: "supergroup" },
      text: b?.text,
      message_thread_id: b?.message_thread_id,
    } satisfies TelegramMessage),

    editMessageText: (b) => ({
      message_id: b?.message_id as number,
      chat: { id: CHAT_ID, type: "supergroup" },
      text: b?.text,
    }),

    closeForumTopic: () => true,
    deleteForumTopic: () => true,

    getFile: (b) => ({
      file_id: b?.file_id as string,
      file_unique_id: "u1",
      file_path: "photos/file_0.jpg",
    } satisfies TelegramFile),
  };

  const mockFetch: FetchFn = async (input, _init?) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    // File download endpoint
    if (url.includes("/file/bot")) {
      return new Response(Buffer.from("fake-image-bytes"), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    }

    // API method endpoint
    const methodMatch = url.match(/\/bot[^/]+\/(\w+)$/);
    if (!methodMatch) {
      return new Response(JSON.stringify({ ok: false, description: "unknown" }), { status: 404 });
    }

    const method = methodMatch[1];
    const body = _init?.body ? JSON.parse(_init.body as string) : null;
    apiCalls.push({ method, body });

    const handler = handlers[method];
    if (!handler) {
      return new Response(JSON.stringify({ ok: false, description: `unknown method ${method}` }), { status: 400 });
    }

    return new Response(JSON.stringify({ ok: true, result: handler(body) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetch: mockFetch, apiCalls, updateQueue };
}

// ---------------------------------------------------------------------------
// Mock GlobalStateStore (in-memory)
// ---------------------------------------------------------------------------
function createGlobalState(): GlobalStateStore {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    // expose for test assertions
    _store: store,
  } as GlobalStateStore & { _store: Map<string, unknown> };
}

// ---------------------------------------------------------------------------
// Mock BridgeClient
// ---------------------------------------------------------------------------
function createMockClient(): BridgeClient {
  return {
    abort: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------
describe("Telegram Integration (composed system)", () => {
  let mockFetchState: ReturnType<typeof buildMockFetch>;
  let globalState: ReturnType<typeof createGlobalState>;
  let api: TelegramApi;
  let topicManager: TopicManager;
  let bridge: TelegramBridge;
  let client: BridgeClient;
  let sessions: Map<string, BridgeSessionState>;
  let originalFetch: FetchFn;

  beforeEach(() => {
    vi.useFakeTimers();

    mockFetchState = buildMockFetch();
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchState.fetch;

    globalState = createGlobalState();
    api = new TelegramApi(BOT_TOKEN);
    topicManager = new TopicManager(api, CHAT_ID, MACHINE_ID, { info: vi.fn(), warn: vi.fn() }, globalState);

    client = createMockClient();
    sessions = new Map<string, BridgeSessionState>();
    sessions.set(SESSION_ID, { client, isStreaming: false });

    bridge = new TelegramBridge(
      api,
      topicManager,
      (sid) => sessions.get(sid),
      { info: vi.fn(), warn: vi.fn() },
      BOT_TOKEN,
      CHAT_ID,
    );
  });

  afterEach(() => {
    bridge.stopPolling();
    bridge.clearStreamingState();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 1. Sync-on flow
  // -----------------------------------------------------------------------
  it("syncOn creates topic and persists registry entry", async () => {
    const threadId = await topicManager.syncOn(SESSION_ID, "GSD Session");

    expect(threadId).toBe(THREAD_ID);
    expect(mockFetchState.apiCalls.some((c) => c.method === "createForumTopic")).toBe(true);

    const registry = globalState.get<TopicRegistryEntry[]>("gsd.telegram.topicRegistry");
    expect(registry).toBeDefined();
    expect(registry!.length).toBe(1);
    expect(registry![0].threadId).toBe(THREAD_ID);
    expect(registry![0].sessionId).toBe(SESSION_ID);
  });

  // -----------------------------------------------------------------------
  // 2. Inbound text routing
  // -----------------------------------------------------------------------
  it("inbound text message routes to BridgeClient.prompt", async () => {
    await topicManager.syncOn(SESSION_ID, "GSD Session");

    await bridge._testInjectUpdates([{
      update_id: 1,
      message: {
        message_id: 100,
        from: { id: 555, is_bot: false, first_name: "User" },
        chat: { id: CHAT_ID, type: "supergroup" },
        text: "hello from telegram",
        message_thread_id: THREAD_ID,
      },
    }]);

    expect(client.prompt).toHaveBeenCalledWith("hello from telegram", undefined);
  });

  // -----------------------------------------------------------------------
  // 3. Inbound slash command routing
  // -----------------------------------------------------------------------
  it("inbound /gsd command routes to BridgeClient.prompt", async () => {
    await topicManager.syncOn(SESSION_ID, "GSD Session");

    await bridge._testInjectUpdates([{
      update_id: 2,
      message: {
        message_id: 101,
        from: { id: 555, is_bot: false, first_name: "User" },
        chat: { id: CHAT_ID, type: "supergroup" },
        text: "/gsd status",
        message_thread_id: THREAD_ID,
      },
    }]);

    expect(client.prompt).toHaveBeenCalledWith("/gsd status", undefined);
  });

  // -----------------------------------------------------------------------
  // 4. Outbound assistant response
  // -----------------------------------------------------------------------
  it("handleAssistantMessage sends to correct thread", async () => {
    await topicManager.syncOn(SESSION_ID, "GSD Session");
    bridge.setStreamingGranularity("off");
    await bridge.handleAssistantMessage(SESSION_ID, "Here is my response.");

    const sendCalls = mockFetchState.apiCalls.filter((c) => c.method === "sendMessage");
    const last = sendCalls[sendCalls.length - 1];
    expect(last.body!.text).toBe("Here is my response.");
    expect(last.body!.message_thread_id).toBe(THREAD_ID);
  });

  // -----------------------------------------------------------------------
  // 5. Streaming flow: placeholder → throttled edit → final flush
  // -----------------------------------------------------------------------
  it("streaming: placeholder → throttled edit → final edit", async () => {
    await topicManager.syncOn(SESSION_ID, "GSD Session");
    bridge.setStreamingGranularity("throttled");

    // First chunk triggers placeholder sendMessage
    bridge.handleStreamingChunk(SESSION_ID, "Hello ");
    // Let the sendMessage promise resolve
    await vi.advanceTimersByTimeAsync(50);

    const placeholderSend = mockFetchState.apiCalls.filter((c) => c.method === "sendMessage");
    expect(placeholderSend.length).toBeGreaterThanOrEqual(1);

    // More chunks
    bridge.handleStreamingChunk(SESSION_ID, "world ");
    bridge.handleStreamingChunk(SESSION_ID, "from streaming");

    // Advance past EDIT_THROTTLE_MS (2000ms) to trigger throttled edit
    await vi.advanceTimersByTimeAsync(2100);

    const edits = mockFetchState.apiCalls.filter((c) => c.method === "editMessageText");
    expect(edits.length).toBeGreaterThanOrEqual(1);

    // Final flush
    bridge.handleStreamEnd(SESSION_ID, "Hello world from streaming — final");
    await vi.advanceTimersByTimeAsync(100);

    const finalEdits = mockFetchState.apiCalls.filter((c) => c.method === "editMessageText");
    const lastEdit = finalEdits[finalEdits.length - 1];
    expect(lastEdit.body!.text).toContain("final");
  });

  // -----------------------------------------------------------------------
  // 6. Photo injection
  // -----------------------------------------------------------------------
  it("inbound photo downloads and injects as image", async () => {
    await topicManager.syncOn(SESSION_ID, "GSD Session");

    await bridge._testInjectUpdates([{
      update_id: 3,
      message: {
        message_id: 102,
        from: { id: 555, is_bot: false, first_name: "User" },
        chat: { id: CHAT_ID, type: "supergroup" },
        message_thread_id: THREAD_ID,
        photo: [
          { file_id: "small", file_unique_id: "us", width: 100, height: 100 },
          { file_id: "large", file_unique_id: "ul", width: 800, height: 600 },
        ],
        caption: "check this image",
      },
    }]);

    expect(mockFetchState.apiCalls.some((c) => c.method === "getFile")).toBe(true);
    // The largest photo should be used
    const getFileCall = mockFetchState.apiCalls.find((c) => c.method === "getFile");
    expect(getFileCall!.body!.file_id).toBe("large");

    expect(client.prompt).toHaveBeenCalledWith(
      "check this image",
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/jpeg" }),
      ]),
    );
  });

  // -----------------------------------------------------------------------
  // 7. Sync-off flow
  // -----------------------------------------------------------------------
  it("syncOff closes and deletes topic, removes registry entry", async () => {
    await topicManager.syncOn(SESSION_ID, "GSD Session");

    // Verify registry has entry
    let registry = globalState.get<TopicRegistryEntry[]>("gsd.telegram.topicRegistry");
    expect(registry!.length).toBe(1);

    await topicManager.syncOff(SESSION_ID);

    expect(mockFetchState.apiCalls.some((c) => c.method === "closeForumTopic")).toBe(true);
    expect(mockFetchState.apiCalls.some((c) => c.method === "deleteForumTopic")).toBe(true);

    registry = globalState.get<TopicRegistryEntry[]>("gsd.telegram.topicRegistry");
    expect(registry!.length).toBe(0);

    // Topic mapping is gone
    expect(topicManager.getTopicForSession(SESSION_ID)).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 8. Stale topic cleanup
  // -----------------------------------------------------------------------
  it("cleanupStaleTopics finds and removes orphan entries", async () => {
    // Pre-populate registry with an orphan (not in sessionToTopic map)
    const orphan: TopicRegistryEntry = {
      threadId: 999,
      sessionId: "dead-session",
      machineId: MACHINE_ID,
      createdAt: "2025-01-01T00:00:00Z",
    };
    await globalState.update("gsd.telegram.topicRegistry", [orphan]);

    const cleaned = await topicManager.cleanupStaleTopics();
    expect(cleaned).toBe(1);

    const closeCalls = mockFetchState.apiCalls.filter((c) => c.method === "closeForumTopic");
    const deleteCalls = mockFetchState.apiCalls.filter((c) => c.method === "deleteForumTopic");
    expect(closeCalls.some((c) => c.body!.message_thread_id === 999)).toBe(true);
    expect(deleteCalls.some((c) => c.body!.message_thread_id === 999)).toBe(true);

    const registry = globalState.get<TopicRegistryEntry[]>("gsd.telegram.topicRegistry");
    expect(registry!.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 9. R001 — no PI dependency
  // -----------------------------------------------------------------------
  it("telegram source files have zero PI/relay/IPC imports (R001)", () => {
    const telegramDir = path.resolve(__dirname);
    const files = fs.readdirSync(telegramDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const piPatterns = /\b(relay|pipe|PI|IPC)\b/i;
    const importPattern = /^import\s/m;
    // Exclude imports from within the telegram directory itself (e.g. poller-ipc.ts is internal, not a PI dependency)
    const internalImportPattern = /from\s+["']\.\/[^"']+["']/;

    const violations: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(telegramDir, file), "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (importPattern.test(line) && piPatterns.test(line) && !internalImportPattern.test(line)) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
