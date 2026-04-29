import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock vscode ──
const mockGetConfiguration = vi.fn();
const mockShowWarningMessage = vi.fn().mockResolvedValue(undefined);
const mockShowInformationMessage = vi.fn().mockResolvedValue(undefined);

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: (...args: unknown[]) => mockGetConfiguration(...args),
  },
  window: {
    showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    showInformationMessage: (...args: unknown[]) => mockShowInformationMessage(...args),
  },
  extensions: {
    getExtension: vi.fn(),
  },
}));

// ── Mock child_process ──
// execFile uses callback (err, stdout, stderr) — mock returns value or throws via callback
const mockNodeResult = vi.fn<() => string>().mockReturnValue("v20.11.0\n");
const mockWhichResult = vi.fn<() => string>().mockReturnValue("C:\\path\\to\\gsd\n");
vi.mock("child_process", () => ({
  execFile: (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
    try {
      if (cmd === "node") {
        cb(null, mockNodeResult());
      } else {
        // "where" / "which" for gsd lookup
        cb(null, mockWhichResult());
      }
    } catch (e) {
      cb(e as Error, "");
    }
  },
}));

// ── Mock fs ──
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockReadFileAsync = vi.fn();
vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  promises: {
    readFile: (...args: unknown[]) => mockReadFileAsync(...args),
  },
}));

import { runHealthCheck } from "./health-check";

// ── Helpers ──
function createMockOutput() {
  return {
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    name: "GSD Test",
    replace: vi.fn(),
  } as any;
}

function setupDefaultMocks() {
  // Default: node found, correct version
  mockNodeResult.mockReturnValue("v20.11.0\n");
  // Default: gsd found
  mockWhichResult.mockReturnValue("C:\\path\\to\\gsd\n");
  // Default: no config overrides
  mockGetConfiguration.mockReturnValue({
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === "processWrapper") return "";
      return defaultValue;
    }),
  });
  // Default: auth.json exists with an authorized model provider (existsSync no longer used)
  mockReadFileSync.mockImplementation((filePath: string) => {
    if (filePath.includes("auth.json")) {
      return JSON.stringify({
        anthropic: { type: "api_key", key: "sk-test-key" },
      });
    }
    if (filePath.includes("settings.json")) {
      return JSON.stringify({
        defaultProvider: "anthropic",
        defaultModel: "claude-sonnet-4-20250514",
      });
    }
    if (filePath.includes("package.json")) {
      return JSON.stringify({ version: "1.0.0" });
    }
    return "{}";
  });
  mockReadFileAsync.mockImplementation((filePath: string) => {
    if (filePath.includes("auth.json")) {
      return Promise.resolve(JSON.stringify({
        anthropic: { type: "api_key", key: "sk-test-key" },
      }));
    }
    if (filePath.includes("settings.json")) {
      return Promise.resolve(JSON.stringify({
        defaultProvider: "anthropic",
        defaultModel: "claude-sonnet-4-20250514",
      }));
    }
    if (filePath.includes("package.json")) {
      return Promise.resolve(JSON.stringify({ version: "1.0.0" }));
    }
    return Promise.resolve("{}");
  });
}

