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
    realpathSync: vi.fn((p: string) => p), // identity — no real FS resolution
    writeFileSync: vi.fn(),
    promises: {
      ...actual.promises,
      access: vi.fn().mockResolvedValue(undefined),
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
  });

  // ─── handleOpenFile ────────────────────────────────────────────────

  describe("handleOpenFile", () => {
    it("opens a file within the workspace", () => {
      (fs.realpathSync as any).mockImplementation((p: string) => p);
      const ctx = createCtx();
      handleOpenFile(ctx, webview, sid, { path: "/mock/workspace/src/index.ts" });
      // path.resolve converts to platform absolute — just verify it was called
      expect(vsc.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.stringContaining("mock" + path.sep + "workspace" + path.sep + "src" + path.sep + "index.ts"),
      );
    });

    it("blocks open outside workspace", () => {
      (fs.realpathSync as any).mockImplementation((p: string) => p);
      const ctx = createCtx();
      handleOpenFile(ctx, webview, sid, { path: "/other/evil.ts" });
      expect(vsc.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("Blocked open_file outside workspace"));
    });

    it("logs when no workspace is open", () => {
      vsc.workspace.workspaceFolders = null as any;
      const ctx = createCtx();
      handleOpenFile(ctx, webview, sid, { path: "/any/file.ts" });
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("no workspace open"));
    });

    it("shows error message when realpathSync throws", () => {
      (fs.realpathSync as any).mockImplementation(() => { throw new Error("ENOENT"); });
      const ctx = createCtx();
      handleOpenFile(ctx, webview, sid, { path: "/mock/workspace/missing.ts" });
      expect(vsc.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("ENOENT"));
    });
  });

  // ─── handleOpenDiff ────────────────────────────────────────────────

  describe("handleOpenDiff", () => {
    it("executes vscode.diff with both URIs inside workspace", () => {
      (fs.realpathSync as any).mockImplementation((p: string) => p);
      const ctx = createCtx();
      handleOpenDiff(ctx, webview, sid, {
        leftPath: "/mock/workspace/a.ts",
        rightPath: "/mock/workspace/b.ts",
      });
      expect(vsc.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.diff",
        expect.objectContaining({ fsPath: expect.stringContaining("a.ts") }),
        expect.objectContaining({ fsPath: expect.stringContaining("b.ts") }),
      );
    });

    it("blocks diff when a path is outside workspace", () => {
      (fs.realpathSync as any).mockImplementation((p: string) => p);
      const ctx = createCtx();
      handleOpenDiff(ctx, webview, sid, {
        leftPath: "/mock/workspace/a.ts",
        rightPath: "/evil/b.ts",
      });
      expect(vsc.commands.executeCommand).not.toHaveBeenCalled();
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("Blocked open_diff"));
    });
  });

  // ─── handleOpenUrl ─────────────────────────────────────────────────

  describe("handleOpenUrl", () => {
    it("opens an https URL externally", () => {
      const ctx = createCtx();
      handleOpenUrl(ctx, webview, sid, { url: "https://example.com" });
      expect(vsc.env.openExternal).toHaveBeenCalled();
    });

    it("blocks non-http URLs", () => {
      const ctx = createCtx();
      handleOpenUrl(ctx, webview, sid, { url: "file:///etc/passwd" });
      expect(vsc.env.openExternal).not.toHaveBeenCalled();
      expect(ctx.output.appendLine).toHaveBeenCalledWith(expect.stringContaining("Blocked non-http URL"));
    });
  });

  // ─── handleExportHtml ──────────────────────────────────────────────

  describe("handleExportHtml", () => {
    it("writes HTML file and opens it when user selects a save path", async () => {
      vsc.window.showSaveDialog.mockResolvedValue({ fsPath: "/tmp/export.html" });
      const ctx = createCtx();
      await handleExportHtml(ctx, webview, sid, { html: "<p>Hello</p>", css: "body{}" });
      expect(fs.writeFileSync).toHaveBeenCalledWith("/tmp/export.html", expect.stringContaining("<p>Hello</p>"), "utf-8");
      expect(vsc.env.openExternal).toHaveBeenCalled();
      expect(vsc.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("Exported"));
    });

    it("does nothing when user cancels save dialog", async () => {
      vsc.window.showSaveDialog.mockResolvedValue(undefined);
      const ctx = createCtx();
      await handleExportHtml(ctx, webview, sid, { html: "<p>X</p>" });
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("posts error to webview on write failure", async () => {
      vsc.window.showSaveDialog.mockResolvedValue({ fsPath: "/tmp/export.html" });
      (fs.writeFileSync as any).mockImplementation(() => { throw new Error("disk full"); });
      const ctx = createCtx();
      await handleExportHtml(ctx, webview, sid, { html: "<p>X</p>" });
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, expect.objectContaining({ type: "error" }));
    });
  });

  // ─── handleSaveTempFile ────────────────────────────────────────────

  describe("handleSaveTempFile", () => {
    it("writes a base64 file and posts success", () => {
      (fs.writeFileSync as any).mockImplementation(() => {});
      const ctx = createCtx();
      handleSaveTempFile(ctx, webview, sid, { name: "test.png", data: "aGVsbG8=" });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join("/tmp/gsd-test", "test.png"),
        expect.any(Buffer),
      );
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, expect.objectContaining({ type: "temp_file_saved" }));
    });

    it("sanitizes path separators in filename", () => {
      (fs.writeFileSync as any).mockImplementation(() => {});
      const ctx = createCtx();
      handleSaveTempFile(ctx, webview, sid, { name: "../evil/file.txt", data: "YQ==" });
      // Forward slashes replaced with _ ; backslashes also replaced
      const call = (fs.writeFileSync as any).mock.calls[0][0] as string;
      expect(call).not.toContain("/evil");
      expect(path.basename(call)).toBe(".._evil_file.txt");
    });

    it("posts error to webview on write failure", () => {
      (fs.writeFileSync as any).mockImplementation(() => { throw new Error("nope"); });
      const ctx = createCtx();
      handleSaveTempFile(ctx, webview, sid, { name: "x.bin", data: "AA==" });
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, expect.objectContaining({ type: "error" }));
    });
  });

  // ─── handleCheckFileAccess ─────────────────────────────────────────

  describe("handleCheckFileAccess", () => {
    it("checks readability and posts results", async () => {
      (fs.promises.access as any)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("ENOENT"));
      const ctx = createCtx();
      await handleCheckFileAccess(ctx, webview, sid, { paths: ["/a.txt", "/b.txt"] });
      expect(ctx.postToWebview).toHaveBeenCalledWith(webview, {
        type: "file_access_result",
        results: [
          { path: "/a.txt", readable: true },
          { path: "/b.txt", readable: false },
        ],
      });
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
});
