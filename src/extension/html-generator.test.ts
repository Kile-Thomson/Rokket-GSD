import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (...args: any[]) => {
      const path = args.slice(1).join("/");
      return { toString: () => path, fsPath: path };
    },
  },
}));

import { getNonce, getWebviewHtml } from "./html-generator";

describe("html-generator", () => {
  describe("getNonce", () => {
    it("returns a non-empty string", () => {
      const nonce = getNonce();
      expect(typeof nonce).toBe("string");
      expect(nonce.length).toBeGreaterThan(0);
    });

    it("returns unique values on successive calls", () => {
      const nonce1 = getNonce();
      const nonce2 = getNonce();
      expect(nonce1).not.toBe(nonce2);
    });

    it("returns a base64url-encoded string (no +, /, or = characters)", () => {
      const nonce = getNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("returns a 22-character string (16 bytes in base64url)", () => {
      const nonce = getNonce();
      expect(nonce.length).toBe(22);
    });
  });

  describe("getWebviewHtml", () => {
    it("returns valid HTML document with CSP, script, and style tags", () => {
      const extensionUri = {} as any;
      const webview = {
        asWebviewUri: (uri: any) => `https://webview/${uri.toString()}`,
        cspSource: "https://csp-source",
      } as any;

      const html = getWebviewHtml(extensionUri, webview, "test-session-123");

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<html lang="en">');
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("https://csp-source");
      expect(html).toContain('<div id="root"></div>');
      expect(html).toContain("test-session-123");
      expect(html).toContain("Rokket GSD");
      // Should contain nonce attributes on script tags
      expect(html).toMatch(/nonce="[A-Za-z0-9_-]+"/);
      // Should reference the dist script and style
      expect(html).toContain("dist/webview/index.js");
      expect(html).toContain("dist/webview/index.css");
    });

    it("embeds session ID as JSON in a script tag", () => {
      const webview = {
        asWebviewUri: (uri: any) => `uri:${uri}`,
        cspSource: "test",
      } as any;

      const html = getWebviewHtml({} as any, webview, "session-with-special-chars");
      expect(html).toContain('window.GSD_SESSION_ID = "session-with-special-chars"');
    });
  });
});
