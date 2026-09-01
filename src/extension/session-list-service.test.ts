import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getSessionDir, buildSessionInfo, listSessions, deleteSession, validateSessionPath } from "./session-list-service";

describe("session-list-service", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-session-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getSessionDir", () => {
    it("returns correct .gsd/agent/sessions path with encoded cwd", () => {
      const result = getSessionDir("/home/user/my-project");
      expect(result).toContain(".gsd");
      expect(result).toContain("sessions");
      // Path should be encoded: leading slash removed, slashes replaced with dashes
      expect(result).toContain("--home-user-my-project--");
    });

    it("handles Windows-style paths", () => {
      const result = getSessionDir("C:\\Users\\test\\project");
      expect(result).toContain("sessions");
      // Colons and backslashes should be replaced with dashes
      expect(result).toContain("--C--Users-test-project--");
    });
  });

  describe("buildSessionInfo", () => {
    it("parses a valid JSONL session file", async () => {
      const sessionFile = path.join(tmpDir, "test-session.jsonl");
      const lines = [
        JSON.stringify({
          type: "session",
          id: "abc-123",
          timestamp: "2026-03-17T00:00:00Z",
          cwd: "/home/user/project",
        }),
        JSON.stringify({
          type: "message",
          id: "msg-1",
          parentId: null,
          timestamp: "2026-03-17T00:01:00Z",
          message: { role: "user", content: "Hello, build a test suite" },
        }),
        JSON.stringify({
          type: "message",
          id: "msg-2",
          parentId: "msg-1",
          timestamp: "2026-03-17T00:02:00Z",
          message: { role: "assistant", content: "Sure, I'll create tests." },
        }),
      ];
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const result = await buildSessionInfo(sessionFile);

      expect(result).not.toBeNull();
      expect(result!.id).toBe("abc-123");
      expect(result!.cwd).toBe("/home/user/project");
      expect(result!.firstMessage).toBe("Hello, build a test suite");
      expect(result!.messageCount).toBe(2);
      expect(result!.created).toEqual(new Date("2026-03-17T00:00:00Z"));
    });

    it("handles content as array of blocks", async () => {
      const sessionFile = path.join(tmpDir, "blocks-session.jsonl");
      const lines = [
        JSON.stringify({
          type: "session",
          id: "block-123",
          timestamp: "2026-03-17T00:00:00Z",
          cwd: "/test",
        }),
        JSON.stringify({
          type: "message",
          id: "msg-1",
          parentId: null,
          timestamp: "2026-03-17T00:01:00Z",
          message: {
            role: "user",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "world" },
            ],
          },
        }),
      ];
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const result = await buildSessionInfo(sessionFile);
      expect(result!.firstMessage).toBe("Hello  world");
    });

    it("returns null for empty file", async () => {
      const sessionFile = path.join(tmpDir, "empty.jsonl");
      fs.writeFileSync(sessionFile, "");

      const result = await buildSessionInfo(sessionFile);
      expect(result).toBeNull();
    });

    it("returns null for malformed JSONL (no valid session header)", async () => {
      const sessionFile = path.join(tmpDir, "bad.jsonl");
      fs.writeFileSync(sessionFile, "this is not json\nalso not json\n");

      const result = await buildSessionInfo(sessionFile);
      expect(result).toBeNull();
    });

    it("returns null for non-existent file", async () => {
      const result = await buildSessionInfo(path.join(tmpDir, "does-not-exist.jsonl"));
      expect(result).toBeNull();
    });

    it("skips valid-JSON-but-non-object lines without aborting the session", async () => {
      const sessionFile = path.join(tmpDir, "null-line.jsonl");
      const lines = [
        JSON.stringify({
          type: "session",
          id: "null-line-123",
          timestamp: "2026-03-17T00:00:00Z",
          cwd: "/test",
        }),
        "null", // valid JSON, non-object — must be skipped, not throw
        "42",
        JSON.stringify("a bare string"),
        JSON.stringify({
          type: "message",
          id: "msg-1",
          parentId: null,
          timestamp: "2026-03-17T00:01:00Z",
          message: { role: "user", content: "Survived the null line" },
        }),
      ];
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const result = await buildSessionInfo(sessionFile);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("null-line-123");
      expect(result!.firstMessage).toBe("Survived the null line");
      expect(result!.messageCount).toBe(1);
    });

    it("extracts session name from session_info entries", async () => {
      const sessionFile = path.join(tmpDir, "named-session.jsonl");
      const lines = [
        JSON.stringify({
          type: "session",
          id: "named-123",
          timestamp: "2026-03-17T00:00:00Z",
          cwd: "/test",
        }),
        JSON.stringify({
          type: "session_info",
          id: "info-1",
          parentId: null,
          timestamp: "2026-03-17T00:01:00Z",
          name: "My Custom Session",
        }),
        JSON.stringify({
          type: "message",
          id: "msg-1",
          parentId: null,
          timestamp: "2026-03-17T00:02:00Z",
          message: { role: "user", content: "Hello" },
        }),
      ];
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const result = await buildSessionInfo(sessionFile);
      expect(result!.name).toBe("My Custom Session");
    });

    it("shows '(no messages)' when no user messages exist", async () => {
      const sessionFile = path.join(tmpDir, "no-msg.jsonl");
      const lines = [
        JSON.stringify({
          type: "session",
          id: "empty-msg-123",
          timestamp: "2026-03-17T00:00:00Z",
          cwd: "/test",
        }),
        JSON.stringify({
          type: "message",
          id: "msg-1",
          parentId: null,
          timestamp: "2026-03-17T00:01:00Z",
          message: { role: "system", content: "System message" },
        }),
      ];
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const result = await buildSessionInfo(sessionFile);
      expect(result!.firstMessage).toBe("(no messages)");
    });

    it("uses the latest session_info name, not the first", async () => {
      const sessionFile = path.join(tmpDir, "rename-session.jsonl");
      const lines = [
        JSON.stringify({ type: "session", id: "rename-1", timestamp: "2026-03-17T00:00:00Z", cwd: "/test" }),
        JSON.stringify({ type: "session_info", id: "info-1", parentId: null, timestamp: "2026-03-17T00:01:00Z", name: "First Name" }),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-03-17T00:02:00Z", message: { role: "user", content: "Hi" } }),
        JSON.stringify({ type: "session_info", id: "info-2", parentId: null, timestamp: "2026-03-17T00:03:00Z", name: "Latest Name" }),
      ];
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const result = await buildSessionInfo(sessionFile);
      expect(result!.name).toBe("Latest Name");
    });

    it("derives modified from the max message timestamp, tracked to the last line", async () => {
      const sessionFile = path.join(tmpDir, "activity-session.jsonl");
      const lines = [
        JSON.stringify({ type: "session", id: "activity-1", timestamp: "2026-03-17T00:00:00Z", cwd: "/test" }),
        // message-level epoch-ms timestamp wins over entry-level ISO
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-03-17T00:01:00Z", message: { role: "user", content: "First", timestamp: Date.parse("2026-03-17T00:05:00Z") } }),
        JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-03-17T00:02:00Z", message: { role: "assistant", content: "Reply" } }),
      ];
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const result = await buildSessionInfo(sessionFile);
      // Max of message-level 00:05 and entry-level 00:02 → 00:05
      expect(result!.modified).toEqual(new Date("2026-03-17T00:05:00Z"));
    });

    it("handles CRLF line endings", async () => {
      const sessionFile = path.join(tmpDir, "crlf-session.jsonl");
      const lines = [
        JSON.stringify({ type: "session", id: "crlf-1", timestamp: "2026-03-17T00:00:00Z", cwd: "/test" }),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-03-17T00:01:00Z", message: { role: "user", content: "CRLF works" } }),
      ];
      fs.writeFileSync(sessionFile, lines.join("\r\n"));

      const result = await buildSessionInfo(sessionFile);
      expect(result!.id).toBe("crlf-1");
      expect(result!.firstMessage).toBe("CRLF works");
      expect(result!.messageCount).toBe(1);
    });

    it("streams a large file: firstMessage from the head, count/name/modified to the tail", async () => {
      const sessionFile = path.join(tmpDir, "large-session.jsonl");
      const lines: string[] = [
        JSON.stringify({ type: "session", id: "large-1", timestamp: "2026-03-17T00:00:00Z", cwd: "/test" }),
        JSON.stringify({ type: "message", id: "u0", parentId: null, timestamp: "2026-03-17T00:00:01Z", message: { role: "user", content: "the very first message" } }),
      ];
      // 5000 assistant messages with increasing timestamps; last one is the max
      const total = 5000;
      for (let i = 0; i < total; i++) {
        const ts = Date.parse("2026-03-17T00:00:00Z") + (i + 2) * 1000;
        lines.push(
          JSON.stringify({ type: "message", id: `a${i}`, parentId: "u0", timestamp: "2026-03-17T00:00:00Z", message: { role: "assistant", content: `body ${i}`, timestamp: ts } })
        );
      }
      // Latest name appears near the end
      lines.push(JSON.stringify({ type: "session_info", id: "info-last", parentId: null, timestamp: "2026-03-17T00:00:00Z", name: "Final Name" }));
      fs.writeFileSync(sessionFile, lines.join("\n"));

      const result = await buildSessionInfo(sessionFile);
      expect(result!.firstMessage).toBe("the very first message");
      expect(result!.messageCount).toBe(total + 1); // 1 user + 5000 assistant
      expect(result!.name).toBe("Final Name");
      // modified is the max message timestamp (the last assistant message)
      const expectedMax = Date.parse("2026-03-17T00:00:00Z") + (total - 1 + 2) * 1000;
      expect(result!.modified).toEqual(new Date(expectedMax));
    });
  });

  describe("listSessions", () => {
    it("returns empty array when session dir does not exist", async () => {
      const result = await listSessions("/nonexistent/path/that/wont/match");
      expect(result).toEqual([]);
    });

    it("returns sessions sorted by most recently modified first", async () => {
      // Create a fake session directory structure
      const sessionDir = path.join(tmpDir, "sessions");
      fs.mkdirSync(sessionDir, { recursive: true });

      // We'll mock getSessionDir to return our tmpDir
      // Instead, let's just test buildSessionInfo + sort directly
      const file1 = path.join(sessionDir, "old.jsonl");
      const file2 = path.join(sessionDir, "new.jsonl");

      fs.writeFileSync(
        file1,
        [
          JSON.stringify({ type: "session", id: "old-1", timestamp: "2026-01-01T00:00:00Z", cwd: "/test" }),
          JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-01-01T00:01:00Z", message: { role: "user", content: "Old message" } }),
        ].join("\n")
      );

      fs.writeFileSync(
        file2,
        [
          JSON.stringify({ type: "session", id: "new-1", timestamp: "2026-03-17T00:00:00Z", cwd: "/test" }),
          JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-03-17T00:01:00Z", message: { role: "user", content: "New message" } }),
        ].join("\n")
      );

      // Build info for both and verify sorting
      const info1 = await buildSessionInfo(file1);
      const info2 = await buildSessionInfo(file2);
      const sessions = [info1!, info2!].sort((a, b) => b.modified.getTime() - a.modified.getTime());

      expect(sessions[0].id).toBe("new-1");
      expect(sessions[1].id).toBe("old-1");
    });

    it("reads more files than the concurrency limit and returns all, sorted", async () => {
      // Use the real session dir path so listSessions' getSessionDir resolves to it.
      const cwd = path.join(tmpDir, "concurrency-cwd");
      const sessionDir = getSessionDir(cwd);
      fs.mkdirSync(sessionDir, { recursive: true });

      // 20 files > the internal concurrency cap of 8.
      const count = 20;
      for (let i = 0; i < count; i++) {
        const ts = new Date(Date.parse("2026-01-01T00:00:00Z") + i * 60_000).toISOString();
        fs.writeFileSync(
          path.join(sessionDir, `s${i}.jsonl`),
          [
            JSON.stringify({ type: "session", id: `sess-${i}`, timestamp: ts, cwd }),
            JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: ts, message: { role: "user", content: `msg ${i}` } }),
          ].join("\n")
        );
      }

      try {
        const sessions = await listSessions(cwd);
        expect(sessions).toHaveLength(count);
        // Most recently modified first → highest index is newest.
        expect(sessions[0].id).toBe(`sess-${count - 1}`);
        expect(sessions[count - 1].id).toBe("sess-0");
        // No duplicates or dropped entries.
        expect(new Set(sessions.map((s) => s.id)).size).toBe(count);
      } finally {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    });
  });

  describe("deleteSession", () => {
    it("deletes a valid session file", async () => {
      // Create a file in a path that looks like a sessions directory
      const homeDir = os.homedir();
      const sessionsRoot = path.join(homeDir, ".gsd", "agent", "sessions");
      const testDir = path.join(sessionsRoot, "--test-delete--");
      fs.mkdirSync(testDir, { recursive: true });
      const testFile = path.join(testDir, "test-session.jsonl");
      fs.writeFileSync(testFile, "{}");

      await deleteSession(testFile);

      expect(fs.existsSync(testFile)).toBe(false);

      // Cleanup
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("throws for files outside sessions directory", async () => {
      const outsideFile = path.join(tmpDir, "not-in-sessions.jsonl");
      fs.writeFileSync(outsideFile, "{}");

      await expect(deleteSession(outsideFile)).rejects.toThrow("GSD-ERR-001");
    });

    it("throws for non-.jsonl files", async () => {
      const homeDir = os.homedir();
      const sessionsRoot = path.join(homeDir, ".gsd", "agent", "sessions");
      const testDir = path.join(sessionsRoot, "--test-ext--");
      fs.mkdirSync(testDir, { recursive: true });
      const testFile = path.join(testDir, "not-a-session.txt");
      fs.writeFileSync(testFile, "{}");

      await expect(deleteSession(testFile)).rejects.toThrow("GSD-ERR-002");

      // Cleanup
      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe("validateSessionPath", () => {
    it("throws for paths outside sessions directory", () => {
      expect(() => validateSessionPath("/etc/passwd")).toThrow("GSD-ERR-003");
    });

    it("does not throw for valid session paths", () => {
      const sessionsDir = path.join(os.homedir(), ".gsd", "agent", "sessions");
      const validPath = path.join(sessionsDir, "test-cwd", "session.jsonl");
      expect(() => validateSessionPath(validPath)).not.toThrow();
    });
  });
});
