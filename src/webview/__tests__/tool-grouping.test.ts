// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  isGroupableTool,
  groupConsecutiveTools,
  buildGroupSummaryLabel,
  shouldCollapseWithPredecessor,
  collapseToolIntoGroup,

} from "../tool-grouping";
import type { TurnSegment, ToolCallState } from "../state";

// ============================================================
// Helpers
// ============================================================

function makeTc(id: string, name: string, opts?: Partial<ToolCallState>): ToolCallState {
  return {
    id,
    name,
    args: {},
    resultText: "ok",
    isError: false,
    isRunning: false,
    startTime: 0,
    ...opts,
  };
}

function toolSeg(id: string): TurnSegment {
  return { type: "tool", toolCallId: id };
}

function textSeg(text = "hello"): TurnSegment {
  return { type: "text", chunks: [text] };
}

function thinkingSeg(text = "hmm"): TurnSegment {
  return { type: "thinking", chunks: [text] };
}

// ============================================================
// isGroupableTool
// ============================================================

describe("isGroupableTool", () => {
  it("returns true for read-only tools", () => {
    expect(isGroupableTool("Read")).toBe(true);
    expect(isGroupableTool("search-the-web")).toBe(true);
    expect(isGroupableTool("search_and_read")).toBe(true);
    expect(isGroupableTool("fetch_page")).toBe(true);
    expect(isGroupableTool("google_search")).toBe(true);
    expect(isGroupableTool("resolve_library")).toBe(true);
    expect(isGroupableTool("get_library_docs")).toBe(true);
    expect(isGroupableTool("browser_find")).toBe(true);
    expect(isGroupableTool("browser_screenshot")).toBe(true);
    expect(isGroupableTool("mac_find")).toBe(true);
    expect(isGroupableTool("mac_get_tree")).toBe(true);
    expect(isGroupableTool("mac_read")).toBe(true);
    expect(isGroupableTool("mac_screenshot")).toBe(true);
  });

  it("returns true for browser_get_* prefix tools", () => {
    expect(isGroupableTool("browser_get_accessibility_tree")).toBe(true);
    expect(isGroupableTool("browser_get_console_logs")).toBe(true);
    expect(isGroupableTool("browser_get_page_source")).toBe(true);
  });

  it("returns true for mac_list_* prefix tools", () => {
    expect(isGroupableTool("mac_list_apps")).toBe(true);
    expect(isGroupableTool("mac_list_windows")).toBe(true);
  });

  it("returns false for mutating tools", () => {
    expect(isGroupableTool("Write")).toBe(false);
    expect(isGroupableTool("Edit")).toBe(false);
    expect(isGroupableTool("Bash")).toBe(false);
    expect(isGroupableTool("browser_click")).toBe(false);
    expect(isGroupableTool("browser_type")).toBe(false);
    expect(isGroupableTool("mac_click")).toBe(false);
    expect(isGroupableTool("subagent")).toBe(false);
    expect(isGroupableTool("bg_shell")).toBe(false);
  });

  it("handles github_issues with read-only actions", () => {
    expect(isGroupableTool("github_issues", { action: "list" })).toBe(true);
    expect(isGroupableTool("github_issues", { action: "view" })).toBe(true);
    expect(isGroupableTool("github_issues", { action: "create" })).toBe(false);
    expect(isGroupableTool("github_issues", { action: "close" })).toBe(false);
    expect(isGroupableTool("github_issues")).toBe(false);
  });

  it("handles github_prs with read-only actions", () => {
    expect(isGroupableTool("github_prs", { action: "diff" })).toBe(true);
    expect(isGroupableTool("github_prs", { action: "files" })).toBe(true);
    expect(isGroupableTool("github_prs", { action: "checks" })).toBe(true);
    expect(isGroupableTool("github_prs", { action: "create" })).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isGroupableTool("READ")).toBe(true);
    expect(isGroupableTool("Browser_Find")).toBe(true);
  });
});

