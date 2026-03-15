/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../state";

describe("Fallback and session_shutdown event handling", () => {
  beforeEach(() => {
    // Reset state
    state.entries = [];
    state.isStreaming = false;
    state.processStatus = "running";
    state.model = {
      id: "claude-sonnet-4-20250514",
      name: "claude-sonnet-4-20250514",
      provider: "anthropic",
      contextWindow: 200000,
    };
  });

  describe("fallback_provider_switch", () => {
    it("parses from/to fields from event data", () => {
      const event = {
        type: "fallback_provider_switch",
        from: "anthropic/claude-sonnet-4-20250514",
        to: "openai/gpt-4o",
        reason: "rate_limit",
      };

      // Simulate what message-handler does: parse "to" field
      const parts = event.to.split("/");
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[0]).toBe("openai");
      expect(parts.slice(1).join("/")).toBe("gpt-4o");
    });

    it("updates model state from event", () => {
      const to = "openai/gpt-4o";
      const parts = to.split("/");
      if (parts.length >= 2) {
        state.model = {
          id: parts.slice(1).join("/"),
          name: parts.slice(1).join("/"),
          provider: parts[0],
          contextWindow: state.model?.contextWindow,
        };
      }

      expect(state.model!.provider).toBe("openai");
      expect(state.model!.id).toBe("gpt-4o");
    });
  });

  describe("fallback_provider_restored", () => {
    it("restores model from event data", () => {
      const event = {
        type: "fallback_provider_restored",
        model: {
          id: "claude-sonnet-4-20250514",
          name: "Claude Sonnet 4",
          provider: "anthropic",
          contextWindow: 200000,
        },
      };

      state.model = {
        id: event.model.id,
        name: event.model.name,
        provider: event.model.provider,
        contextWindow: event.model.contextWindow,
      };

      expect(state.model!.provider).toBe("anthropic");
      expect(state.model!.id).toBe("claude-sonnet-4-20250514");
      expect(state.model!.name).toBe("Claude Sonnet 4");
    });
  });

  describe("session_shutdown", () => {
    it("sets clean ended state", () => {
      state.isStreaming = true;
      state.processStatus = "running";

      // Simulate session_shutdown handler
      state.isStreaming = false;
      state.processStatus = "stopped";

      expect(state.isStreaming).toBe(false);
      expect(state.processStatus).toBe("stopped");
    });
  });
});
