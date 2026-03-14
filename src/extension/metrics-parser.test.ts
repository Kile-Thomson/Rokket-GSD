import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  classifyUnitPhase,
  aggregateByPhase,
  aggregateBySlice,
  aggregateByModel,
  getProjectTotals,
  computeProjection,
  buildMetricsData,
  loadMetricsLedger,
  formatCost,
  formatDuration,
  type UnitMetrics,
  type MetricsLedger,
} from "./metrics-parser";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeUnit(overrides: Partial<UnitMetrics> = {}): UnitMetrics {
  return {
    type: "execute-task",
    id: "M001/S01/T01",
    model: "claude-sonnet-4-6",
    startedAt: 1000,
    finishedAt: 61000, // 60s
    tokens: { input: 5000, output: 2000, cacheRead: 1000, cacheWrite: 500, total: 8500 },
    cost: 0.05,
    toolCalls: 10,
    assistantMessages: 3,
    userMessages: 1,
    ...overrides,
  };
}

const sampleLedger: MetricsLedger = {
  version: 1,
  projectStartedAt: 1000,
  units: [
    makeUnit({ type: "research-milestone", id: "M001", model: "claude-sonnet-4-6", cost: 0.02 }),
    makeUnit({ type: "plan-milestone", id: "M001", model: "claude-opus-4-6", cost: 0.10 }),
    makeUnit({ type: "research-slice", id: "M001/S01", model: "claude-sonnet-4-6", cost: 0.03 }),
    makeUnit({ type: "plan-slice", id: "M001/S01", model: "claude-opus-4-6", cost: 0.08 }),
    makeUnit({ type: "execute-task", id: "M001/S01/T01", model: "claude-sonnet-4-6", cost: 0.05 }),
    makeUnit({ type: "execute-task", id: "M001/S01/T02", model: "claude-sonnet-4-6", cost: 0.04 }),
    makeUnit({ type: "complete-slice", id: "M001/S01", model: "claude-sonnet-4-6", cost: 0.02 }),
    makeUnit({ type: "reassess-roadmap", id: "M001", model: "claude-sonnet-4-6", cost: 0.01 }),
    makeUnit({ type: "execute-task", id: "M001/S02/T01", model: "claude-sonnet-4-6", cost: 0.06 }),
    makeUnit({ type: "complete-slice", id: "M001/S02", model: "claude-sonnet-4-6", cost: 0.02 }),
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("classifyUnitPhase", () => {
  it("classifies research types", () => {
    expect(classifyUnitPhase("research-milestone")).toBe("research");
    expect(classifyUnitPhase("research-slice")).toBe("research");
  });

  it("classifies planning types", () => {
    expect(classifyUnitPhase("plan-milestone")).toBe("planning");
    expect(classifyUnitPhase("plan-slice")).toBe("planning");
  });

  it("classifies execution types", () => {
    expect(classifyUnitPhase("execute-task")).toBe("execution");
  });

  it("classifies completion", () => {
    expect(classifyUnitPhase("complete-slice")).toBe("completion");
  });

  it("classifies reassessment", () => {
    expect(classifyUnitPhase("reassess-roadmap")).toBe("reassessment");
  });

  it("defaults unknown types to execution", () => {
    expect(classifyUnitPhase("some-unknown")).toBe("execution");
  });
});

describe("aggregateByPhase", () => {
  it("groups units by phase in stable order", () => {
    const result = aggregateByPhase(sampleLedger.units);
    const phases = result.map(r => r.phase);
    expect(phases).toEqual(["research", "planning", "execution", "completion", "reassessment"]);
  });

  it("counts units per phase correctly", () => {
    const result = aggregateByPhase(sampleLedger.units);
    const map = new Map(result.map(r => [r.phase, r]));
    expect(map.get("research")!.units).toBe(2);
    expect(map.get("planning")!.units).toBe(2);
    expect(map.get("execution")!.units).toBe(3);
    expect(map.get("completion")!.units).toBe(2);
    expect(map.get("reassessment")!.units).toBe(1);
  });

  it("sums costs per phase", () => {
    const result = aggregateByPhase(sampleLedger.units);
    const map = new Map(result.map(r => [r.phase, r]));
    expect(map.get("research")!.cost).toBeCloseTo(0.05);
    expect(map.get("planning")!.cost).toBeCloseTo(0.18);
    expect(map.get("execution")!.cost).toBeCloseTo(0.15);
  });

  it("returns empty array for empty units", () => {
    expect(aggregateByPhase([])).toEqual([]);
  });
});

describe("aggregateBySlice", () => {
  it("groups by slice ID (M001/S01, M001/S02, etc.)", () => {
    const result = aggregateBySlice(sampleLedger.units);
    const ids = result.map(r => r.sliceId);
    expect(ids).toContain("M001/S01");
    expect(ids).toContain("M001/S02");
  });

  it("groups milestone-level entries under bare ID", () => {
    const result = aggregateBySlice(sampleLedger.units);
    const ids = result.map(r => r.sliceId);
    expect(ids).toContain("M001");
  });

  it("returns sorted by sliceId", () => {
    const result = aggregateBySlice(sampleLedger.units);
    const ids = result.map(r => r.sliceId);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("aggregateByModel", () => {
  it("groups by model", () => {
    const result = aggregateByModel(sampleLedger.units);
    const models = result.map(r => r.model);
    expect(models).toContain("claude-sonnet-4-6");
    expect(models).toContain("claude-opus-4-6");
  });

  it("sorts by cost descending", () => {
    const result = aggregateByModel(sampleLedger.units);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].cost).toBeGreaterThanOrEqual(result[i].cost);
    }
  });
});

describe("getProjectTotals", () => {
  it("sums all fields", () => {
    const totals = getProjectTotals(sampleLedger.units);
    expect(totals.units).toBe(10);
    expect(totals.cost).toBeCloseTo(0.43);
    expect(totals.tokens.input).toBe(50000);
    expect(totals.toolCalls).toBe(100);
  });

  it("handles empty units", () => {
    const totals = getProjectTotals([]);
    expect(totals.units).toBe(0);
    expect(totals.cost).toBe(0);
    expect(totals.tokens.total).toBe(0);
  });
});

describe("computeProjection", () => {
  it("returns null with fewer than 2 completed slices", () => {
    const slices = aggregateBySlice([makeUnit({ id: "M001/S01/T01" })]);
    expect(computeProjection(slices, 3)).toBeNull();
  });

  it("returns null with 0 remaining slices", () => {
    const slices = aggregateBySlice(sampleLedger.units);
    expect(computeProjection(slices, 0)).toBeNull();
  });

  it("computes projection from completed slices", () => {
    const slices = aggregateBySlice(sampleLedger.units);
    const proj = computeProjection(slices, 3);
    expect(proj).not.toBeNull();
    expect(proj!.completedSlices).toBe(2); // M001/S01 and M001/S02
    expect(proj!.remainingSlices).toBe(3);
    expect(proj!.avgCostPerSlice).toBeGreaterThan(0);
    expect(proj!.projectedRemaining).toBeCloseTo(proj!.avgCostPerSlice * 3);
  });
});

describe("formatCost", () => {
  it("formats tiny costs with 4 decimals", () => {
    expect(formatCost(0.001)).toBe("$0.0010");
  });

  it("formats sub-dollar costs with 3 decimals", () => {
    expect(formatCost(0.25)).toBe("$0.250");
  });

  it("formats dollar+ costs with 2 decimals", () => {
    expect(formatCost(5.5)).toBe("$5.50");
  });

  it("handles zero", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });
});

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(45000)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3725000)).toBe("1h 2m");
  });
});