// ============================================================
// groupConsecutiveTools
// ============================================================

describe("groupConsecutiveTools", () => {
  it("groups 3 consecutive Read calls", () => {
    const tc1 = makeTc("t1", "Read");
    const tc2 = makeTc("t2", "Read");
    const tc3 = makeTc("t3", "Read");
    const toolCalls = new Map([["t1", tc1], ["t2", tc2], ["t3", tc3]]);
    const segments: TurnSegment[] = [toolSeg("t1"), toolSeg("t2"), toolSeg("t3")];

    const result = groupConsecutiveTools(segments, toolCalls);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("group");
    if (result[0].type === "group") {
      expect(result[0].segments).toHaveLength(3);
      expect(result[0].toolNames).toEqual(["Read", "Read", "Read"]);
    }
  });

  it("error tool breaks a group", () => {
    const tc1 = makeTc("t1", "Read");
    const tc2 = makeTc("t2", "Read", { isError: true });
    const tc3 = makeTc("t3", "Read");
    const toolCalls = new Map([["t1", tc1], ["t2", tc2], ["t3", tc3]]);
    const segments: TurnSegment[] = [toolSeg("t1"), toolSeg("t2"), toolSeg("t3")];

    const result = groupConsecutiveTools(segments, toolCalls);

    // t1 alone (single), t2 error (single), t3 alone (single)
    expect(result).toHaveLength(3);
    expect(result.every(r => r.type === "single")).toBe(true);
  });

  it("text between tools breaks group", () => {
    const tc1 = makeTc("t1", "Read");
    const tc2 = makeTc("t2", "Read");
    const toolCalls = new Map([["t1", tc1], ["t2", tc2]]);
    const segments: TurnSegment[] = [toolSeg("t1"), textSeg(), toolSeg("t2")];

    const result = groupConsecutiveTools(segments, toolCalls);

    expect(result).toHaveLength(3);
    expect(result.every(r => r.type === "single")).toBe(true);
  });

  it("single tool gets no wrapper", () => {
    const tc1 = makeTc("t1", "Read");
    const toolCalls = new Map([["t1", tc1]]);
    const segments: TurnSegment[] = [toolSeg("t1")];

    const result = groupConsecutiveTools(segments, toolCalls);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("single");
  });

  it("mixed groupable/non-groupable", () => {
    const tc1 = makeTc("t1", "Read");
    const tc2 = makeTc("t2", "Read");
    const tc3 = makeTc("t3", "Edit"); // non-groupable
    const tc4 = makeTc("t4", "Read");
    const tc5 = makeTc("t5", "fetch_page");
    const toolCalls = new Map([["t1", tc1], ["t2", tc2], ["t3", tc3], ["t4", tc4], ["t5", tc5]]);
    const segments: TurnSegment[] = [
      toolSeg("t1"), toolSeg("t2"), toolSeg("t3"), toolSeg("t4"), toolSeg("t5"),
    ];

    const result = groupConsecutiveTools(segments, toolCalls);

    // group(t1,t2), single(t3-Edit), group(t4,t5)
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("group");
    expect(result[1].type).toBe("single");
    expect(result[2].type).toBe("group");
  });

  it("handles empty segments", () => {
    const result = groupConsecutiveTools([], new Map());
    expect(result).toHaveLength(0);
  });

  it("running tool is not grouped", () => {
    const tc1 = makeTc("t1", "Read");
    const tc2 = makeTc("t2", "Read", { isRunning: true });
    const tc3 = makeTc("t3", "Read");
    const toolCalls = new Map([["t1", tc1], ["t2", tc2], ["t3", tc3]]);
    const segments: TurnSegment[] = [toolSeg("t1"), toolSeg("t2"), toolSeg("t3")];

    const result = groupConsecutiveTools(segments, toolCalls);

    // t1 alone, t2 running (breaks), t3 alone
    expect(result).toHaveLength(3);
    expect(result.every(r => r.type === "single")).toBe(true);
  });

  it("preserves non-tool segments in order", () => {
    const tc1 = makeTc("t1", "Read");
    const tc2 = makeTc("t2", "Read");
    const toolCalls = new Map([["t1", tc1], ["t2", tc2]]);
    const segments: TurnSegment[] = [
      thinkingSeg(), toolSeg("t1"), toolSeg("t2"), textSeg(),
    ];

    const result = groupConsecutiveTools(segments, toolCalls);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("single");
    expect((result[0] as any).segment.type).toBe("thinking");
    expect(result[1].type).toBe("group");
    expect(result[2].type).toBe("single");
    expect((result[2] as any).segment.type).toBe("text");
  });
});

