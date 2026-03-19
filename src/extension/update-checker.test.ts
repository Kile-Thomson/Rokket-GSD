import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage } from "http";
import { EventEmitter } from "events";

// ── Mock vscode ──
const mockGetConfiguration = vi.fn();
const mockShowInformationMessage = vi.fn().mockResolvedValue(undefined);
const mockShowWarningMessage = vi.fn().mockResolvedValue(undefined);
const mockShowErrorMessage = vi.fn().mockResolvedValue(undefined);
const mockWithProgress = vi.fn();
const mockGetExtension = vi.fn();
const mockGlobalStateGet = vi.fn();
const mockGlobalStateUpdate = vi.fn().mockResolvedValue(undefined);
const mockExecuteCommand = vi.fn();
const mockOpenExternal = vi.fn();

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: (...args: unknown[]) => mockGetConfiguration(...args),
  },
  window: {
    showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
    showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
    withProgress: (...args: unknown[]) => mockWithProgress(...args),
  },
  extensions: {
    getExtension: (...args: unknown[]) => mockGetExtension(...args),
  },
  commands: {
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
  },
  env: {
    openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, scheme: "file" }),
    parse: (u: string) => ({ fsPath: u, scheme: "https" }),
  },
  ProgressLocation: { Notification: 15 },
}));

// ── Mock https ──
const mockHttpsGet = vi.fn();
vi.mock("https", () => ({
  get: (...args: unknown[]) => mockHttpsGet(...args),
}));

// ── Mock child_process ──
const mockExecSync = vi.fn();
vi.mock("child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// ── Mock fs ──
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  createWriteStream: vi.fn(() => {
    const s = new EventEmitter();
    (s as any).close = vi.fn((cb?: () => void) => cb?.());
    (s as any).destroy = vi.fn();
    return s;
  }),
  unlinkSync: vi.fn(),
}));

import {
  startUpdateChecker,
  dismissUpdateVersion,
  fetchReleaseNotes,
  fetchRecentReleases,
} from "./update-checker";

// ── Helpers ──

/** Create a mock IncomingMessage that emits data + end */
function createMockResponse(statusCode: number, body: string): IncomingMessage {
  const res = new EventEmitter() as IncomingMessage & EventEmitter;
  (res as any).statusCode = statusCode;
  (res as any).headers = {};
  (res as any).resume = vi.fn();

  // Schedule data+end emission
  process.nextTick(() => {
    res.emit("data", Buffer.from(body));
    res.emit("end");
  });

  return res;
}

function createMockContext() {
  return {
    globalState: {
      get: mockGlobalStateGet,
      update: mockGlobalStateUpdate,
    },
    subscriptions: [] as Array<{ dispose: () => void }>,
  } as any;
}

