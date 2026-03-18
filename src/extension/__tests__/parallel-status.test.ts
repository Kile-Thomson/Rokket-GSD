import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { readParallelWorkers, readBudgetCeiling } from "../parallel-status";

describe("readParallelWorkers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-parallel-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeStatus(name: string, data: Record<string, unknown>): void {
    const dir = path.join(tmpDir, ".gsd", "parallel");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  }

  it("returns null when .gsd/parallel/ does not exist", () => {
    expect(readParallelWorkers(tmpDir)).toBeNull();
  });

  it("returns null when directory is empty", () => {
    fs.mkdirSync(path.join(tmpDir, ".gsd", "parallel"), { recursive: true });
    expect(readParallelWorkers(tmpDir)).toBeNull();
  });

  it("parses a valid worker status file", () => {
    writeStatus("M001.status.json", {
      milestoneId: "M001",
      pid: 1234,
      state: "running",
      currentUnit: { type: "task", id: "T01" },
      completedUnits: 3,
      cost: 0.42,
      lastHeartbeat: Date.now(),
    });

    const workers = readParallelWorkers(tmpDir);
    expect(workers).toHaveLength(1);
    expect(workers![0]).toMatchObject({
      id: "M001",
      pid: 1234,
      state: "running",
      currentUnit: { type: "task", id: "T01" },
      completedUnits: 3,
      cost: 0.42,
      stale: false,
    });
  });

  it("parses multiple worker files", () => {
    writeStatus("M001.status.json", {
      milestoneId: "M001",
      pid: 1000,
      state: "running",
      cost: 0.10,
      lastHeartbeat: Date.now(),
    });
    writeStatus("M002.status.json", {
      milestoneId: "M002",
      pid: 2000,
      state: "paused",
      cost: 0.20,
      lastHeartbeat: Date.now(),
    });

    const workers = readParallelWorkers(tmpDir);
    expect(workers).toHaveLength(2);
    const ids = workers!.map(w => w.id).sort();
    expect(ids).toEqual(["M001", "M002"]);
  });

  it("marks workers with old heartbeat as stale", () => {
    writeStatus("M001.status.json", {
      milestoneId: "M001",
      pid: 1234,
      state: "running",
      lastHeartbeat: Date.now() - 60_000, // 60s ago
      cost: 0,
    });

    const workers = readParallelWorkers(tmpDir);
    expect(workers![0].stale).toBe(true);
  });

  it("marks workers with recent heartbeat as not stale", () => {
    writeStatus("M001.status.json", {
      milestoneId: "M001",
      pid: 1234,
      state: "running",
      lastHeartbeat: Date.now() - 5_000, // 5s ago
      cost: 0,
    });

    const workers = readParallelWorkers(tmpDir);
    expect(workers![0].stale).toBe(false);
  });

  it("defaults unknown state to error", () => {
    writeStatus("M001.status.json", {
      milestoneId: "M001",
      pid: 1234,
      state: "unknown-state",
      cost: 0,
      lastHeartbeat: Date.now(),
    });

    const workers = readParallelWorkers(tmpDir);
    expect(workers![0].state).toBe("error");
  });

  it("skips corrupt JSON files", () => {
    const dir = path.join(tmpDir, ".gsd", "parallel");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "bad.status.json"), "not-json{{{");
    writeStatus("M001.status.json", {
      milestoneId: "M001",
      pid: 1234,
      state: "running",
      cost: 0,
      lastHeartbeat: Date.now(),
    });

    const workers = readParallelWorkers(tmpDir);
    expect(workers).toHaveLength(1);
    expect(workers![0].id).toBe("M001");
  });

  it("filters out Dropbox conflicted copies", () => {
    writeStatus("M001.status.json", {
      milestoneId: "M001",
      pid: 1234,
      state: "running",
      cost: 0,
      lastHeartbeat: Date.now(),
    });
    // Simulate Dropbox conflicted copy
    const dir = path.join(tmpDir, ".gsd", "parallel");
    fs.writeFileSync(
      path.join(dir, "M001 (Kile's conflicted copy 2026-03-19).status.json"),
      JSON.stringify({ milestoneId: "M001-conflict", state: "running", cost: 0, lastHeartbeat: Date.now() }),
    );

    const workers = readParallelWorkers(tmpDir);
    expect(workers).toHaveLength(1);
    expect(workers![0].id).toBe("M001");
  });

  it("handles null currentUnit", () => {
    writeStatus("M001.status.json", {
      milestoneId: "M001",
      pid: 1234,
      state: "stopped",
      currentUnit: null,
      cost: 0,
      lastHeartbeat: Date.now(),
    });

    const workers = readParallelWorkers(tmpDir);
    expect(workers![0].currentUnit).toBeNull();
  });

  it("falls back to filename for id when milestoneId is missing", () => {
    writeStatus("M999.status.json", {
      pid: 1234,
      state: "running",
      cost: 0,
      lastHeartbeat: Date.now(),
    });

    const workers = readParallelWorkers(tmpDir);
    expect(workers![0].id).toBe("M999");
  });

  it("handles missing numeric fields with defaults", () => {
    writeStatus("M001.status.json", {
      milestoneId: "M001",
      state: "running",
      lastHeartbeat: Date.now(),
    });

    const workers = readParallelWorkers(tmpDir);
    expect(workers![0].pid).toBe(0);
    expect(workers![0].completedUnits).toBe(0);
    expect(workers![0].cost).toBe(0);
  });

  it("returns null when only non-status files exist", () => {
    const dir = path.join(tmpDir, ".gsd", "parallel");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "readme.txt"), "not a status file");

    expect(readParallelWorkers(tmpDir)).toBeNull();
  });
});

describe("readBudgetCeiling", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-budget-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePrefs(content: string): void {
    const dir = path.join(tmpDir, ".gsd");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "preferences.md"), content);
  }

  it("returns null when preferences.md does not exist", () => {
    expect(readBudgetCeiling(tmpDir)).toBeNull();
  });

  it("parses budget_ceiling value", () => {
    writePrefs("budget_ceiling: 5.00\nother_key: value\n");
    expect(readBudgetCeiling(tmpDir)).toBe(5.0);
  });

  it("handles decimal values", () => {
    writePrefs("budget_ceiling: 0.50\n");
    expect(readBudgetCeiling(tmpDir)).toBe(0.5);
  });

  it("returns null when key not present", () => {
    writePrefs("some_other_key: 10\n");
    expect(readBudgetCeiling(tmpDir)).toBeNull();
  });

  it("returns null for non-numeric value", () => {
    writePrefs("budget_ceiling: unlimited\n");
    expect(readBudgetCeiling(tmpDir)).toBeNull();
  });

  it("returns null for zero ceiling", () => {
    writePrefs("budget_ceiling: 0\n");
    expect(readBudgetCeiling(tmpDir)).toBeNull();
  });

  it("returns null for negative ceiling", () => {
    writePrefs("budget_ceiling: -5\n");
    expect(readBudgetCeiling(tmpDir)).toBeNull();
  });
});