describe("loadMetricsLedger", () => {
  let tmpDir: string;
  let gsdDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-metrics-test-"));
    gsdDir = path.join(tmpDir, ".gsd");
    fs.mkdirSync(gsdDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it("returns null when file doesn't exist", () => {
    expect(loadMetricsLedger(path.join(tmpDir, "nonexistent"))).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    fs.writeFileSync(path.join(gsdDir, "metrics.json"), "not json{{{", "utf-8");
    expect(loadMetricsLedger(tmpDir)).toBeNull();
  });

  it("returns null for wrong version", () => {
    fs.writeFileSync(path.join(gsdDir, "metrics.json"), JSON.stringify({ version: 99, units: [] }), "utf-8");
    expect(loadMetricsLedger(tmpDir)).toBeNull();
  });

  it("returns null when units is not an array", () => {
    fs.writeFileSync(path.join(gsdDir, "metrics.json"), JSON.stringify({ version: 1, units: "bad" }), "utf-8");
    expect(loadMetricsLedger(tmpDir)).toBeNull();
  });

  it("parses valid ledger", () => {
    fs.writeFileSync(path.join(gsdDir, "metrics.json"), JSON.stringify(sampleLedger), "utf-8");
    const result = loadMetricsLedger(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.units.length).toBe(10);
    expect(result!.version).toBe(1);
  });
});

describe("buildMetricsData", () => {
  it("builds complete metrics data", () => {
    const data = buildMetricsData(sampleLedger, 3);
    expect(data.totals.units).toBe(10);
    expect(data.byPhase.length).toBeGreaterThan(0);
    expect(data.bySlice.length).toBeGreaterThan(0);
    expect(data.byModel.length).toBeGreaterThan(0);
    expect(data.projection).not.toBeNull();
    expect(data.recentUnits.length).toBeLessThanOrEqual(15);
    expect(data.elapsedMs).toBeGreaterThan(0);
  });

  it("returns recent units in reverse chronological order", () => {
    const data = buildMetricsData(sampleLedger);
    // Last unit in the ledger should be first in recentUnits
    expect(data.recentUnits[0].id).toBe("M001/S02");
  });

  it("handles empty ledger", () => {
    const empty: MetricsLedger = { version: 1, projectStartedAt: 0, units: [] };
    const data = buildMetricsData(empty);
    expect(data.totals.units).toBe(0);
    expect(data.byPhase).toEqual([]);
    expect(data.projection).toBeNull();
  });
});
