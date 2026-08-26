import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveFormattingAddendum, _resetAddendumCacheForTest } from "./rpc-client";

let tmpDir: string;

beforeEach(() => {
  _resetAddendumCacheForTest();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-addendum-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEngine(cliJsContent: string | null): string {
  const entry = path.join(tmpDir, "loader.js");
  fs.writeFileSync(entry, "// entry", "utf-8");
  if (cliJsContent !== null) {
    fs.writeFileSync(path.join(tmpDir, "cli.js"), cliJsContent, "utf-8");
  }
  return entry;
}

describe("resolveFormattingAddendum", () => {
  it("returns a readable temp file when the engine supports the flag", () => {
    const entry = makeEngine("parseCliArgs ... '--append-system-prompt' ...");
    const result = resolveFormattingAddendum({ command: "node", args: [entry], useShell: false });
    expect(result).not.toBeNull();
    const content = fs.readFileSync(result!, "utf-8");
    expect(content).toContain("GitHub-flavored markdown");
  });

  it("returns null when the engine cli.js lacks the flag", () => {
    const entry = makeEngine("no such flag here");
    expect(resolveFormattingAddendum({ command: "node", args: [entry], useShell: false })).toBeNull();
  });

  it("returns null when cli.js is missing", () => {
    const entry = makeEngine(null);
    expect(resolveFormattingAddendum({ command: "node", args: [entry], useShell: false })).toBeNull();
  });

  it("returns null for shell spawns", () => {
    const entry = makeEngine("'--append-system-prompt'");
    expect(resolveFormattingAddendum({ command: entry, args: [], useShell: true })).toBeNull();
  });

  it("returns null for bare command on PATH", () => {
    expect(resolveFormattingAddendum({ command: "gsd", args: [], useShell: false })).toBeNull();
  });

  it("resolves a direct script command (unix symlink case)", () => {
    const entry = makeEngine("'--append-system-prompt'");
    // command points straight at the script, args empty — unix resolution shape
    const result = resolveFormattingAddendum({ command: entry, args: [], useShell: false });
    expect(result).not.toBeNull();
  });

  it("caches the support check per entry path", () => {
    const entry = makeEngine("'--append-system-prompt'");
    const first = resolveFormattingAddendum({ command: "node", args: [entry], useShell: false });
    // Remove cli.js — cached verdict should still allow the addendum
    fs.rmSync(path.join(tmpDir, "cli.js"));
    const second = resolveFormattingAddendum({ command: "node", args: [entry], useShell: false });
    expect(second).toBe(first);
  });
});
