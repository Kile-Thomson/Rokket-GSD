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
 * Get the last activity timestamp from message entries.
 */
function getLastActivityTime(entries: SessionEntry[]): number | undefined {
  let lastTime: number | undefined;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg) continue;
    if (msg.role !== "user" && msg.role !== "assistant") continue;

    // Try message-level timestamp first (epoch ms)
    if (typeof msg.timestamp === "number") {
      lastTime = Math.max(lastTime ?? 0, msg.timestamp);
      continue;
    }
    // Fall back to entry-level timestamp (ISO string)
    if (typeof entry.timestamp === "string") {
      const t = new Date(entry.timestamp).getTime();
      if (!Number.isNaN(t)) {
        lastTime = Math.max(lastTime ?? 0, t);
      }
    }
  }
  return lastTime;
}

/**
 * Parse a single session JSONL file into SessionInfo.
 * Returns null if the file is invalid or unreadable.
 */
export async function buildSessionInfo(filePath: string): Promise<SessionInfo | null> {
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    const lines = content.split("\n");
    const entries: SessionEntry[] = [];
    let header: SessionHeader | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (!header && parsed.type === "session") {
          header = parsed as SessionHeader;
        } else {
          entries.push(parsed as SessionEntry);
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (!header || header.type !== "session" || typeof header.id !== "string") {
      return null;
    }

    let messageCount = 0;
    let firstMessage = "";
    let name: string | undefined;

    for (const entry of entries) {
      // Extract session name (use latest)
      if (entry.type === "session_info" && entry.name) {
        name = entry.name.trim();
      }

      if (entry.type !== "message") continue;
      messageCount++;

      const msg = entry.message;
      if (!msg) continue;
      if (msg.role !== "user" && msg.role !== "assistant") continue;

      const text = extractTextFromContent(msg.content);
      if (!firstMessage && msg.role === "user" && text) {
        firstMessage = text;
      }
    }

    const stats = await fs.promises.stat(filePath);
    const created = new Date(header.timestamp);
    const lastActivity = getLastActivityTime(entries);
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
  }
}

/**
 * List all sessions for a given working directory.
 * Returns sessions sorted by most recently modified first.
 */
export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  const dir = getSessionDir(cwd);

  if (!fs.existsSync(dir)) {
    return [];
  }

  try {
    const dirEntries = await fs.promises.readdir(dir);
    const jsonlFiles = dirEntries
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dir, f));

    const results = await Promise.all(jsonlFiles.map(buildSessionInfo));
    const sessions = results.filter((s): s is SessionInfo => s !== null);

    // Sort by most recently modified first
    sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());

    return sessions;
  } catch {
    return [];
  }
}

/**
 * Delete a session file.
 * @param sessionPath Absolute path to the session JSONL file
 */
export async function deleteSession(sessionPath: string): Promise<void> {
  await fs.promises.unlink(sessionPath);
}
