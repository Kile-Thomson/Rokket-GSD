import { describe, it, expect, vi, beforeEach } from "vitest";
import { TopicManager } from "./topicManager";
import type { TelegramApi } from "./api";
import type { GlobalStateStore, TopicRegistryEntry } from "./topicManager";

function createMockApi(): TelegramApi {
  let nextThreadId = 100;
  return {
    createForumTopic: vi.fn().mockImplementation((_chatId: unknown, name: string) =>
      Promise.resolve({ message_thread_id: nextThreadId++, name }),
    ),
    closeForumTopic: vi.fn().mockResolvedValue(true),
    deleteForumTopic: vi.fn().mockResolvedValue(true),
  } as unknown as TelegramApi;
}

describe("TopicManager", () => {
  let api: ReturnType<typeof createMockApi>;
  let manager: TopicManager;
  const CHAT_ID = -1001234567890;
  const MACHINE_ID = "machine-abc";

  beforeEach(() => {
    api = createMockApi();
    manager = new TopicManager(api, CHAT_ID, MACHINE_ID);
  });

  describe("syncOn", () => {
    it("creates topic via API with correct name and chatId, stores bidirectional mapping", async () => {
      const threadId = await manager.syncOn("s1", "MyProject");
      expect(threadId).toBe(100);
      expect(api.createForumTopic).toHaveBeenCalledWith(CHAT_ID, "MyProject");
      expect(manager.getTopicForSession("s1")).toBe(100);
      expect(manager.getSessionForTopic(100)).toBe("s1");
    });

    it("returns existing threadId when called with same sessionId (idempotent)", async () => {
      const first = await manager.syncOn("s1", "MyProject");
      const second = await manager.syncOn("s1", "MyProject");
      expect(first).toBe(second);
      expect(api.createForumTopic).toHaveBeenCalledTimes(1);
    });

    it("produces numbered labels for multiple sessions per R012", async () => {
      await manager.syncOn("s1", "MyProject");
      await manager.syncOn("s2", "MyProject");
      await manager.syncOn("s3", "MyProject");
      expect(api.createForumTopic).toHaveBeenNthCalledWith(1, CHAT_ID, "MyProject");
      expect(api.createForumTopic).toHaveBeenNthCalledWith(2, CHAT_ID, "MyProject #2");
      expect(api.createForumTopic).toHaveBeenNthCalledWith(3, CHAT_ID, "MyProject #3");
    });

    it("truncates topic name at 128-char Telegram limit", async () => {
      const longLabel = "A".repeat(200);
      await manager.syncOn("s1", longLabel);
      const calledName = (api.createForumTopic as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(calledName.length).toBeLessThanOrEqual(128);
    });
  });

  describe("syncOff", () => {
    it("calls closeForumTopic then deleteForumTopic, removes from maps", async () => {
      await manager.syncOn("s1", "MyProject");
      await manager.syncOff("s1");
      expect(api.closeForumTopic).toHaveBeenCalledWith(CHAT_ID, 100);
      expect(api.deleteForumTopic).toHaveBeenCalledWith(CHAT_ID, 100);
      expect(manager.getTopicForSession("s1")).toBeUndefined();
      expect(manager.getSessionForTopic(100)).toBeUndefined();
    });

    it("is a no-op when session is not synced", async () => {
      await manager.syncOff("nonexistent");
      expect(api.closeForumTopic).not.toHaveBeenCalled();
      expect(api.deleteForumTopic).not.toHaveBeenCalled();
    });

    it("handles deleteForumTopic failure gracefully — still removes from maps", async () => {
      (api.deleteForumTopic as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("topic already deleted"),
      );
      await manager.syncOn("s1", "MyProject");
      await manager.syncOff("s1");
      expect(manager.getTopicForSession("s1")).toBeUndefined();
      expect(manager.getSessionForTopic(100)).toBeUndefined();
    });

    it("handles closeForumTopic failure gracefully — still continues to delete", async () => {
      (api.closeForumTopic as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("close failed"),
      );
      await manager.syncOn("s1", "MyProject");
      await manager.syncOff("s1");
      expect(api.deleteForumTopic).toHaveBeenCalledWith(CHAT_ID, 100);
      expect(manager.getTopicForSession("s1")).toBeUndefined();
    });
  });

  describe("lookups", () => {
    it("getTopicForSession returns undefined for unknown session", () => {
      expect(manager.getTopicForSession("unknown")).toBeUndefined();
    });

    it("getSessionForTopic returns undefined for unknown threadId", () => {
      expect(manager.getSessionForTopic(999)).toBeUndefined();
    });

    it("getTopicForSession and getSessionForTopic return correct mappings", async () => {
      await manager.syncOn("s1", "P1");
      await manager.syncOn("s2", "P2");
      expect(manager.getTopicForSession("s1")).toBe(100);
      expect(manager.getTopicForSession("s2")).toBe(101);
      expect(manager.getSessionForTopic(100)).toBe("s1");
      expect(manager.getSessionForTopic(101)).toBe("s2");
    });
  });

  describe("activeSessions", () => {
    it("returns all session IDs with active topics", async () => {
      await manager.syncOn("s1", "P1");
      await manager.syncOn("s2", "P2");
      expect(manager.activeSessions).toEqual(expect.arrayContaining(["s1", "s2"]));
      expect(manager.activeSessions).toHaveLength(2);
    });
  });

  describe("machineId", () => {
    it("exposes machine ID for downstream stale detection", () => {
      expect(manager.machineId).toBe(MACHINE_ID);
    });
  });

  describe("disposeAll", () => {
    it("cleans up all active sessions", async () => {
      await manager.syncOn("s1", "P1");
      await manager.syncOn("s2", "P2");
      await manager.disposeAll();
      expect(manager.activeSessions).toHaveLength(0);
      expect(api.deleteForumTopic).toHaveBeenCalledTimes(2);
    });
  });

  describe("globalState registry", () => {
    let gs: GlobalStateStore;

    function createGlobalState(): GlobalStateStore {
      const store: Record<string, unknown> = {};
      return {
        get<T>(key: string): T | undefined { return store[key] as T | undefined; },
        update(key: string, value: unknown) { store[key] = value; return Promise.resolve(); },
      };
    }

    beforeEach(() => {
      gs = createGlobalState();
    });

    it("persists registry entry on syncOn", async () => {
      const m = new TopicManager(api, CHAT_ID, MACHINE_ID, undefined, gs);
      await m.syncOn("s1", "P1");
      const entries = gs.get<TopicRegistryEntry[]>("gsd.telegram.topicRegistry")!;
      expect(entries).toHaveLength(1);
      expect(entries[0].threadId).toBe(100);
      expect(entries[0].sessionId).toBe("s1");
      expect(entries[0].machineId).toBe(MACHINE_ID);
    });

    it("removes registry entry on syncOff", async () => {
      const m = new TopicManager(api, CHAT_ID, MACHINE_ID, undefined, gs);
      await m.syncOn("s1", "P1");
      await m.syncOff("s1");
      const entries = gs.get<TopicRegistryEntry[]>("gsd.telegram.topicRegistry")!;
      expect(entries).toHaveLength(0);
    });

    it("cleanupStaleTopics finds and deletes orphans from same machine", async () => {
      // Seed registry with a stale entry
      await gs.update("gsd.telegram.topicRegistry", [
        { threadId: 999, sessionId: "old-session", machineId: MACHINE_ID, createdAt: "2025-01-01T00:00:00Z" },
      ]);
      const m = new TopicManager(api, CHAT_ID, MACHINE_ID, undefined, gs);
      const cleaned = await m.cleanupStaleTopics();
      expect(cleaned).toBe(1);
      expect(api.closeForumTopic).toHaveBeenCalledWith(CHAT_ID, 999);
      expect(api.deleteForumTopic).toHaveBeenCalledWith(CHAT_ID, 999);
      const entries = gs.get<TopicRegistryEntry[]>("gsd.telegram.topicRegistry")!;
      expect(entries).toHaveLength(0);
    });

    it("cleanupStaleTopics skips entries from different machineId", async () => {
      await gs.update("gsd.telegram.topicRegistry", [
        { threadId: 999, sessionId: "other-session", machineId: "other-machine", createdAt: "2025-01-01T00:00:00Z" },
      ]);
      const m = new TopicManager(api, CHAT_ID, MACHINE_ID, undefined, gs);
      const cleaned = await m.cleanupStaleTopics();
      expect(cleaned).toBe(0);
      expect(api.deleteForumTopic).not.toHaveBeenCalled();
      const entries = gs.get<TopicRegistryEntry[]>("gsd.telegram.topicRegistry")!;
      expect(entries).toHaveLength(1);
    });

    it("cleanupStaleTopics with empty registry is a no-op", async () => {
      const m = new TopicManager(api, CHAT_ID, MACHINE_ID, undefined, gs);
      const cleaned = await m.cleanupStaleTopics();
      expect(cleaned).toBe(0);
    });

    it("cleanupStaleTopics still removes entry from registry when delete API throws", async () => {
      (api.deleteForumTopic as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("gone"));
      await gs.update("gsd.telegram.topicRegistry", [
        { threadId: 888, sessionId: "dead", machineId: MACHINE_ID, createdAt: "2025-01-01T00:00:00Z" },
        { threadId: 777, sessionId: "also-dead", machineId: MACHINE_ID, createdAt: "2025-01-01T00:00:00Z" },
      ]);
      const m = new TopicManager(api, CHAT_ID, MACHINE_ID, undefined, gs);
      const cleaned = await m.cleanupStaleTopics();
      expect(cleaned).toBe(2);
      const entries = gs.get<TopicRegistryEntry[]>("gsd.telegram.topicRegistry")!;
      expect(entries).toHaveLength(0);
    });

    it("no globalState writes when globalState is omitted", async () => {
      const m = new TopicManager(api, CHAT_ID, MACHINE_ID);
      await m.syncOn("s1", "P1");
      await m.syncOff("s1");
      // No error thrown — backward compatible
      expect(gs.get("gsd.telegram.topicRegistry")).toBeUndefined();
    });
  });

  describe("syncing guard", () => {
    it("double syncOn while syncing returns without creating duplicate topic", async () => {
      let resolveCreate!: (v: unknown) => void;
      (api.createForumTopic as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => new Promise((r) => { resolveCreate = r; }),
      );

      const first = manager.syncOn("s1", "MyProject");
      const second = manager.syncOn("s1", "MyProject");

      resolveCreate({ message_thread_id: 200, name: "MyProject" });

      const [r1, r2] = await Promise.all([first, second]);
      expect(r1).toBe(200);
      // second call returns -1 (syncing guard) or existing id
      expect(typeof r2).toBe("number");
      expect(api.createForumTopic).toHaveBeenCalledTimes(1);
    });
  });
});
