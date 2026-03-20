import * as fs from "fs";
import * as path from "path";

// ============================================================
// Captures Parser
// Reads .gsd/CAPTURES.md and counts pending capture entries.
// ============================================================

/**
 * Count pending captures in .gsd/CAPTURES.md.
 * Returns 0 if the file doesn't exist or can't be read.
 */
export async function countPendingCaptures(cwd: string): Promise<number> {
  const capturesPath = path.join(cwd, ".gsd", "CAPTURES.md");
  try {
    const content = await fs.promises.readFile(capturesPath, "utf-8");
    return countPendingInContent(content);
  } catch {
    return 0;
  }
}

/**
 * Count pending captures from raw CAPTURES.md content.
 * Exported for testing.
 */
export function countPendingInContent(content: string): number {
  let count = 0;
  for (const line of content.split("\n")) {
    if (line.match(/^\*\*Status:\*\*\s*pending\s*$/i)) {
      count++;
    }
  }
  return count;
}
