import * as crypto from "crypto";

/**
 * Shared poller IPC protocol.
 *
 * The server owns getUpdates for a single bot token. Clients connect
 * and receive all updates — local filtering by threadId happens in
 * each client's bridge. Only the poller calls getUpdates; clients
 * make outbound API calls (sendMessage, etc.) directly.
 */

// --- Pipe name ---

export function pollerPipeName(botToken: string): string {
  const hash = crypto.createHash("sha256").update(botToken).digest("hex").slice(0, 12);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\gsd-telegram-${hash}`;
  }
  return `/tmp/gsd-telegram-${hash}.sock`;
}

// --- Wire messages (JSON-line protocol) ---

export interface PollerUpdatesMessage {
  type: "updates";
  updates: unknown[]; // TelegramUpdate[]
}

export interface PollerPingMessage {
  type: "ping";
}

export interface PollerPongMessage {
  type: "pong";
}

export type PollerServerMessage = PollerUpdatesMessage | PollerPongMessage;
export type PollerClientMessage = PollerPingMessage;

export function encodeMessage(msg: PollerServerMessage | PollerClientMessage): Buffer {
  return Buffer.from(JSON.stringify(msg) + "\n", "utf8");
}

export function parseLines(buffer: string): { messages: string[]; remainder: string } {
  const parts = buffer.split("\n");
  const remainder = parts.pop()!; // last element is partial or empty
  return { messages: parts.filter(Boolean), remainder };
}