// ============================================================
// buildGroupSummaryLabel
// ============================================================

describe("buildGroupSummaryLabel", () => {
  it("labels homogeneous Read group", () => {
    expect(buildGroupSummaryLabel(["Read", "Read", "Read"])).toBe("Read 3 files");
  });

  it("labels single Read", () => {
    expect(buildGroupSummaryLabel(["Read"])).toBe("Read 1 file");
  });

  it("labels mixed tools", () => {
    const label = buildGroupSummaryLabel(["Read", "Read", "fetch_page"]);
    expect(label).toBe("Read 2 files, 1 page fetch");
  });

  it("labels search tools", () => {
    expect(buildGroupSummaryLabel(["search-the-web", "search-the-web"])).toBe("2 searches");
  });
});

// ============================================================
// shouldCollapseWithPredecessor
// ============================================================

describe("shouldCollapseWithPredecessor", () => {
  it("returns true when both tools are complete groupable", () => {
    const tc = makeTc("t2", "Read");
    const predEl = document.createElement("div");
    predEl.className = "gsd-tool-segment";
    predEl.dataset.toolId = "t1";
    const toolCalls = new Map([
      ["t1", makeTc("t1", "Read")],
      ["t2", tc],
    ]);
    expect(shouldCollapseWithPredecessor(tc, predEl, toolCalls)).toBe(true);
  });

  it("returns false when current tool is an error", () => {
    const tc = makeTc("t2", "Read", { isError: true });
    const predEl = document.createElement("div");
    predEl.className = "gsd-tool-segment";
    predEl.dataset.toolId = "t1";
    const toolCalls = new Map([
      ["t1", makeTc("t1", "Read")],
      ["t2", tc],
    ]);
    expect(shouldCollapseWithPredecessor(tc, predEl, toolCalls)).toBe(false);
  });

  it("returns false when predecessor is non-groupable", () => {
    const tc = makeTc("t2", "Read");
    const predEl = document.createElement("div");
    predEl.className = "gsd-tool-segment";
    predEl.dataset.toolId = "t1";
    const toolCalls = new Map([
      ["t1", makeTc("t1", "Edit")],
      ["t2", tc],
    ]);
    expect(shouldCollapseWithPredecessor(tc, predEl, toolCalls)).toBe(false);
  });

  it("returns true when predecessor is an existing group", () => {
    const tc = makeTc("t3", "Read");
    const groupEl = document.createElement("details");
    groupEl.className = "gsd-tool-group";
    const toolCalls = new Map([["t3", tc]]);
    expect(shouldCollapseWithPredecessor(tc, groupEl, toolCalls)).toBe(true);
  });

  it("returns false when current tool is still running", () => {
    const tc = makeTc("t2", "Read", { isRunning: true });
    const predEl = document.createElement("div");
    predEl.className = "gsd-tool-segment";
    predEl.dataset.toolId = "t1";
    const toolCalls = new Map([
      ["t1", makeTc("t1", "Read")],
      ["t2", tc],
    ]);
    expect(shouldCollapseWithPredecessor(tc, predEl, toolCalls)).toBe(false);
  });

  it("returns false when predecessor is not a tool or group", () => {
    const tc = makeTc("t1", "Read");
    const predEl = document.createElement("div");
    predEl.className = "gsd-assistant-text";
    const toolCalls = new Map([["t1", tc]]);
    expect(shouldCollapseWithPredecessor(tc, predEl, toolCalls)).toBe(false);
  });
});

