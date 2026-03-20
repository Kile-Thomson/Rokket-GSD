// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../helpers", () => ({
  escapeHtml: (s: string) => String(s ?? ""),
}));

vi.mock("../state", () => ({
  state: {
    images: [],
    files: [],
  },
}));

import { parseDroppedUris, getFileIcon, handleFiles, renderFileChips, renderImagePreviews, addFileAttachments, init, type FileHandlingDeps } from "../file-handling";
import { state } from "../state";

describe("file-handling", () => {
  describe("parseDroppedUris", () => {
    it("returns empty array for empty string", () => {
      expect(parseDroppedUris("")).toEqual([]);
    });

    it("parses file:// URIs to local paths (Unix)", () => {
      const result = parseDroppedUris("file:///home/user/document.txt");
      expect(result).toEqual(["/home/user/document.txt"]);
    });

    it("parses file:// URIs to local paths (Windows)", () => {
      const result = parseDroppedUris("file:///C:/Users/test/file.ts");
      expect(result).toEqual(["C:/Users/test/file.ts"]);
    });

    it("handles multiple URIs separated by newlines", () => {
      const result = parseDroppedUris("file:///home/a.txt\nfile:///home/b.txt");
      expect(result).toEqual(["/home/a.txt", "/home/b.txt"]);
    });

    it("skips comment lines (starting with #)", () => {
      const result = parseDroppedUris("# This is a comment\nfile:///home/a.txt");
      expect(result).toEqual(["/home/a.txt"]);
    });

    it("skips non-file URIs", () => {
      const result = parseDroppedUris("https://example.com/file.txt");
      expect(result).toEqual([]);
    });

    it("decodes percent-encoded characters", () => {
      const result = parseDroppedUris("file:///home/user/my%20document.txt");
      expect(result).toEqual(["/home/user/my document.txt"]);
    });

    it("skips empty and whitespace-only lines", () => {
      const result = parseDroppedUris("\n  \nfile:///test.txt\n\n");
      expect(result).toEqual(["/test.txt"]);
    });
  });

  describe("getFileIcon", () => {
    it("returns document icon for PDF", () => {
      expect(getFileIcon("pdf")).toBe("📄");
    });

    it("returns code icon for TypeScript", () => {
      expect(getFileIcon("ts")).toBe("⚡");
    });

    it("returns Python icon for .py", () => {
      expect(getFileIcon("py")).toBe("🐍");
    });

    it("returns archive icon for zip", () => {
      expect(getFileIcon("zip")).toBe("📦");
    });

    it("returns image icon for png", () => {
      expect(getFileIcon("png")).toBe("🖼️");
    });

    it("returns default icon for unknown extensions", () => {
      expect(getFileIcon("xyz")).toBe("📎");
    });

    it("returns config icon for JSON", () => {
      expect(getFileIcon("json")).toBe("📋");
    });

    it("returns lock icon for .env", () => {
      expect(getFileIcon("env")).toBe("🔒");
    });

    it("returns web icon for HTML", () => {
      expect(getFileIcon("html")).toBe("🌐");
    });

    it("returns database icon for SQL", () => {
      expect(getFileIcon("sql")).toBe("🗃️");
    });
  });

  describe("renderFileChips", () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement("div");
      container.id = "fileChips";
      document.body.appendChild(container);
      const root = document.createElement("div");
      root.innerHTML = '<div class="gsd-input-area"></div>';
      document.body.appendChild(root);

      const deps: FileHandlingDeps = {
        root,
        imagePreview: document.createElement("div"),
        promptInput: document.createElement("textarea"),
        vscode: { postMessage: vi.fn() },
        onSendMessage: vi.fn(),
      };
      init(deps);
      (state as any).files = [];
    });

    it("hides container when no files", () => {
      renderFileChips();
      expect(container.classList.contains("gsd-hidden")).toBe(true);
      expect(container.innerHTML).toBe("");
    });

    it("renders file chips when addFileAttachments is called", () => {
      // addFileAttachments pushes to state.files and calls renderFileChips
      addFileAttachments(["/test/file.ts", "/test/doc.pdf"]);

      // Verify state was updated
      expect((state as any).files.length).toBe(2);
      // Verify the container was updated — look for the content via getElementById
      const el = document.getElementById("fileChips");
      expect(el).not.toBeNull();
      expect(el!.innerHTML).toContain("file.ts");
      expect(el!.innerHTML).toContain("doc.pdf");
    });
  });

  describe("renderImagePreviews", () => {
    let imagePreview: HTMLElement;
    let deps: FileHandlingDeps;

    beforeEach(() => {
      imagePreview = document.createElement("div");
      document.body.appendChild(imagePreview);
      const root = document.createElement("div");
      root.innerHTML = '<div class="gsd-input-area"></div>';
      document.body.appendChild(root);

      deps = {
        root,
        imagePreview,
        promptInput: document.createElement("textarea"),
        vscode: { postMessage: vi.fn() },
        onSendMessage: vi.fn(),
      };
      init(deps);
      (state as any).images = [];
    });

    it("hides container when no images", () => {
      renderImagePreviews();
      expect(imagePreview.classList.contains("gsd-hidden")).toBe(true);
    });

    it("shows thumbnails for attached images", () => {
      (state as any).images = [
        { type: "image", data: "base64data", mimeType: "image/png" },
      ];

      renderImagePreviews();
      expect(imagePreview.classList.contains("gsd-hidden")).toBe(false);
      expect(imagePreview.querySelector(".gsd-image-thumb")).not.toBeNull();
      expect(imagePreview.innerHTML).toContain("data:image/png;base64,base64data");
    });
  });

  describe("addFileAttachments", () => {
    beforeEach(() => {
      const container = document.createElement("div");
      container.id = "fileChips";
      document.body.appendChild(container);
      const root = document.createElement("div");
      root.innerHTML = '<div class="gsd-input-area"></div>';
      document.body.appendChild(root);

      const deps: FileHandlingDeps = {
        root,
        imagePreview: document.createElement("div"),
        promptInput: document.createElement("textarea"),
        vscode: { postMessage: vi.fn() },
        onSendMessage: vi.fn(),
      };
      init(deps);
      (state as any).files = [];
    });

    it("adds file attachments from paths", () => {
      addFileAttachments(["/home/user/code.ts"]);
      expect((state as any).files.length).toBe(1);
      expect((state as any).files[0].name).toBe("code.ts");
      expect((state as any).files[0].extension).toBe("ts");
    });

    it("avoids duplicate paths", () => {
      addFileAttachments(["/home/user/code.ts"]);
      addFileAttachments(["/home/user/code.ts"]);
      expect((state as any).files.length).toBe(1);
    });

    it("normalizes backslash paths", () => {
      addFileAttachments(["C:\\Users\\test\\file.py"]);
      expect((state as any).files[0].name).toBe("file.py");
      expect((state as any).files[0].extension).toBe("py");
    });
  });
});
