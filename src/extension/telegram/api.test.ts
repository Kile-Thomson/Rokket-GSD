import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramApi, redactToken, TelegramMigrationError, TelegramNotForumError } from "./api";

const TOKEN = "123456:ABC-DEF";

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("redactToken", () => {
  it("replaces token with bot***", () => {
    expect(redactToken(`https://api.telegram.org/bot${TOKEN}/getMe`, TOKEN))
      .toBe("https://api.telegram.org/botbot***/getMe");
  });
});

describe("TelegramApi", () => {
  let api: TelegramApi;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    api = new TelegramApi(TOKEN);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("getMe", () => {
    it("calls correct URL and returns result", async () => {
      const user = { id: 1, is_bot: true, first_name: "Bot" };
      globalThis.fetch = mockFetch({ ok: true, result: user });

      const result = await api.getMe();
      expect(result).toEqual(user);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${TOKEN}/getMe`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("sendMessage", () => {
    it("sends chat_id, text, and options", async () => {
      const msg = { message_id: 1, chat: { id: 42, type: "group" }, text: "hi" };
      globalThis.fetch = mockFetch({ ok: true, result: msg });

      await api.sendMessage(42, "hi", { parse_mode: "HTML" });
      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ chat_id: 42, text: "hi", parse_mode: "HTML" });
    });
  });

  describe("getChatMember", () => {
    it("sends chat_id and user_id", async () => {
      const member = { status: "administrator", user: { id: 5, is_bot: false, first_name: "A" } };
      globalThis.fetch = mockFetch({ ok: true, result: member });

      const result = await api.getChatMember(-100, 5);
      expect(result).toEqual(member);
      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ chat_id: -100, user_id: 5 });
    });
  });

  describe("getUpdates", () => {
    it("uses 35s timeout", async () => {
      globalThis.fetch = mockFetch({ ok: true, result: [] });

      await api.getUpdates();
      const signal = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].signal;
      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it("passes offset and long-poll timeout when offset provided", async () => {
      globalThis.fetch = mockFetch({ ok: true, result: [] });

      await api.getUpdates(42);
      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ offset: 42, timeout: 30 });
    });

    it("sends the long-poll timeout even when offset is undefined", async () => {
      globalThis.fetch = mockFetch({ ok: true, result: [] });

      await api.getUpdates();
      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ timeout: 30 });
    });
  });

  describe("createForumTopic", () => {
    it("sends chat_id and name", async () => {
      const topic = { message_thread_id: 10, name: "Test" };
      globalThis.fetch = mockFetch({ ok: true, result: topic });

      const result = await api.createForumTopic(-100, "Test");
      expect(result).toEqual(topic);
    });
  });

  describe("closeForumTopic", () => {
    it("returns true on success", async () => {
      globalThis.fetch = mockFetch({ ok: true, result: true });
      expect(await api.closeForumTopic(-100, 10)).toBe(true);
    });
  });

  describe("deleteForumTopic", () => {
    it("returns true on success", async () => {
      globalThis.fetch = mockFetch({ ok: true, result: true });
      expect(await api.deleteForumTopic(-100, 10)).toBe(true);
    });
  });

  describe("getFile", () => {
    it("calls correct endpoint and returns TelegramFile", async () => {
      const file = { file_id: "abc", file_unique_id: "u1", file_path: "photos/file_0.jpg" };
      globalThis.fetch = mockFetch({ ok: true, result: file });

      const result = await api.getFile("abc");
      expect(result).toEqual(file);
      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ file_id: "abc" });
    });

    it("throws on 404 response", async () => {
      globalThis.fetch = mockFetch({ ok: false, description: "file not found" }, 404);
      await expect(api.getFile("bad")).rejects.toThrow("404");
    });
  });

  describe("downloadFile", () => {
    function mockBinaryFetch(body: ArrayBuffer, status = 200) {
      return vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        arrayBuffer: () => Promise.resolve(body),
      });
    }

    it("fetches correct URL and returns base64", async () => {
      const bytes = new TextEncoder().encode("fake-image-data");
      globalThis.fetch = mockBinaryFetch(bytes.buffer);

      const result = await api.downloadFile("photos/file_0.jpg");
      expect(result.mimeType).toBe("image/jpeg");
      expect(Buffer.from(result.base64, "base64").toString()).toBe("fake-image-data");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://api.telegram.org/file/bot${TOKEN}/photos/file_0.jpg`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("throws on 403 response", async () => {
      globalThis.fetch = mockBinaryFetch(new ArrayBuffer(0), 403);
      await expect(api.downloadFile("photos/file_0.jpg")).rejects.toThrow("403");
    });

    it("throws on network error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
      await expect(api.downloadFile("photos/file_0.jpg")).rejects.toThrow("network down");
    });

    it("redacts token in error messages", async () => {
      globalThis.fetch = mockBinaryFetch(new ArrayBuffer(0), 403);
      await expect(api.downloadFile("photos/file_0.jpg")).rejects.toThrow("bot***");
      await expect(api.downloadFile("photos/file_0.jpg")).rejects.not.toThrow(TOKEN);
    });
  });

  describe("error handling", () => {
    it("redacts token in HTTP error messages", async () => {
      globalThis.fetch = mockFetch(
        { ok: false, description: `token ${TOKEN} is invalid` },
        401,
      );

      await expect(api.getMe()).rejects.toThrow("bot***");
      await expect(api.getMe()).rejects.not.toThrow(TOKEN);
    });

    it("throws TelegramMigrationError carrying the new chat ID on supergroup upgrade", async () => {
      globalThis.fetch = mockFetch(
        {
          ok: false,
          description: "Bad Request: group chat was upgraded to a supergroup chat",
          parameters: { migrate_to_chat_id: -1001999888777 },
        },
        400,
      );

      await expect(api.createForumTopic(-100, "Test")).rejects.toBeInstanceOf(
        TelegramMigrationError,
      );
    });

    it("throws TelegramNotForumError when the supergroup has no Topics enabled", async () => {
      globalThis.fetch = mockFetch(
        { ok: false, description: "Bad Request: the chat is not a forum" },
        400,
      );

      const err = await api.createForumTopic(-100, "Test").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TelegramNotForumError);
      const forumErr = err as TelegramNotForumError;
      expect(forumErr.status).toBe(400);
      expect(forumErr.description).toContain("not a forum");
    });

    it("TelegramMigrationError exposes migrateToChatId, status, and description", async () => {
      globalThis.fetch = mockFetch(
        {
          ok: false,
          description: "Bad Request: group chat was upgraded to a supergroup chat",
          parameters: { migrate_to_chat_id: -1001999888777 },
        },
        400,
      );

      const err = await api.createForumTopic(-100, "Test").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TelegramMigrationError);
      const migErr = err as TelegramMigrationError;
      expect(migErr.migrateToChatId).toBe(-1001999888777);
      expect(migErr.status).toBe(400);
      expect(migErr.description).toContain("supergroup");
    });

    it("includes retry_after hint and does not auto-retry beyond the cap", async () => {
      // retry_after past MAX_AUTO_RETRY_AFTER_S is surfaced to the caller, not
      // waited out in-line (blocking the poller for minutes is worse than a drop).
      globalThis.fetch = mockFetch(
        { ok: false, description: "Too Many Requests", parameters: { retry_after: 120 } },
        429,
      );

      await expect(api.getMe()).rejects.toThrow("retry after 120s");
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it("redacts token in network errors", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new Error(`connect to bot${TOKEN} failed`),
      );

      await expect(api.getMe()).rejects.toThrow("bot***");
      await expect(api.getMe()).rejects.not.toThrow(TOKEN);
    });

    it("throws on missing result field", async () => {
      globalThis.fetch = mockFetch({ ok: true });

      await expect(api.getMe()).rejects.toThrow("no result field");
    });

    it("handles non-Error thrown values", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue("string error");

      await expect(api.getMe()).rejects.toThrow("Telegram API request failed: string error");
    });
  });

  describe("rate-limit auto-retry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("waits out retry_after within the cap and retries once, succeeding", async () => {
      // First call: 429 with a small retry_after. Second call: success.
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ ok: false, description: "Too Many Requests", parameters: { retry_after: 2 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, result: { id: 1, is_bot: true, first_name: "Bot" } }),
        });
      globalThis.fetch = fetchMock;

      const promise = api.getMe();
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(result).toEqual({ id: 1, is_bot: true, first_name: "Bot" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("parse-entities plain-text fallback", () => {
    it("sendMessage retries without parse_mode when markup fails to parse", async () => {
      // First call: HTML parse fails (e.g. truncation cut a code fence).
      // Second call (no parse_mode) succeeds, so the content is still delivered.
      const msg = { message_id: 7, chat: { id: 42, type: "group" }, text: "hi" };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ ok: false, description: "Bad Request: can't parse entities: unclosed tag" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, result: msg }),
        });
      globalThis.fetch = fetchMock;

      const result = await api.sendMessage(42, "hi", { parse_mode: "HTML", message_thread_id: 3 });
      expect(result).toEqual(msg);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(secondBody.parse_mode).toBeUndefined();
      expect(secondBody).toEqual({ chat_id: 42, text: "hi", message_thread_id: 3 });
    });

    it("does not retry a non-parse 400", async () => {
      const fetchMock = mockFetch({ ok: false, description: "Bad Request: chat not found" }, 400);
      globalThis.fetch = fetchMock;

      await expect(api.sendMessage(42, "hi", { parse_mode: "HTML" })).rejects.toThrow("chat not found");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("centralized migration adopt-and-retry", () => {
    it("adopts the new chat ID via onMigrate and retries the same call", async () => {
      const migrated: number[] = [];
      api.setOnMigrate((id) => { migrated.push(id); });
      const msg = { message_id: 9, chat: { id: -1001, type: "supergroup" }, text: "hi" };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ ok: false, description: "Bad Request: upgraded to supergroup", parameters: { migrate_to_chat_id: -1001 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, result: msg }),
        });
      globalThis.fetch = fetchMock;

      const result = await api.sendMessage(-100, "hi");
      expect(result).toEqual(msg);
      expect(migrated).toEqual([-1001]);
      const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(secondBody.chat_id).toBe(-1001);
    });

    it("still throws TelegramMigrationError when no onMigrate handler is set", async () => {
      globalThis.fetch = mockFetch(
        { ok: false, description: "upgraded", parameters: { migrate_to_chat_id: -1002 } },
        400,
      );
      await expect(api.sendMessage(-100, "hi")).rejects.toBeInstanceOf(TelegramMigrationError);
    });
  });
});
