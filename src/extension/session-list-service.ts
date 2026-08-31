// ============================================================
// Session List Service — reads GSD session JSONL files directly
// ============================================================
//
// Why direct filesystem read instead of importing SessionManager:
// The pi-coding-agent config.js resolves piConfig from its own package.json,
// yielding configDir ".pi" — but GSD uses ".gsd". Direct read is correct,
// self-contained, and ~60 lines of straightforward JSONL parsing.
// See DECISIONS.md #7.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

// ============================================================
// Types
// ============================================================

export interface SessionInfo {
  /** Absolute path to the session JSONL file */
  path: string;
  /** Session UUID */
  id: string;
  /** Working directory the session was started in */
  cwd: string;
  /** User-defined display name (from session_info entries) */
  name?: string;
  /** First user message text (for preview) */
  firstMessage: string;
  /** Session creation timestamp */
  created: Date;
  /** Last activity timestamp */
  modified: Date;
  /** Total number of message entries */
  messageCount: number;
}

// ============================================================
// Session directory resolution
// ============================================================

const CONFIG_DIR = ".gsd";
const SESSIONS_SUBDIR = path.join("agent", "sessions");

/**
 * Compute the session directory for a given cwd.
 * Matches GSD's encoding: `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
 */
export function getSessionDir(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(os.homedir(), CONFIG_DIR, SESSIONS_SUBDIR, safePath);
}

// ============================================================
// Session file parsing
// ============================================================

interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: {
    role: string;
    content: unknown;
    timestamp?: number;
  };
  name?: string; // for session_info entries
}

/**
 * Extract text content from a message's content field.
 */
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: Record<string, unknown>) => block.type === "text")
      .map((block: Record<string, unknown>) => block.text as string)
      .join(" ");
  }
  return "";
}

/**
 * Update the running last-activity timestamp from a single message entry.
 * Returns the new max, preferring the message-level epoch-ms timestamp and
 * falling back to the entry-level ISO string.
 */
function updateLastActivity(current: number | undefined, entry: SessionEntry): number | undefined {
  const msg = entry.message;
  if (!msg) return current;
  if (msg.role !== "user" && msg.role !== "assistant") return current;

  // Try message-level timestamp first (epoch ms)
  if (typeof msg.timestamp === "number") {
    return Math.max(current ?? 0, msg.timestamp);
  }
  // Fall back to entry-level timestamp (ISO string)
  if (typeof entry.timestamp === "string") {
    const t = new Date(entry.timestamp).getTime();
    if (!Number.isNaN(t)) {
      return Math.max(current ?? 0, t);
    }
  }
  return current;
}

/**
 * Parse a single session JSONL file into SessionInfo.
 * Returns null if the file is invalid or unreadable.
 *
 * Streams the file line-by-line instead of buffering the whole file: the
 * running state (header, name, count, firstMessage, lastActivity) is updated
 * inline so peak memory is one line at a time rather than the entire file plus
 * a parsed entries[] array. Only firstMessage can early-exit its capture; name
 * (latest wins), messageCount, and lastActivity (max timestamp) still require
 * scanning every line.
 */
export async function buildSessionInfo(filePath: string): Promise<SessionInfo | null> {
  let stream: fs.ReadStream | undefined;
  try {
    stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let header: SessionHeader | null = null;
    let messageCount = 0;
    let firstMessage = "";
    let name: string | undefined;
    let lastActivity: number | undefined;

    for await (const line of rl) {
      if (!line.trim()) continue;
      let parsed: SessionEntry;
      try {
        parsed = JSON.parse(line) as SessionEntry;
      } catch {
        // Skip malformed lines
        continue;
      }

      if (!header && parsed.type === "session") {
        header = parsed as unknown as SessionHeader;
        continue;
      }

      // Extract session name (use latest)
      if (parsed.type === "session_info" && parsed.name) {
        name = parsed.name.trim();
      }

      if (parsed.type !== "message") continue;
      messageCount++;

      const msg = parsed.message;
      if (!msg) continue;
      if (msg.role !== "user" && msg.role !== "assistant") continue;

      if (!firstMessage && msg.role === "user") {
        const text = extractTextFromContent(msg.content);
        if (text) firstMessage = text;
      }

      lastActivity = updateLastActivity(lastActivity, parsed);
    }

    if (!header || header.type !== "session" || typeof header.id !== "string") {
      return null;
    }

    const stats = await fs.promises.stat(filePath);
    const created = new Date(header.timestamp);
    const modified = lastActivity ? new Date(lastActivity) : stats.mtime;

    return {
      path: filePath,
      id: header.id,
      cwd: header.cwd || "",
      name,
      firstMessage: firstMessage || "(no messages)",
      created,
      modified,
      messageCount,
    };
  } catch {
    return null;
  } finally {
    // Ensure the underlying fd is released if the stream is still open
    // (e.g. an early return or a mid-stream throw).
    stream?.destroy();
  }
}

/** Max session files read concurrently — bounds peak memory / fd usage. */
const LIST_CONCURRENCY = 8;

/**
 * Map `worker` over `items` with a bounded number of concurrent invocations.
 * Preserves input order in the returned results.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runner(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }

  const pool = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(pool);
  return results;
}

/**
 * List all sessions for a given working directory.
 * Returns sessions sorted by most recently modified first.
 */
export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  const dir = getSessionDir(cwd);

  try {
    const dirEntries = await fs.promises.readdir(dir);
    const jsonlFiles = dirEntries
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dir, f));

    // Bound the fan-out so peak memory / fd usage stays constant regardless of
    // how many session files the directory holds.
    const results = await mapWithConcurrency(jsonlFiles, LIST_CONCURRENCY, buildSessionInfo);
    const sessions = results.filter((s): s is SessionInfo => s !== null);

    // Sort by most recently modified first
    sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());

    return sessions;
  } catch {
    // Missing directory (ENOENT) or any read error resolves to no sessions.
    return [];
  }
}

/**
 * Delete a session file.
 * Validates the path is inside the expected sessions directory and is a .jsonl file.
 * @param sessionPath Absolute path to the session JSONL file
 */
export async function deleteSession(sessionPath: string): Promise<void> {
  // Security: validate the path is inside the sessions directory
  const sessionsRoot = path.join(os.homedir(), CONFIG_DIR, SESSIONS_SUBDIR);
  const resolved = path.resolve(sessionPath);
  const normalizedRoot = path.resolve(sessionsRoot);

  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(`[GSD-ERR-001] Refusing to delete file outside sessions directory: ${resolved}`);
  }

  if (!resolved.endsWith(".jsonl")) {
    throw new Error(`[GSD-ERR-002] Refusing to delete non-session file: ${resolved}`);
  }

  await fs.promises.unlink(resolved);
}

/** Validate that a session path is inside the sessions directory. */
export function validateSessionPath(sessionPath: string): void {
  const sessionsRoot = path.join(os.homedir(), CONFIG_DIR, SESSIONS_SUBDIR);
  const resolved = path.resolve(sessionPath);
  const normalizedRoot = path.resolve(sessionsRoot);

  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(`[GSD-ERR-003] Refusing to access session file outside sessions directory: ${resolved}`);
  }
}
