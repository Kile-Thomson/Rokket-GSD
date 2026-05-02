// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DashboardData, DashboardSlice } from "../../shared/types";

// ── Mock dependencies ──────────────────────────────────────────────────

vi.mock("../helpers", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    escapeHtml: (s: string) => String(s ?? ""),
    scrollToBottom: vi.fn(),
  };
});

vi.mock("../state", () => ({
  state: {
    entries: [],
    currentTurn: null,
    version: "1.2.3",
    processStatus: "running",
    model: null,
    thinkingLevel: "off",
    useCtrlEnterToSend: false,
  },
}));

import { init, renderDashboard, formatTokenCount, updateWelcomeScreen, type DashboardDeps } from "../dashboard";
import { scrollToBottom } from "../helpers";
import { state } from "../state";

// ── Helpers ──────────────────────────────────────────────────────────────

function createDeps(): DashboardDeps {
  return {
    messagesContainer: document.createElement("div"),
    welcomeScreen: document.createElement("div"),
    welcomeProcess: document.createElement("div"),
    welcomeModel: document.createElement("div"),
    welcomeHints: document.createElement("div"),
  };
}

function createMinimalDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    hasProject: true,
    hasMilestone: true,
    milestone: { id: "M001", title: "Initial Setup" },
    slice: { id: "S01", title: "First Slice" },
    task: { id: "T01", title: "First Task" },
    phase: "executing",
    slices: [],
    milestoneRegistry: [],
    progress: {
      tasks: { done: 1, total: 3 },
      slices: { done: 0, total: 2 },
      milestones: { done: 0, total: 1 },
    },
    blockers: [],
    nextAction: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("formatTokenCount", () => {
  it("returns the number as-is for values below 1000", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands with 'k' suffix and one decimal", () => {
    expect(formatTokenCount(1000)).toBe("1.0k");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(999_999)).toBe("1000.0k");
  });

  it("formats millions with 'M' suffix and two decimals", () => {
    expect(formatTokenCount(1_000_000)).toBe("1.00M");
    expect(formatTokenCount(2_500_000)).toBe("2.50M");
    expect(formatTokenCount(10_000_000)).toBe("10.00M");
  });
});

