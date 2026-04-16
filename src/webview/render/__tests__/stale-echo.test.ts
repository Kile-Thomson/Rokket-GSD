// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { state, type AssistantTurn } from "../../state";
import { detectStaleEcho } from "../../renderer";

function makeTurn(overrides: Partial<AssistantTurn> = {}): AssistantTurn {
  return {
    id: `turn-${Math.random()}`,
    segments: [{ type: "text", chunks: ["Short reply."] }],
    toolCalls: new Map(),
    isComplete: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("detectStaleEcho", () => {
  beforeEach(() => {
    state.entries = [];
  });

  it("returns false when there are no previous assistant entries", () => {
    expect(detectStaleEcho(makeTurn())).toBe(false);
  });

  it("returns false when the turn has tool calls", () => {
    const now = Date.now();
    state.entries.push({ id: "prev", type: "assistant", timestamp: now - 5000, turn: makeTurn({ timestamp: now - 5000 }) });
    const turn = makeTurn({ timestamp: now });
    turn.toolCalls.set("tc1", { id: "tc1", name: "Read", args: {}, resultText: "", isError: false, isRunning: false, startTime: now });
    expect(detectStaleEcho(turn)).toBe(false);
  });

  it("returns false when text is longer than 200 chars", () => {
    const now = Date.now();
    state.entries.push({ id: "prev", type: "assistant", timestamp: now - 5000, turn: makeTurn({ timestamp: now - 5000 }) });
    expect(detectStaleEcho(makeTurn({ timestamp: now, segments: [{ type: "text", chunks: ["x".repeat(201)] }] }))).toBe(false);
  });

  it("returns false when a user entry exists between assistant turns", () => {
    const now = Date.now();
    state.entries.push({ id: "prev", type: "assistant", timestamp: now - 10000, turn: makeTurn({ timestamp: now - 10000 }) });
    state.entries.push({ id: "user1", type: "user", text: "hello", timestamp: now - 5000 });
    expect(detectStaleEcho(makeTurn({ timestamp: now }))).toBe(false);
  });

  it("returns false when previous turn is older than 30s", () => {
    const now = Date.now();
    state.entries.push({ id: "prev", type: "assistant", timestamp: now - 31000, turn: makeTurn({ timestamp: now - 31000 }) });
    expect(detectStaleEcho(makeTurn({ timestamp: now }))).toBe(false);
  });

  it("returns false when turn has thinking segments", () => {
    const now = Date.now();
    state.entries.push({ id: "prev", type: "assistant", timestamp: now - 5000, turn: makeTurn({ timestamp: now - 5000 }) });
    expect(detectStaleEcho(makeTurn({ timestamp: now, segments: [{ type: "thinking", chunks: ["hmm"] }, { type: "text", chunks: ["ok"] }] }))).toBe(false);
  });

  it("detects a stale echo: short text-only turn following assistant with no user in between", () => {
    const now = Date.now();
    state.entries.push({ id: "prev", type: "assistant", timestamp: now - 5000, turn: makeTurn({ timestamp: now - 5000 }) });
    expect(detectStaleEcho(makeTurn({ timestamp: now, segments: [{ type: "text", chunks: ["Stale echo — already handled."] }] }))).toBe(true);
  });

  it("detects stale echo even with system entries in between", () => {
    const now = Date.now();
    state.entries.push({ id: "prev", type: "assistant", timestamp: now - 5000, turn: makeTurn({ timestamp: now - 5000 }) });
    state.entries.push({ id: "sys1", type: "system", systemText: "info", timestamp: now - 2000 });
    expect(detectStaleEcho(makeTurn({ timestamp: now }))).toBe(true);
  });

  it("detects multiple stale echoes in succession", () => {
    const now = Date.now();
    state.entries.push({ id: "t1", type: "assistant", timestamp: now - 10000, turn: makeTurn({ timestamp: now - 10000 }) });
    state.entries.push({ id: "t2", type: "assistant", timestamp: now - 5000, turn: makeTurn({ timestamp: now - 5000 }) });
    expect(detectStaleEcho(makeTurn({ timestamp: now }))).toBe(true);
  });
});
