import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelegramApi, redactToken } from "./api";

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

    it("passes offset when provided", async () => {
      globalThis.fetch = mockFetch({ ok: true, result: [] });

      await api.getUpdates(42);
      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ offset: 42 });
    });

    it("sends no body when offset is undefined", async () => {
      globalThis.fetch = mockFetch({ ok: true, result: [] });

      await api.getUpdates();
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body).toBeUndefined();
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

    it("includes retry_after hint", async () => {
      globalThis.fetch = mockFetch(
        { ok: false, description: "Too Many Requests", parameters: { retry_after: 30 } },
        429,
      );

      await expect(api.getMe()).rejects.toThrow("retry after 30s");
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
});