describe("renderDashboard", () => {
  let deps: DashboardDeps;

  beforeEach(() => {
    deps = createDeps();
    init(deps);
    // Reset DOM
    deps.messagesContainer.innerHTML = "";
    vi.mocked(scrollToBottom).mockClear();
  });

  it("renders empty state when data is null", () => {
    renderDashboard(null);

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard");
    expect(dashboard).not.toBeNull();
    expect(dashboard!.innerHTML).toContain("No active GSD project");
    expect(dashboard!.innerHTML).toContain("/gsd");
  });

  it("renders empty state when hasProject and hasMilestone are both false", () => {
    renderDashboard({
      hasProject: false,
      hasMilestone: false,
      milestone: null,
      slice: null,
      task: null,
      phase: "unknown",
      slices: [],
      milestoneRegistry: [],
      progress: { tasks: { done: 0, total: 0 }, slices: { done: 0, total: 0 }, milestones: { done: 0, total: 0 } },
      blockers: [],
      nextAction: null,
    });

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard");
    expect(dashboard!.innerHTML).toContain("No active GSD project");
  });

  it("renders dashboard header with phase badge for active project", () => {
    renderDashboard(createMinimalDashboardData({ phase: "executing" }));

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard");
    expect(dashboard).not.toBeNull();
    expect(dashboard!.innerHTML).toContain("GSD Dashboard");
    expect(dashboard!.innerHTML).toContain("Executing");
    expect(dashboard!.querySelector(".gsd-dashboard-phase.executing")).not.toBeNull();
  });

  it("renders milestone title and breadcrumb", () => {
    renderDashboard(createMinimalDashboardData());

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard");
    expect(dashboard!.innerHTML).toContain("M001");
    expect(dashboard!.innerHTML).toContain("Initial Setup");
    // Breadcrumb: M001/S01/T01
    expect(dashboard!.innerHTML).toContain("M001/S01/T01");
  });

  it("renders progress bars for tasks, slices, and milestones", () => {
    renderDashboard(createMinimalDashboardData({
      progress: {
        tasks: { done: 2, total: 4 },
        slices: { done: 1, total: 3 },
        milestones: { done: 0, total: 2 },
      },
    }));

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard")!;
    // Check progress ratios
    expect(dashboard.innerHTML).toContain("2/4");
    expect(dashboard.innerHTML).toContain("1/3");
    expect(dashboard.innerHTML).toContain("0/2");
    // Check percentage labels
    expect(dashboard.innerHTML).toContain("50%");
    expect(dashboard.innerHTML).toContain("33%");
    expect(dashboard.innerHTML).toContain("0%");
  });

  it("renders blockers when present", () => {
    renderDashboard(createMinimalDashboardData({
      blockers: ["Missing API key", "Database down"],
    }));

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard")!;
    expect(dashboard.innerHTML).toContain("Blockers");
    expect(dashboard.innerHTML).toContain("Missing API key");
    expect(dashboard.innerHTML).toContain("Database down");
  });

  it("renders next action when present", () => {
    renderDashboard(createMinimalDashboardData({
      nextAction: "Run integration tests",
    }));

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard")!;
    expect(dashboard.innerHTML).toContain("Next");
    expect(dashboard.innerHTML).toContain("Run integration tests");
  });

  it("renders slices list with active/done/pending states", () => {
    const slices: DashboardSlice[] = [
      { id: "S01", title: "Done Slice", done: true, active: false, risk: "low", tasks: [] },
      { id: "S02", title: "Active Slice", done: false, active: true, risk: "medium", tasks: [
        { id: "T01", title: "Active Task", done: false, active: true },
        { id: "T02", title: "Pending Task", done: false, active: false },
      ]},
      { id: "S03", title: "Pending Slice", done: false, active: false, risk: "high", tasks: [] },
    ];

    renderDashboard(createMinimalDashboardData({ slices }));

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard")!;
    expect(dashboard.querySelector(".gsd-dash-slice.done")).not.toBeNull();
    expect(dashboard.querySelector(".gsd-dash-slice.active")).not.toBeNull();
    expect(dashboard.querySelector(".gsd-dash-slice.pending")).not.toBeNull();
    // Active slice shows nested tasks
    expect(dashboard.innerHTML).toContain("Active Task");
    expect(dashboard.innerHTML).toContain("Pending Task");
  });

  it("renders cost section when stats are provided", () => {
    renderDashboard(createMinimalDashboardData({
      stats: {
        cost: 0.1234,
        tokens: { input: 5000, output: 2000, cacheRead: 1000, cacheWrite: 500, total: 8500 },
        toolCalls: 15,
        userMessages: 3,
      },
    }));

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard")!;
    // escapeHtml mock is identity so HTML entities are in output
    expect(dashboard.innerHTML).toContain("Cost");
    expect(dashboard.innerHTML).toContain("Usage");
    expect(dashboard.innerHTML).toContain("$0.1234");
    expect(dashboard.innerHTML).toContain("8.5k tokens");
    expect(dashboard.innerHTML).toContain("15 tools");
    expect(dashboard.innerHTML).toContain("3 turns");
  });

  it("replaces existing dashboard on re-render", () => {
    // Attach to document so querySelector(".gsd-dashboard") works
    document.body.appendChild(deps.messagesContainer);
    renderDashboard(createMinimalDashboardData());
    renderDashboard(createMinimalDashboardData());

    const dashboards = deps.messagesContainer.querySelectorAll(".gsd-dashboard");
    expect(dashboards.length).toBe(1);
    document.body.removeChild(deps.messagesContainer);
  });

  it("calls scrollToBottom after rendering", () => {
    renderDashboard(createMinimalDashboardData());
    expect(scrollToBottom).toHaveBeenCalledWith(deps.messagesContainer, true);
  });

  it("hides welcome screen when rendering dashboard", () => {
    deps.welcomeScreen.classList.remove("gsd-hidden");
    renderDashboard(createMinimalDashboardData());
    expect(deps.welcomeScreen.classList.contains("gsd-hidden")).toBe(true);
  });

  it("renders 'complete' phase class correctly", () => {
    renderDashboard(createMinimalDashboardData({ phase: "complete" }));
    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard")!;
    expect(dashboard.querySelector(".gsd-dashboard-phase.complete")).not.toBeNull();
    expect(dashboard.innerHTML).toContain("Complete");
  });

  it("renders milestone registry entries", () => {
    renderDashboard(createMinimalDashboardData({
      milestoneRegistry: [
        { id: "M001", title: "First", done: true, active: false },
        { id: "M002", title: "Second", done: false, active: true },
      ],
    }));

    const dashboard = deps.messagesContainer.querySelector(".gsd-dashboard")!;
    expect(dashboard.innerHTML).toContain("Milestones");
    expect(dashboard.querySelector(".gsd-dash-milestone.done")).not.toBeNull();
    expect(dashboard.querySelector(".gsd-dash-milestone.active")).not.toBeNull();
  });
});

describe("updateWelcomeScreen", () => {
  let deps: DashboardDeps;

  beforeEach(() => {
    deps = createDeps();
    init(deps);
    // Reset the mocked state
    state.entries = [];
    (state as any).currentTurn = null;
    (state as any).processStatus = "running";
    (state as any).version = "1.2.3";
    (state as any).model = null;
    (state as any).thinkingLevel = "off";
    (state as any).useCtrlEnterToSend = false;
  });

  it("hides welcome screen when conversation entries exist", () => {
    (state as any).entries = [{ type: "user", text: "hello" }];
    deps.welcomeScreen.classList.remove("gsd-hidden");

    updateWelcomeScreen();
    expect(deps.welcomeScreen.classList.contains("gsd-hidden")).toBe(true);
  });

  it("shows welcome screen with version and process status", () => {
    (state as any).entries = [];
    (state as any).processStatus = "running";

    updateWelcomeScreen();
    expect(deps.welcomeScreen.classList.contains("gsd-hidden")).toBe(false);
    expect(deps.welcomeProcess.textContent).toBe("Type a message to start");
  });

  it("shows 'Starting GSD…' when status is starting", () => {
    (state as any).entries = [];
    (state as any).processStatus = "starting";

    updateWelcomeScreen();
    expect(deps.welcomeProcess.textContent).toContain("Starting GSD");
  });
});