describe("update-checker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "autoUpdate") return true;
        if (key === "githubToken") return "";
        return defaultValue;
      }),
    });
    mockGetExtension.mockReturnValue({
      packageJSON: { version: "1.0.0" },
    });
    mockExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("startUpdateChecker", () => {
    it("sets up timers when autoUpdate is enabled", () => {
      const ctx = createMockContext();
      const provider = { broadcast: vi.fn() } as any;

      startUpdateChecker(ctx, provider);

      // Should have registered disposables for initial timer + interval
      expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(2);
    });

    it("does nothing when autoUpdate is disabled", () => {
      mockGetConfiguration.mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "autoUpdate") return false;
          return undefined;
        }),
      });
      const ctx = createMockContext();
      const provider = { broadcast: vi.fn() } as any;

      startUpdateChecker(ctx, provider);

      expect(ctx.subscriptions.length).toBe(0);
    });

    it("does nothing when installed version cannot be resolved", () => {
      mockGetExtension.mockReturnValue(undefined);
      const ctx = createMockContext();
      const provider = { broadcast: vi.fn() } as any;

      startUpdateChecker(ctx, provider);

      expect(ctx.subscriptions.length).toBe(0);
    });
  });

  describe("dismissUpdateVersion", () => {
    it("stores the dismissed version in global state", async () => {
      const ctx = createMockContext();

      await dismissUpdateVersion("2.0.0", ctx);

      expect(mockGlobalStateUpdate).toHaveBeenCalledWith(
        "gsd.dismissedUpdateVersion",
        "2.0.0",
      );
    });
  });

  describe("fetchReleaseNotes", () => {
    it("returns release body on 200 response", async () => {
      const body = JSON.stringify({ body: "## What's new\n- Feature A\n- Fix B" });

      mockHttpsGet.mockImplementation((_url: string, _opts: unknown, cb: (res: IncomingMessage) => void) => {
        const res = createMockResponse(200, body);
        cb(res);
        return { on: vi.fn(), destroy: vi.fn() };
      });

      const notes = await fetchReleaseNotes("1.2.0");
      expect(notes).toBe("## What's new\n- Feature A\n- Fix B");
    });

    it("prepends v to version if not present", async () => {
      mockHttpsGet.mockImplementation((url: string, _opts: unknown, cb: (res: IncomingMessage) => void) => {
        expect(url).toContain("/tags/v1.2.0");
        const res = createMockResponse(200, JSON.stringify({ body: "notes" }));
        cb(res);
        return { on: vi.fn(), destroy: vi.fn() };
      });

      await fetchReleaseNotes("1.2.0");
    });

    it("returns null on non-200 response", async () => {
      mockHttpsGet.mockImplementation((_url: string, _opts: unknown, cb: (res: IncomingMessage) => void) => {
        const res = createMockResponse(404, "Not Found");
        cb(res);
        return { on: vi.fn(), destroy: vi.fn() };
      });

      const notes = await fetchReleaseNotes("99.99.99");
      expect(notes).toBeNull();
    });

    it("returns null on request error", async () => {
      mockHttpsGet.mockImplementation((_url: string, _opts: unknown, _cb: unknown) => {
        const req = new EventEmitter();
        (req as any).destroy = vi.fn();
        process.nextTick(() => req.emit("error", new Error("network fail")));
        return req;
      });

      const notes = await fetchReleaseNotes("1.0.0");
      expect(notes).toBeNull();
    });
  });

  describe("fetchRecentReleases", () => {
    it("returns parsed releases on 200 response", async () => {
      const body = JSON.stringify([
        { tag_name: "v2.0.0", body: "Release 2", published_at: "2025-01-01T00:00:00Z" },
        { tag_name: "v1.0.0", body: "Release 1", published_at: "2024-01-01T00:00:00Z" },
        { tag_name: "v0.9.0", body: "", published_at: "2023-06-01T00:00:00Z" }, // empty body → filtered out
      ]);

      mockHttpsGet.mockImplementation((_url: string, _opts: unknown, cb: (res: IncomingMessage) => void) => {
        const res = createMockResponse(200, body);
        cb(res);
        return { on: vi.fn(), destroy: vi.fn() };
      });

      const releases = await fetchRecentReleases(10);
      expect(releases).toHaveLength(2);
      expect(releases[0]).toEqual({
        version: "2.0.0",
        notes: "Release 2",
        date: "2025-01-01T00:00:00Z",
      });
      expect(releases[1].version).toBe("1.0.0");
    });

    it("returns empty array on non-200 response", async () => {
      mockHttpsGet.mockImplementation((_url: string, _opts: unknown, cb: (res: IncomingMessage) => void) => {
        const res = createMockResponse(403, "Forbidden");
        cb(res);
        return { on: vi.fn(), destroy: vi.fn() };
      });

      const releases = await fetchRecentReleases();
      expect(releases).toEqual([]);
    });

    it("returns empty array on JSON parse failure", async () => {
      mockHttpsGet.mockImplementation((_url: string, _opts: unknown, cb: (res: IncomingMessage) => void) => {
        const res = createMockResponse(200, "not json");
        cb(res);
        return { on: vi.fn(), destroy: vi.fn() };
      });

      const releases = await fetchRecentReleases();
      expect(releases).toEqual([]);
    });

    it("returns empty array on request error", async () => {
      mockHttpsGet.mockImplementation((_url: string, _opts: unknown, _cb: unknown) => {
        const req = new EventEmitter();
        (req as any).destroy = vi.fn();
        process.nextTick(() => req.emit("error", new Error("timeout")));
        return req;
      });

      const releases = await fetchRecentReleases();
      expect(releases).toEqual([]);
    });

    it("strips v prefix from version tags", async () => {
      const body = JSON.stringify([
        { tag_name: "v3.1.0", body: "Some notes", published_at: "2025-03-01" },
      ]);

      mockHttpsGet.mockImplementation((_url: string, _opts: unknown, cb: (res: IncomingMessage) => void) => {
        const res = createMockResponse(200, body);
        cb(res);
        return { on: vi.fn(), destroy: vi.fn() };
      });

      const releases = await fetchRecentReleases();
      expect(releases[0].version).toBe("3.1.0");
    });
  });
});
