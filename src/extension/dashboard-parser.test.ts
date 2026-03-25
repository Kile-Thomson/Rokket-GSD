import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock vscode (state-parser imports it indirectly)
vi.mock("vscode", () => ({}));

// Mock state-parser to control workflow state
vi.mock("./state-parser", () => ({
  parseGsdWorkflowState: vi.fn(),
}));

import { buildDashboardData } from "./dashboard-parser";
import { parseGsdWorkflowState } from "./state-parser";

const mockParseWorkflow = vi.mocked(parseGsdWorkflowState);

describe("dashboard-parser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-dashboard-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when .gsd/ directory does not exist", async () => {
    mockParseWorkflow.mockResolvedValue(null);
    const result = await buildDashboardData(tmpDir);
    expect(result).toBeNull();
  });

  it("returns project-level data when no active milestone", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(
      path.join(gsdDir, "STATE.md"),
      `## Milestone Registry

- ✅ **M001:** First milestone
- ⬜ **M002:** Second milestone

## Blockers

None

## Next Action

Plan M002
`
    );
    mockParseWorkflow.mockResolvedValue(null);

    const result = await buildDashboardData(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.hasProject).toBe(true);
    expect(result!.hasMilestone).toBe(false);
    expect(result!.milestone).toBeNull();
    expect(result!.milestoneRegistry).toHaveLength(2);
    expect(result!.milestoneRegistry[0]).toMatchObject({ id: "M001", title: "First milestone", done: true });
    expect(result!.milestoneRegistry[1]).toMatchObject({ id: "M002", title: "Second milestone", done: false });
  });

  it("parses blockers from STATE.md", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(
      path.join(gsdDir, "STATE.md"),
      `## Blockers

- Waiting for API key
- Need design review

## Next Action

Fix blockers
`
    );
    mockParseWorkflow.mockResolvedValue(null);

    const result = await buildDashboardData(tmpDir);

    expect(result!.blockers).toEqual(["Waiting for API key", "Need design review"]);
  });

  it("parses next-action from STATE.md", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(
      path.join(gsdDir, "STATE.md"),
      `## Next Action

Execute T03 for S02
`
    );
    mockParseWorkflow.mockResolvedValue(null);

    const result = await buildDashboardData(tmpDir);

    expect(result!.nextAction).toBe("Execute T03 for S02");
  });

  it("handles empty STATE.md", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, "STATE.md"), "");
    mockParseWorkflow.mockResolvedValue(null);

    const result = await buildDashboardData(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.milestoneRegistry).toEqual([]);
    expect(result!.blockers).toEqual([]);
    expect(result!.nextAction).toBeNull();
  });

  it("handles missing STATE.md gracefully", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    fs.mkdirSync(gsdDir, { recursive: true });
    // No STATE.md written
    mockParseWorkflow.mockResolvedValue(null);

    const result = await buildDashboardData(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.milestoneRegistry).toEqual([]);
    expect(result!.blockers).toEqual([]);
  });

  it("parses roadmap slices when active milestone exists", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    const milestoneDir = path.join(gsdDir, "milestones", "M001");
    fs.mkdirSync(milestoneDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, "STATE.md"), "");
    fs.writeFileSync(
      path.join(milestoneDir, "M001-ROADMAP.md"),
      `# Roadmap

- [x] **S01: Setup project** \`risk:low\`
- [ ] **S02: Build feature** \`risk:high\`
- [ ] **S03: Polish UI**
`
    );

    mockParseWorkflow.mockResolvedValue({
      milestone: { id: "M001", title: "First" },
      slice: { id: "S02", title: "Build feature" },
      task: null,
      phase: "build",
      autoMode: null,
    });

    const result = await buildDashboardData(tmpDir);

    expect(result!.hasMilestone).toBe(true);
    expect(result!.slices).toHaveLength(3);
    expect(result!.slices[0]).toMatchObject({ id: "S01", done: true, risk: "low" });
    expect(result!.slices[1]).toMatchObject({ id: "S02", done: false, risk: "high", active: true });
    expect(result!.slices[2]).toMatchObject({ id: "S03", done: false, risk: "low", active: false });
  });

  it("parses plan tasks for active slice", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    const milestoneDir = path.join(gsdDir, "milestones", "M001");
    const sliceDir = path.join(milestoneDir, "slices", "S01");
    fs.mkdirSync(sliceDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, "STATE.md"), "");
    fs.writeFileSync(
      path.join(milestoneDir, "M001-ROADMAP.md"),
      `- [x] **S01: Do things** \`risk:low\`\n`
    );
    fs.writeFileSync(
      path.join(sliceDir, "S01-PLAN.md"),
      `# Plan

- [x] **T01: First task** \`est:30m\`
- [ ] **T02: Second task** \`est:1h\`
`
    );

    mockParseWorkflow.mockResolvedValue({
      milestone: { id: "M001", title: "First" },
      slice: { id: "S01", title: "Do things" },
      task: { id: "T01", title: "First task" },
      phase: "build",
      autoMode: null,
    });

    const result = await buildDashboardData(tmpDir);

    const activeSlice = result!.slices.find(s => s.active);
    expect(activeSlice).toBeDefined();
    expect(activeSlice!.tasks).toHaveLength(2);
    expect(activeSlice!.tasks[0]).toMatchObject({ id: "T01", title: "First task", done: true, estimate: "30m" });
    expect(activeSlice!.tasks[1]).toMatchObject({ id: "T02", title: "Second task", done: false, estimate: "1h" });
    expect(activeSlice!.taskProgress).toEqual({ done: 1, total: 2 });
  });

  it("marks active milestone in registry", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    const milestoneDir = path.join(gsdDir, "milestones", "M002");
    fs.mkdirSync(milestoneDir, { recursive: true });
    fs.writeFileSync(
      path.join(gsdDir, "STATE.md"),
      `## Milestone Registry

- ✅ **M001:** Done milestone
- ⬜ **M002:** Active milestone
`
    );

    mockParseWorkflow.mockResolvedValue({
      milestone: { id: "M002", title: "Active milestone" },
      slice: null,
      task: null,
      phase: "plan",
      autoMode: null,
    });

    const result = await buildDashboardData(tmpDir);

    expect(result!.milestoneRegistry[0]).toMatchObject({ id: "M001", active: false });
    expect(result!.milestoneRegistry[1]).toMatchObject({ id: "M002", active: true });
  });

  it("computes progress correctly", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    const milestoneDir = path.join(gsdDir, "milestones", "M001");
    fs.mkdirSync(milestoneDir, { recursive: true });
    fs.writeFileSync(
      path.join(gsdDir, "STATE.md"),
      `## Milestone Registry

- ✅ **M001:** Done
- ⬜ **M002:** Active
`
    );
    fs.writeFileSync(
      path.join(milestoneDir, "M001-ROADMAP.md"),
      `- [x] **S01: Done** \`risk:low\`
- [ ] **S02: Active** \`risk:low\`
- [ ] **S03: Todo** \`risk:low\`
`
    );

    mockParseWorkflow.mockResolvedValue({
      milestone: { id: "M001", title: "Done" },
      slice: null,
      task: null,
      phase: "build",
      autoMode: null,
    });

    const result = await buildDashboardData(tmpDir);

    expect(result!.progress.slices).toEqual({ done: 1, total: 3 });
    expect(result!.progress.milestones).toEqual({ done: 1, total: 2 });
  });

  // ── gsd-pi 2.44 compatibility ──────────────────────────────────

  it("parses 2.44 milestone registry with all four glyphs", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(
      path.join(gsdDir, "STATE.md"),
      `## Milestone Registry

- ✅ **M001:** Completed milestone
- 🔄 **M002:** Active milestone
- ⏸️ **M003:** Parked milestone
- ⬜ **M004:** Pending milestone
`
    );
    mockParseWorkflow.mockResolvedValue(null);

    const result = await buildDashboardData(tmpDir);

    expect(result!.milestoneRegistry).toHaveLength(4);
    expect(result!.milestoneRegistry[0]).toMatchObject({ id: "M001", done: true, active: false });
    expect(result!.milestoneRegistry[1]).toMatchObject({ id: "M002", done: false, active: true });
    expect(result!.milestoneRegistry[2]).toMatchObject({ id: "M003", done: false, active: false });
    expect(result!.milestoneRegistry[3]).toMatchObject({ id: "M004", done: false, active: false });
  });

  it("active glyph is overridden by workflow state when available", async () => {
    const gsdDir = path.join(tmpDir, ".gsd");
    const milestoneDir = path.join(gsdDir, "milestones", "M003");
    fs.mkdirSync(milestoneDir, { recursive: true });
    fs.writeFileSync(
      path.join(gsdDir, "STATE.md"),
      `## Milestone Registry

- ✅ **M001:** Done
- 🔄 **M002:** Glyph says active
- ⬜ **M003:** Glyph says pending
`
    );

    // Workflow state says M003 is the real active milestone
    mockParseWorkflow.mockResolvedValue({
      milestone: { id: "M003", title: "Glyph says pending" },
      slice: null,
      task: null,
      phase: "plan",
      autoMode: null,
    });

    const result = await buildDashboardData(tmpDir);

    // Workflow state override takes precedence
    expect(result!.milestoneRegistry[1]).toMatchObject({ id: "M002", active: false });
    expect(result!.milestoneRegistry[2]).toMatchObject({ id: "M003", active: true });
  });
});
