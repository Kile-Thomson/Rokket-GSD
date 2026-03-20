import { describe, it, expect, vi } from "vitest";
import { countPendingInContent, countPendingCaptures } from "./captures-parser";
import * as fs from "fs";

vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

describe("captures-parser", () => {
  it("returns 0 for empty content", () => {
    expect(countPendingInContent("")).toBe(0);
  });

  it("returns 0 for content with no captures", () => {
    expect(countPendingInContent("# Captures\n\nNo entries yet.")).toBe(0);
  });

  it("counts pending captures", () => {
    const content = `# Captures

### CAP-abc12345
**Text:** Fix the tests
**Captured:** 2026-03-17T00:00:00Z
**Status:** pending

### CAP-def67890
**Text:** Add logging
**Captured:** 2026-03-17T00:01:00Z
**Status:** triaged

### CAP-ghi11111
**Text:** Check perf
**Captured:** 2026-03-17T00:02:00Z
**Status:** pending
`;
    expect(countPendingInContent(content)).toBe(2);
  });

  it("returns 0 when all resolved", () => {
    const content = `# Captures

### CAP-abc12345
**Text:** Done
**Captured:** 2026-03-17T00:00:00Z
**Status:** resolved
`;
    expect(countPendingInContent(content)).toBe(0);
  });

  it("handles case-insensitive status", () => {
    const content = `### CAP-abc
**Status:** Pending
`;
    expect(countPendingInContent(content)).toBe(1);
  });

  describe("countPendingCaptures", () => {
    it("reads captures file and counts pending entries", async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue("**Status:** pending\n**Status:** pending\n");
      const count = await countPendingCaptures("/workspace");
      expect(count).toBe(2);
    });

    it("returns 0 when file does not exist", async () => {
      vi.mocked(fs.promises.readFile).mockRejectedValue(new Error("ENOENT"));
      const count = await countPendingCaptures("/workspace");
      expect(count).toBe(0);
    });
  });
});
