import { describe, it, expect } from "vitest";
import { countPendingInContent } from "./captures-parser";

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
});
