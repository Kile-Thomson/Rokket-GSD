import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";

// ── Mock vscode with file-ops–specific APIs (factory must be self-contained) ──

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [
      { uri: { fsPath: "/mock/workspace" }, name: "ws", index: 0 },
    ],
    openTextDocument: vi.fn().mockResolvedValue({ uri: { fsPath: "/mock/workspace/file.ts" } }),
    getConfiguration: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
  },
  window: {
    showTextDocument: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  commands: { executeCommand: vi.fn() },
  Uri: {
    file: (fsPath: string) => ({ fsPath, scheme: "file" }),
    parse: (uri: string) => ({ fsPath: uri, scheme: "https" }),
  },
  env: {
    openExternal: vi.fn(),
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  },
  extensions: {
    getExtension: vi.fn(() => ({ packageJSON: { version: "1.2.3" } })),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}));

// Mock fs — needed by handleOpenFile, handleSaveTempFile, handleCheckFileAccess, handleExportHtml
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      access: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn(),
      realpath: vi.fn((p: string) => Promise.resolve(p)), // identity — no real FS resolution
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import * as vscode from "vscode";
import * as fs from "fs";

// Typed alias for accessing mock methods on the vscode mock
const vsc = vscode as any;

import {
  handleOpenFile,
  handleOpenDiff,
  handleOpenUrl,
  handleExportHtml,
  handleSaveTempFile,
  handleCheckFileAccess,
  handleAttachFiles,
  handleCopyText,
  handleSetTheme,
  cleanStaleCrashLock,
  type FileOpsContext,
} from "./file-ops";

// ── Helpers ──────────────────────────────────────────────────────────────

function createCtx(overrides: Partial<FileOpsContext> = {}): FileOpsContext {
  return {
    postToWebview: vi.fn(),
    output: { appendLine: vi.fn() } as any,
    ensureTempDir: vi.fn(() => "/tmp/gsd-test"),
    ...overrides,
  };
}

const webview = {} as any;
const sid = "test-session";

// ── Tests ────────────────────────────────────────────────────────────────

