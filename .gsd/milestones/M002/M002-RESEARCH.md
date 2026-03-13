# M002: Conversation History — Research

**Date:** 2026-03-12

## Summary

The GSD RPC protocol already supports `switch_session` (by path) and `set_session_name`, but has no `list_sessions` command. Session listing must be done by the extension host directly.

Two approaches were evaluated: (1) importing `SessionManager` from `@mariozechner/pi-coding-agent`, or (2) reading session JSONL files directly from the filesystem. Option 2 is the correct choice.

**Option 1 (import SessionManager) is broken by design.** The `config.js` module resolves `piConfig` from its own `package.json` (walking up from `__dirname`), which yields `configDir: ".pi"` — but GSD uses `configDir: ".gsd"`. So `SessionManager.list()` would look in `~/.pi/agent/sessions/` instead of `~/.gsd/agent/sessions/`. Working around this requires setting `GSD_CODING_AGENT_DIR` env var or monkey-patching, both fragile.

**Option 2 (direct filesystem read) is simple, correct, and self-contained.** Session files are JSONL with a well-defined schema. The listing logic is ~50 lines of straightforward file parsing. We control the directory path encoding. For switching, we still delegate to the RPC `switch_session` command.

## Recommendation

Read session files directly from `~/.gsd/agent/sessions/<encoded-cwd>/`. Build a lightweight `SessionListService` in the extension host that:
1. Computes the session directory path from the workspace cwd
2. Reads all `.jsonl` files in that directory
3. Parses only the header + scans for first user message and message count
4. Returns `SessionInfo[]` sorted by modified date
5. Caches results with a short TTL or invalidates on file system changes

For session switching, use the existing RPC `switch_session` command. For naming, use `set_session_name`. Both are already in the protocol.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Session switching | RPC `switch_session` command | Handles migration, state restoration, event emission — complex logic we shouldn't duplicate |
| Session naming | RPC `set_session_name` command | Persists as `session_info` entry in the JSONL file |
| Session file format | JSONL with `SessionHeader` on line 1 | Stable format, version 3, well-documented in pi-coding-agent types |

## Existing Code and Patterns

- `src/webview/model-picker.ts` — overlay panel pattern to follow for session list UI (162 lines, clean show/hide, keyboard nav)
- `src/webview/slash-menu.ts` — search/filter pattern with keyboard navigation (228 lines)
- `src/extension/webview-provider.ts` — message routing pattern for new webview↔extension messages
- `src/extension/rpc-client.ts` — convenience methods pattern for new RPC calls
- `src/webview/state.ts` — shared state pattern for session list data

## Constraints

- Session directory path encoding must match GSD's: `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
- Config dir is `.gsd` (from `gsd-pi` package.json `piConfig.configDir`)
- Session files are append-only JSONL — header is always line 1
- The `allMessagesText` field in `SessionInfo` (used for search) requires reading the full file — expensive for large sessions. For initial listing, only read header + first user message. Load full text lazily for search.

## Common Pitfalls

- **Wrong config directory** — Must use `.gsd` not `.pi`. Hardcode `~/.gsd/agent/sessions/` path computation.
- **Large session files** — Some sessions can be MB+. Don't read full file contents for listing. Read header (line 1) + scan for first user message, then stop.
- **File encoding on Windows** — JSONL files are UTF-8. Use `{ encoding: 'utf8' }` explicitly.
- **Race condition on switch** — After `switch_session`, wait for the state update event before refreshing the session list, otherwise the UI shows stale data.

## Open Risks

- Performance with 100+ sessions in a workspace — mitigate with pagination or virtual scrolling if needed, but unlikely for V1
- Session files from older GSD versions (v1/v2 format) — `switch_session` RPC handles migration internally, but our listing parser should handle missing fields gracefully

## Sources

- Session format analysis from `pi-coding-agent/dist/core/session-manager.js` (source code)
- RPC protocol from `pi-coding-agent/dist/modes/rpc/rpc-types.d.ts` (type definitions)
- Config resolution from `pi-coding-agent/dist/config.js` (package dir walking logic)
