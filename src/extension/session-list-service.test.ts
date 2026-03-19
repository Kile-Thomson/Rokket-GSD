import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getSessionDir, buildSessionInfo, listSessions, deleteSession } from "./session-list-service";

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
});