describe("file-ops", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore workspace folders (some tests may clear it)
    vsc.workspace.workspaceFolders = [
      { uri: { fsPath: "/mock/workspace" }, name: "ws", index: 0 },
    ];
    // Restore realpath identity mock (clearAllMocks resets implementations)
    (fs.promises.realpath as any).mockImplementation((p: string) => Promise.resolve(p));
    (fs.promises.writeFile as any).mockResolvedValue(undefined);
    (fs.promises.unlink as any).mockResolvedValue(undefined);
  });

  // ─── handleOpenFile ────────────────────────────────────────────────

  describe("handleOpenFile", () => {
    it("opens a file within the workspace", async () => {
      (fs.promises.realpath as any).mockImplementation((p: string) => Promise.resolve(p));
      const ctx = createCtx();
      // Use path.resolve to produce a platform-native absolute path so the
      // workspace boundary check works on both Unix and Windows.
      const filePath = path.resolve("/mock/workspace/src/index.ts");
      vsc.workspace.workspaceFolders = [
        { uri: { fsPath: path.resolve("/mock/workspace") }, name: "ws", index: 0 },
      ] as any;
      await handleOpenFile(ctx, webview, sid, { path: filePath });
      expect(vsc.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.stringContaining("mock" + path.sep + "workspace" + path.sep + "src" + path.sep + "index.ts"),
      );
    });

    it("blocks open outside workspace", async () => {
      (fs.promises.realpath as any).mockImplementation((p: string) => Promise.resolve(p));
      const ctx = createCtx();
      await handleOpenFile(ctx, webview, sid, { path: "/other/evil.ts" });
      expect(vsc.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("Blocked open_file outside workspace"));
    });

    it("logs when no workspace is open", async () => {
      vsc.workspace.workspaceFolders = null as any;
      const ctx = createCtx();
      await handleOpenFile(ctx, webview, sid, { path: "/any/file.ts" });
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("no workspace open"));
    });

    it("falls back to resolvedPath when realpath rejects for the target file", async () => {
      // First call (for the target file) rejects; second call (workspace root) resolves.
      (fs.promises.realpath as any)
        .mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
        .mockImplementation((p: string) => Promise.resolve(p));
      const ctx = createCtx();
      // Use path.resolve so paths are platform-native (avoids Windows mixed-sep mismatch)
      const wsRoot = path.resolve("/mock/workspace");
      vsc.workspace.workspaceFolders = [{ uri: { fsPath: wsRoot }, name: "ws", index: 0 }] as any;
      await handleOpenFile(ctx, webview, sid, { path: path.join(wsRoot, "missing.ts") });
      // Falls back to resolvedPath — still within workspace — openTextDocument is called
      expect(vsc.workspace.openTextDocument).toHaveBeenCalled();
    });
  });

  // ─── handleOpenDiff ────────────────────────────────────────────────

  describe("handleOpenDiff", () => {
    it("executes vscode.diff with both URIs inside workspace", async () => {
      (fs.promises.realpath as any).mockImplementation((p: string) => Promise.resolve(p));
      const ctx = createCtx();
      await handleOpenDiff(ctx, webview, sid, {
        leftPath: "/mock/workspace/a.ts",
        rightPath: "/mock/workspace/b.ts",
      });
      expect(vsc.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.diff",
        expect.objectContaining({ fsPath: expect.stringContaining("a.ts") }),
        expect.objectContaining({ fsPath: expect.stringContaining("b.ts") }),
      );
    });

    it("blocks diff when a path is outside workspace", async () => {
      (fs.promises.realpath as any).mockImplementation((p: string) => Promise.resolve(p));
      const ctx = createCtx();
      await handleOpenDiff(ctx, webview, sid, {
        leftPath: "/mock/workspace/a.ts",
        rightPath: "/evil/b.ts",
      });
      expect(vsc.commands.executeCommand).not.toHaveBeenCalled();
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("Blocked open_diff"));
    });
  });

  // ─── handleOpenUrl ─────────────────────────────────────────────────

  describe("handleOpenUrl", () => {
    it("opens an https URL externally", async () => {
      const ctx = createCtx();
      await handleOpenUrl(ctx, webview, sid, { url: "https://example.com" });
      expect(vsc.env.openExternal).toHaveBeenCalled();
    });

    it("blocks non-http URLs", async () => {
      const ctx = createCtx();
      await handleOpenUrl(ctx, webview, sid, { url: "file:///etc/passwd" });
      expect(vsc.env.openExternal).not.toHaveBeenCalled();
      // file:// paths are routed to handleOpenFile which blocks paths outside workspace
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("Blocked"));
    });

    it("routes relative file paths to handleOpenFile", async () => {
      const ctx = createCtx();
      // Relative paths that look like file paths should not be opened externally
      await handleOpenUrl(ctx, webview, sid, { url: "readme.md" });
      expect(vsc.env.openExternal).not.toHaveBeenCalled();
    });

    it("blocks anchor-only URLs", async () => {
      const ctx = createCtx();
      await handleOpenUrl(ctx, webview, sid, { url: "#section" });
      expect(vsc.env.openExternal).not.toHaveBeenCalled();
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("Blocked"));
    });
  });

  // ─── handleExportHtml ──────────────────────────────────────────────

  describe("handleExportHtml", () => {
    it("writes HTML file and opens it when user selects a save path", async () => {
      vsc.window.showSaveDialog.mockResolvedValue({ fsPath: "/tmp/export.html" });
      const ctx = createCtx();
      await handleExportHtml(ctx, webview, sid, { html: "<p>Hello</p>", css: "body{}" });
      expect(fs.promises.writeFile).toHaveBeenCalledWith("/tmp/export.html", expect.stringContaining("<p>Hello</p>"), "utf-8");
      expect(vsc.env.openExternal).toHaveBeenCalled();
      expect(vsc.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("Exported"));
    });

    it("does nothing when user cancels save dialog", async () => {
      vsc.window.showSaveDialog.mockResolvedValue(undefined);
      const ctx = createCtx();
      await handleExportHtml(ctx, webview, sid, { html: "<p>X</p>" });
      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it("posts error to webview on write failure", async () => {
      vsc.window.showSaveDialog.mockResolvedValue({ fsPath: "/tmp/export.html" });
      (fs.promises.writeFile as any).mockRejectedValue(new Error("disk full"));
      const ctx = createCtx();
      await handleExportHtml(ctx, webview, sid, { html: "<p>X</p>" });
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, expect.objectContaining({ type: "error" }));
    });
  });

  // ─── handleSaveTempFile ────────────────────────────────────────────

  describe("handleSaveTempFile", () => {
    it("writes a base64 file and posts success", async () => {
      const ctx = createCtx();
      await handleSaveTempFile(ctx, webview, sid, { name: "test.png", data: "aGVsbG8=" });
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.join("/tmp/gsd-test", "test.png"),
        expect.any(Buffer),
      );
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, expect.objectContaining({ type: "temp_file_saved" }));
    });

    it("sanitizes path separators in filename", async () => {
      const ctx = createCtx();
      await handleSaveTempFile(ctx, webview, sid, { name: "../evil/file.txt", data: "YQ==" });
      // Forward slashes replaced with _ ; backslashes also replaced
      const call = (fs.promises.writeFile as any).mock.calls[0][0] as string;
      expect(call).not.toContain("/evil");
      expect(path.basename(call)).toBe(".._evil_file.txt");
    });

    it("posts error to webview on write failure", async () => {
      (fs.promises.writeFile as any).mockRejectedValue(new Error("nope"));
      const ctx = createCtx();
      await handleSaveTempFile(ctx, webview, sid, { name: "x.bin", data: "AA==" });
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, expect.objectContaining({ type: "error" }));
    });

    it("rejects payloads exceeding 50MB limit", async () => {
      const ctx = createCtx();
      // Create a string slightly over the 66_666_667 base64 threshold
      const oversizedData = "A".repeat(66_666_668);
      await handleSaveTempFile(ctx, webview, sid, { name: "huge.bin", data: oversizedData });
      expect(fs.promises.writeFile).not.toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, {
        type: "error",
        message: "File exceeds 50MB limit",
      });
      expect(ctx.output.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("Blocked save_temp_file: payload exceeds 50MB limit"),
      );
    });

    it("allows payloads under 50MB limit", async () => {
      const ctx = createCtx();
      const normalData = "A".repeat(1000);
      await handleSaveTempFile(ctx, webview, sid, { name: "small.bin", data: normalData });
      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, expect.objectContaining({ type: "temp_file_saved" }));
    });
  });

  // ─── handleCheckFileAccess ─────────────────────────────────────────

  describe("handleCheckFileAccess", () => {
    it("checks readability and posts results for workspace-internal paths", async () => {
      (fs.promises.realpath as any).mockImplementation((p: string) => Promise.resolve(p));
      (fs.promises.access as any)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("ENOENT"));
      const ctx = createCtx();
      await handleCheckFileAccess(ctx, webview, sid, {
        paths: ["/mock/workspace/a.txt", "/mock/workspace/b.txt"],
      });
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, {
        type: "file_access_result",
        results: [
          { path: "/mock/workspace/a.txt", readable: true },
          { path: "/mock/workspace/b.txt", readable: false },
        ],
      });
    });

    it("blocks paths outside the workspace boundary", async () => {
      (fs.promises.realpath as any).mockImplementation((p: string) => Promise.resolve(p));
      const ctx = createCtx();
      await handleCheckFileAccess(ctx, webview, sid, {
        paths: ["/etc/passwd", "/mock/workspace/ok.txt"],
      });
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, {
        type: "file_access_result",
        results: [
          { path: "/etc/passwd", readable: false },
          { path: "/mock/workspace/ok.txt", readable: true },
        ],
      });
      expect(ctx.output.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("Blocked check_file_access outside workspace"),
      );
    });

    it("rejects all paths when no workspace is open", async () => {
      vsc.workspace.workspaceFolders = null as any;
      const ctx = createCtx();
      await handleCheckFileAccess(ctx, webview, sid, {
        paths: ["/any/file.txt"],
      });
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, {
        type: "file_access_result",
        results: [{ path: "/any/file.txt", readable: false }],
      });
      expect(ctx.output.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("no workspace open"),
      );
    });
  });

  // ─── handleAttachFiles ─────────────────────────────────────────────

  describe("handleAttachFiles", () => {
    it("posts attached file paths when user selects files", async () => {
      vsc.window.showOpenDialog.mockResolvedValue([
        { fsPath: "/mock/workspace/a.ts" },
        { fsPath: "/mock/workspace/b.ts" },
      ]);
      const ctx = createCtx();
      await handleAttachFiles(ctx, webview, sid);
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, {
        type: "files_attached",
        paths: ["/mock/workspace/a.ts", "/mock/workspace/b.ts"],
      });
    });

    it("does nothing when user cancels dialog", async () => {
      vsc.window.showOpenDialog.mockResolvedValue(undefined);
      const ctx = createCtx();
      await handleAttachFiles(ctx, webview, sid);
      expect(ctx.postToWebview).not.toHaveBeenCalled();
    });
  });

  // ─── handleCopyText ────────────────────────────────────────────────

  describe("handleCopyText", () => {
    it("writes text to clipboard", async () => {
      const ctx = createCtx();
      await handleCopyText(ctx, webview, sid, { text: "hello" });
      expect(vsc.env.clipboard.writeText).toHaveBeenCalledWith("hello");
    });
  });

  // ─── handleSetTheme ────────────────────────────────────────────────

  describe("handleSetTheme", () => {
    it("updates gsd theme configuration globally", async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      vsc.workspace.getConfiguration.mockReturnValue({ update: mockUpdate });
      const ctx = createCtx();
      await handleSetTheme(ctx, webview, sid, { theme: "dark" });
      expect(vsc.workspace.getConfiguration).toHaveBeenCalledWith("gsd");
      expect(mockUpdate).toHaveBeenCalledWith("theme", "dark", 1); // ConfigurationTarget.Global
    });
  });

  // ─── cleanStaleCrashLock ───────────────────────────────────────────

  describe("cleanStaleCrashLock", () => {
    it("removes lock when STATE.md says idle", async () => {
      // access resolves (lock exists), readFile returns idle state
      (fs.promises.access as any).mockResolvedValue(undefined);
      (fs.promises.readFile as any).mockResolvedValue(
        "**Active Milestone:** none\n**Phase:** idle\n"
      );

      const output = { appendLine: vi.fn() } as any;
      await cleanStaleCrashLock("/project", output);

      expect(fs.promises.unlink).toHaveBeenCalledWith(
        expect.stringContaining("auto.lock"),
      );
      expect(output.appendLine).toHaveBeenCalledWith(
        expect.stringContaining("Removed stale"),
      );
    });

    it("removes lock when no STATE.md exists", async () => {
      // access resolves (lock exists), readFile rejects with ENOENT (no STATE.md)
      (fs.promises.access as any).mockResolvedValue(undefined);
      (fs.promises.readFile as any).mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      const output = { appendLine: vi.fn() } as any;
      await cleanStaleCrashLock("/project", output);

      expect(fs.promises.unlink).toHaveBeenCalledWith(
        expect.stringContaining("auto.lock"),
      );
    });

    it("does not remove lock when milestone is active", async () => {
      (fs.promises.access as any).mockResolvedValue(undefined);
      (fs.promises.readFile as any).mockResolvedValue(
        "**Active Milestone:** M015\n**Phase:** building\n"
      );

      const output = { appendLine: vi.fn() } as any;
      await cleanStaleCrashLock("/project", output);

      expect(fs.promises.unlink).not.toHaveBeenCalled();
    });

    it("does nothing when no lock file exists", async () => {
      // access rejects (lock doesn't exist)
      (fs.promises.access as any).mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      );

      const output = { appendLine: vi.fn() } as any;
      await cleanStaleCrashLock("/project", output);

      expect(fs.promises.unlink).not.toHaveBeenCalled();
    });

    it("does not throw on errors", async () => {
      (fs.promises.access as any).mockRejectedValue(new Error("boom"));

      const output = { appendLine: vi.fn() } as any;
      await expect(cleanStaleCrashLock("/project", output)).resolves.not.toThrow();
    });
  });
});