describe("health-check", () => {
  let output: ReturnType<typeof createMockOutput>;

  beforeEach(() => {
    output = createMockOutput();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runHealthCheck", () => {
    it("returns clean result when all checks pass", async () => {
      const result = await runHealthCheck(output);

      expect(result.nodeFound).toBe(true);
      expect(result.nodeVersion).toBe("v20.11.0");
      expect(result.gsdFound).toBe(true);
      expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    });

    it("reports issue when node is not found", async () => {
      mockNodeResult.mockImplementation(() => {
        throw new Error("not found");
      });

      const result = await runHealthCheck(output);

      expect(result.nodeFound).toBe(false);
      expect(result.issues.some((i) => i.message.includes("Node.js not found"))).toBe(true);
    });

    it("reports issue when node version is too old", async () => {
      mockNodeResult.mockReturnValue("v16.0.0\n");

      const result = await runHealthCheck(output);

      expect(result.nodeFound).toBe(true);
      expect(result.nodeVersion).toBe("v16.0.0");
      expect(result.issues.some((i) => i.message.includes("too old"))).toBe(true);
    });

    it("reports issue when gsd binary is not found", async () => {
      mockWhichResult.mockImplementation(() => {
        throw new Error("not found");
      });

      const result = await runHealthCheck(output);

      expect(result.gsdFound).toBe(false);
      expect(result.issues.some((i) => i.message.includes("not found"))).toBe(true);
    });

    it("reports custom processWrapper not found with specific message", async () => {
      mockGetConfiguration.mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "processWrapper") return "/custom/gsd-path";
          return undefined;
        }),
      });
      mockWhichResult.mockImplementation(() => {
        throw new Error("not found");
      });

      const result = await runHealthCheck(output);

      expect(result.gsdFound).toBe(false);
      expect(result.issues.some((i) => i.message.includes("Custom GSD path not found"))).toBe(true);
    });

    it("reports issue when no model provider is authorized", async () => {
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes("auth.json")) {
          return JSON.stringify({
            github: { type: "oauth" }, // service provider, not model provider
          });
        }
        if (filePath.includes("settings.json")) return "{}";
        return "{}";
      });
      mockReadFileAsync.mockImplementation((filePath: string) => {
        if (filePath.includes("auth.json")) {
          return Promise.resolve(JSON.stringify({
            github: { type: "oauth" },
          }));
        }
        if (filePath.includes("settings.json")) return Promise.resolve("{}");
        return Promise.resolve("{}");
      });

      const result = await runHealthCheck(output);

      expect(result.issues.some((i) => i.message.includes("No AI model provider"))).toBe(true);
    });

    it("reports warning when auth.json does not exist", async () => {
      mockReadFileAsync.mockImplementation((filePath: string) => {
        if (filePath.includes("auth.json")) {
          return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
        }
        if (filePath.includes("settings.json")) return Promise.resolve("{}");
        return Promise.resolve("{}");
      });

      const result = await runHealthCheck(output);

      expect(result.issues.some((i) => i.severity === "warning" && i.message.includes("No auth configuration"))).toBe(true);
    });

    it("collects auth provider info correctly", async () => {
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes("auth.json")) {
          return JSON.stringify({
            anthropic: { type: "api_key", key: "sk-test" },
            openai: { type: "api_key", key: "" },
            google: { type: "oauth", access: "tok123", refresh: "ref456" },
          });
        }
        if (filePath.includes("settings.json")) return "{}";
        return "{}";
      });
      mockReadFileAsync.mockImplementation((filePath: string) => {
        if (filePath.includes("auth.json")) {
          return Promise.resolve(JSON.stringify({
            anthropic: { type: "api_key", key: "sk-test" },
            openai: { type: "api_key", key: "" },
            google: { type: "oauth", access: "tok123", refresh: "ref456" },
          }));
        }
        if (filePath.includes("settings.json")) return Promise.resolve("{}");
        return Promise.resolve("{}");
      });

      const result = await runHealthCheck(output);

      expect(result.authProviders).toHaveLength(3);
      const anthropic = result.authProviders.find((p) => p.name === "anthropic");
      expect(anthropic?.authorized).toBe(true);
      expect(anthropic?.type).toBe("api_key");

      const openai = result.authProviders.find((p) => p.name === "openai");
      expect(openai?.authorized).toBe(false);

      const google = result.authProviders.find((p) => p.name === "google");
      expect(google?.authorized).toBe(true);
      expect(google?.type).toBe("oauth");
    });

    it("reads default provider and model from settings.json", async () => {
      const result = await runHealthCheck(output);

      expect(result.defaultProvider).toBe("anthropic");
      expect(result.defaultModel).toBe("claude-sonnet-4-20250514");
    });

    it("warns when default provider is not authorized", async () => {
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes("auth.json")) {
          return JSON.stringify({
            anthropic: { type: "api_key", key: "sk-test" },
            openai: { type: "api_key", key: "" },
          });
        }
        if (filePath.includes("settings.json")) {
          return JSON.stringify({
            defaultProvider: "openai",
            defaultModel: "gpt-4",
          });
        }
        return "{}";
      });
      mockReadFileAsync.mockImplementation((filePath: string) => {
        if (filePath.includes("auth.json")) {
          return Promise.resolve(JSON.stringify({
            anthropic: { type: "api_key", key: "sk-test" },
            openai: { type: "api_key", key: "" },
          }));
        }
        if (filePath.includes("settings.json")) {
          return Promise.resolve(JSON.stringify({
            defaultProvider: "openai",
            defaultModel: "gpt-4",
          }));
        }
        return Promise.resolve("{}");
      });

      const result = await runHealthCheck(output);

      expect(result.issues.some((i) =>
        i.severity === "warning" && i.message.includes('Default provider "openai"')
      )).toBe(true);
    });

    it("logs output to the OutputChannel", async () => {
      await runHealthCheck(output);

      expect(output.appendLine).toHaveBeenCalled();
      const calls = output.appendLine.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls.some((c: string) => c.includes("Health Check"))).toBe(true);
      expect(calls.some((c: string) => c.includes("Node.js"))).toBe(true);
    });

    it("shows warning notification when there are error-level issues", async () => {
      mockNodeResult.mockImplementation(() => {
        throw new Error("not found");
      });

      await runHealthCheck(output);

      expect(mockShowWarningMessage).toHaveBeenCalled();
    });
  });
});
