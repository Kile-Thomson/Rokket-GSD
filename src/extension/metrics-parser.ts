/**
 * Metrics Parser — reads .gsd/metrics.json and provides aggregated data
 * for the dashboard. Mirrors the CLI's metrics.ts types and aggregation
 * logic but runs in the VS Code extension host.
 */

import * as fs from "fs";
import * as path from "path";

// ─── Types (matching CLI's MetricsLedger schema) ─────────────────────────────

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UnitMetrics {
  type: string;            // e.g. "research-milestone", "execute-task"
  id: string;              // e.g. "M001/S01/T01"
  model: string;           // model ID used
  startedAt: number;       // ms timestamp
  finishedAt: number;      // ms timestamp
  tokens: TokenCounts;
  cost: number;            // total USD cost
  toolCalls: number;
  assistantMessages: number;
  userMessages: number;
}

export interface MetricsLedger {
  version: 1;
  projectStartedAt: number;
  units: UnitMetrics[];
}

// ─── Phase classification ─────────────────────────────────────────────────────

export type MetricsPhase = "research" | "planning" | "execution" | "completion" | "reassessment";

export function classifyUnitPhase(unitType: string): MetricsPhase {
  switch (unitType) {
    case "research-milestone":
    case "research-slice":
      return "research";
    case "plan-milestone":
    case "plan-slice":
      return "planning";
    case "execute-task":
      return "execution";
    case "complete-slice":
      return "completion";
    case "reassess-roadmap":
      return "reassessment";
    default:
      return "execution";
  }
}

// ─── Aggregation types ────────────────────────────────────────────────────────

export interface PhaseAggregate {
  phase: MetricsPhase;
  units: number;
  tokens: TokenCounts;
  cost: number;
  duration: number;  // ms
}

export interface SliceAggregate {
  sliceId: string;
  units: number;
  tokens: TokenCounts;
  cost: number;
  duration: number;
}

export interface ModelAggregate {
  model: string;
  units: number;
  tokens: TokenCounts;
  cost: number;
}

export interface ProjectTotals {
  units: number;
  tokens: TokenCounts;
  cost: number;
  duration: number;
  toolCalls: number;
  assistantMessages: number;
  userMessages: number;
}

export interface CostProjection {
  projectedRemaining: number;
  avgCostPerSlice: number;
  remainingSlices: number;
  completedSlices: number;
}

export interface MetricsData {
  totals: ProjectTotals;
  byPhase: PhaseAggregate[];
  bySlice: SliceAggregate[];
  byModel: ModelAggregate[];
  projection: CostProjection | null;
  recentUnits: UnitMetrics[];  // last N units for activity log
  elapsedMs: number;           // total duration across all units
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyTokens(): TokenCounts {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
  };
}

// ─── Aggregation functions ────────────────────────────────────────────────────

export function aggregateByPhase(units: UnitMetrics[]): PhaseAggregate[] {
  const map = new Map<MetricsPhase, PhaseAggregate>();
  for (const u of units) {
    const phase = classifyUnitPhase(u.type);
    let agg = map.get(phase);
    if (!agg) {
      agg = { phase, units: 0, tokens: emptyTokens(), cost: 0, duration: 0 };
      map.set(phase, agg);
    }
    agg.units++;
    agg.tokens = addTokens(agg.tokens, u.tokens);
    agg.cost += u.cost;
    agg.duration += (u.finishedAt || 0) - (u.startedAt || 0);
  }
  const order: MetricsPhase[] = ["research", "planning", "execution", "completion", "reassessment"];
  return order.map(p => map.get(p)).filter((a): a is PhaseAggregate => !!a);
}

export function aggregateBySlice(units: UnitMetrics[]): SliceAggregate[] {
  const map = new Map<string, SliceAggregate>();
  for (const u of units) {
    const parts = u.id.split("/");
    const sliceId = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    let agg = map.get(sliceId);
    if (!agg) {
      agg = { sliceId, units: 0, tokens: emptyTokens(), cost: 0, duration: 0 };
      map.set(sliceId, agg);
    }
    agg.units++;
    agg.tokens = addTokens(agg.tokens, u.tokens);
    agg.cost += u.cost;
    agg.duration += (u.finishedAt || 0) - (u.startedAt || 0);
  }
  return Array.from(map.values()).sort((a, b) => a.sliceId.localeCompare(b.sliceId));
}

export function aggregateByModel(units: UnitMetrics[]): ModelAggregate[] {
  const map = new Map<string, ModelAggregate>();
  for (const u of units) {
    const model = u.model || "unknown";
    let agg = map.get(model);
    if (!agg) {
      agg = { model, units: 0, tokens: emptyTokens(), cost: 0 };
      map.set(model, agg);
    }
    agg.units++;
    agg.tokens = addTokens(agg.tokens, u.tokens);
    agg.cost += u.cost;
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

export function getProjectTotals(units: UnitMetrics[]): ProjectTotals {
  const totals: ProjectTotals = {
    units: units.length,
    tokens: emptyTokens(),
    cost: 0,
    duration: 0,
    toolCalls: 0,
    assistantMessages: 0,
    userMessages: 0,
  };
  for (const u of units) {
    totals.tokens = addTokens(totals.tokens, u.tokens);
    totals.cost += u.cost;
    totals.duration += (u.finishedAt || 0) - (u.startedAt || 0);
    totals.toolCalls += u.toolCalls || 0;
    totals.assistantMessages += u.assistantMessages || 0;
    totals.userMessages += u.userMessages || 0;
  }
  return totals;
}

export function computeProjection(
  sliceAggregates: SliceAggregate[],
  remainingSliceCount: number,
): CostProjection | null {
  // Need at least 2 completed slices for a meaningful projection
  const completed = sliceAggregates.filter(s => s.sliceId.includes("/"));
  if (completed.length < 2 || remainingSliceCount <= 0) return null;

  const totalCost = completed.reduce((sum, s) => sum + s.cost, 0);
  const avgCost = totalCost / completed.length;

  return {
    projectedRemaining: avgCost * remainingSliceCount,
    avgCostPerSlice: avgCost,
    remainingSlices: remainingSliceCount,
    completedSlices: completed.length,
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function formatCost(cost: number): string {
  const n = Number(cost) || 0;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

/**
 * Load and parse .gsd/metrics.json from a project directory.
 * Returns null if the file doesn't exist, is malformed, or has an unexpected version.
 */
export function loadMetricsLedger(cwd: string): MetricsLedger | null {
  const metricsPath = path.join(cwd, ".gsd", "metrics.json");
  try {
    const raw = fs.readFileSync(metricsPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.units)) {
      return parsed as MetricsLedger;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build full metrics data from a ledger, ready for dashboard rendering.
 * Pass remainingSliceCount for cost projection (0 if unknown).
 */
export function buildMetricsData(
  ledger: MetricsLedger,
  remainingSliceCount: number = 0,
  maxRecentUnits: number = 15,
): MetricsData {
  const units = ledger.units;
  const totals = getProjectTotals(units);
  const byPhase = aggregateByPhase(units);
  const bySlice = aggregateBySlice(units);
  const byModel = aggregateByModel(units);
  const projection = computeProjection(bySlice, remainingSliceCount);

  // Most recent units first
  const recentUnits = units.slice().reverse().slice(0, maxRecentUnits);

  return {
    totals,
    byPhase,
    bySlice,
    byModel,
    projection,
    recentUnits,
    elapsedMs: totals.duration,
  };
}