// ============================================================
// collapseToolIntoGroup (DOM manipulation)
// ============================================================

describe("collapseToolIntoGroup", () => {
  function makeToolEl(id: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "gsd-tool-segment";
    el.dataset.toolId = id;
    el.innerHTML = `<div class="gsd-tool-block" data-tool-id="${id}"><span>${id}</span></div>`;
    return el;
  }

  it("creates a new group from two standalone tools", () => {
    const container = document.createElement("div");
    const el1 = makeToolEl("t1");
    const el2 = makeToolEl("t2");
    container.appendChild(el1);
    container.appendChild(el2);

    const toolCalls = new Map([
      ["t1", makeTc("t1", "Read")],
      ["t2", makeTc("t2", "Read")],
    ]);

    const group = collapseToolIntoGroup(el2, el1, toolCalls);

    expect(group.classList.contains("gsd-tool-group")).toBe(true);
    expect(group.dataset.toolGroup).toBe("2");
    expect(container.children).toHaveLength(1); // only the group
    expect(group.querySelectorAll(".gsd-tool-segment")).toHaveLength(2);
    expect(group.querySelector(".gsd-tool-group-label")!.textContent).toBe("Read 2 files");
  });

  it("expands an existing group with a third tool", () => {
    const container = document.createElement("div");
    const el1 = makeToolEl("t1");
    const el2 = makeToolEl("t2");

    const toolCalls = new Map([
      ["t1", makeTc("t1", "Read")],
      ["t2", makeTc("t2", "Read")],
      ["t3", makeTc("t3", "Read")],
    ]);

    // First collapse creates the group
    container.appendChild(el1);
    container.appendChild(el2);
    const group = collapseToolIntoGroup(el2, el1, toolCalls);

    // Third tool arrives
    const el3 = makeToolEl("t3");
    container.appendChild(el3);
    const expandedGroup = collapseToolIntoGroup(el3, group, toolCalls);

    expect(expandedGroup).toBe(group); // same element
    expect(expandedGroup.dataset.toolGroup).toBe("3");
    expect(expandedGroup.querySelectorAll(".gsd-tool-segment")).toHaveLength(3);
    expect(expandedGroup.querySelector(".gsd-tool-group-label")!.textContent).toBe("Read 3 files");
  });

  it("preserves reparented elements (segmentElements stays valid)", () => {
    const container = document.createElement("div");
    const el1 = makeToolEl("t1");
    const el2 = makeToolEl("t2");
    container.appendChild(el1);
    container.appendChild(el2);

    const toolCalls = new Map([
      ["t1", makeTc("t1", "Read")],
      ["t2", makeTc("t2", "Read")],
    ]);

    collapseToolIntoGroup(el2, el1, toolCalls);

    // Elements are still in the DOM (reparented, not cloned)
    expect(el1.parentElement).toBeTruthy();
    expect(el2.parentElement).toBeTruthy();
    expect(el1.dataset.toolId).toBe("t1");
    expect(el2.dataset.toolId).toBe("t2");
  });

  it("generates correct label for mixed tool types", () => {
    const container = document.createElement("div");
    const el1 = makeToolEl("t1");
    const el2 = makeToolEl("t2");
    container.appendChild(el1);
    container.appendChild(el2);

    const toolCalls = new Map([
      ["t1", makeTc("t1", "Read")],
      ["t2", makeTc("t2", "fetch_page")],
    ]);

    const group = collapseToolIntoGroup(el2, el1, toolCalls);
    expect(group.querySelector(".gsd-tool-group-label")!.textContent).toBe("Read 1 file, 1 page fetch");
  });
});
