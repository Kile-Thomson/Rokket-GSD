import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: vi.fn((...args: any[]) => ({
      fsPath: args.map((a: any) => (typeof a === "string" ? a : a.fsPath)).join("/"),
    })),
  },
  workspace: {},
}));

import { getNonce } from "./html-generator";

describe("getNonce", () => {
  it("returns a base64url string of expected length", () => {
    const nonce = getNonce();
    // 16 bytes → 22 chars in base64url (no padding)
    expect(nonce).toHaveLength(22);
  });

  it("produces only base64url-safe characters", () => {
    const nonce = getNonce();
    // base64url uses A-Z, a-z, 0-9, -, _ (no + / =)
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique values on successive calls", () => {
    const nonces = new Set(Array.from({ length: 100 }, () => getNonce()));
    // With 16 random bytes, collisions are astronomically unlikely
    expect(nonces.size).toBe(100);
  });
});
