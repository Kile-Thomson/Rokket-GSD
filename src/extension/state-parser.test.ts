import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseActiveRef, parsePhase, parseGsdWorkflowState } from "./state-parser";

// ============================================================
// parseActiveRef
// ============================================================

describe("parseActiveRef", () => {
  it("parses ID — Title format", () => {
    const content = "**Active Milestone:** M004 — Build the thing";
    expect(parseActiveRef(content, "Milestone")).toEqual({
      id: "M004",
      title: "Build the thing",
    });
  });
  it("parses ID: Title format", () => {
    const content = "**Active Slice:** S02: Add tests";
    expect(parseActiveRef(content, "Slice")).toEqual({
      id: "S02",
      title: "Add tests",
    });
  });
  it("parses ID only (no title)", () => {
    const content = "**Active Task:** T01";
    expect(parseActiveRef(content, "Task")).toEqual({ id: "T01", title: "" });
  });
  it("returns null for (none)", () => {
    const content = "**Active Milestone:** (none)";
    expect(parseActiveRef(content, "Milestone")).toBeNull();
  });
  it("returns null when label not found", () => {
    expect(parseActiveRef("no match here", "Milestone")).toBeNull();
  });
  it("strips ✓ COMPLETE suffix", () => {
    const content = "**Active Milestone:** M001 — Setup ✓ COMPLETE";
    const result = parseActiveRef(content, "Milestone");
    expect(result).toEqual({ id: "M001", title: "Setup" });
  });
});

// ============================================================
// parsePhase
// ============================================================

describe("parsePhase", () => {
  it("parses phase value", () => {
    expect(parsePhase("**Phase:** Executing")).toBe("executing");
  });
  it("returns unknown when not found", () => {
    expect(parsePhase("nothing here")).toBe("unknown");
  });
  it("lowercases the result", () => {
    expect(parsePhase("**Phase:** Planning")).toBe("planning");
  });
});

// ============================================================
// parseGsdWorkflowState (real temp files)
// ============================================================

describe("parseGsdWorkflowState", () => {
  let tmpDir: string;

  async function writeState(content: string) {
    const gsdDir = path.join(tmpDir, ".gsd");
    await fs.promises.mkdir(gsdDir, { recursive: true });
    await fs.promises.writeFile(path.join(gsdDir, "STATE.md"), content, "utf-8");
  }

  it("parses a full STATE.md", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gsd-test-"));
    await writeState(`# GSD State

**Active Milestone:** M006 — Testing
**Active Slice:** S01 — Unit tests
**Active Task:** T01 — Install vitest
**Phase:** Executing
`);
    const state = await parseGsdWorkflowState(tmpDir);
    expect(state).not.toBeNull();
    expect(state!.milestone).toEqual({ id: "M006", title: "Testing" });
    expect(state!.slice).toEqual({ id: "S01", title: "Unit tests" });
    expect(state!.task).toEqual({ id: "T01", title: "Install vitest" });
    expect(state!.phase).toBe("executing");
    expect(state!.autoMode).toBeNull();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when STATE.md doesn't exist", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gsd-test-"));
    const state = await parseGsdWorkflowState(tmpDir);
    expect(state).toBeNull();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("handles partial state", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gsd-test-"));
    await writeState(`**Active Milestone:** M001 — Init\n**Phase:** Planning`);
    const state = await parseGsdWorkflowState(tmpDir);
    expect(state!.milestone).toEqual({ id: "M001", title: "Init" });
    expect(state!.slice).toBeNull();
    expect(state!.task).toBeNull();
    expect(state!.phase).toBe("planning");
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });
});
