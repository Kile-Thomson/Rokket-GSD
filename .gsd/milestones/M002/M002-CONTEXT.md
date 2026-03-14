# M002: Conversation History — Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

## Project Description

Rokket GSD is a VS Code extension wrapping the GSD AI coding agent into a native chat panel. M001 completed codebase polish. M002 adds conversation history — the ability to browse, search, and resume previous sessions.

## Why This Milestone

- Users lose all conversation context when they close VS Code or start a new session
- GSD already persists sessions as JSONL files in `~/.gsd/agent/sessions/<encoded-cwd>/`, but the VS Code extension has no way to list, browse, or switch to them
- This is the #1 missing feature noted in PROJECT.md

## User-Visible Outcome

### When this milestone is complete, the user can:

- Open a session history panel and see all previous conversations for the current workspace, sorted by most recent
- See each session's first message, timestamp, message count, and optional display name
- Click a previous session to resume it — the chat loads that session's history and continues from where it left off
- Search/filter sessions by text content
- Name the current session for easier identification later

### Entry point / environment

- Entry point: VS Code sidebar panel — new "History" button in header or slash command
- Environment: VS Code Extension Development Host
- Live dependencies involved: GSD RPC subprocess (for `switch_session`, `set_session_name`), filesystem (for session listing)

## Completion Class

- Contract complete means: session listing returns correct data from real session files, switch_session RPC works, types compile
- Integration complete means: full flow exercised in Extension Development Host — list → select → switch → chat continues
- Operational complete means: handles edge cases — no sessions, corrupted files, sessions from other workspaces ignored

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- User can open history, see previous sessions, click one, and continue chatting in that session
- User can name a session and see the name persist across history views
- Search filters sessions correctly by message content
- Starting a new conversation and then returning to history shows it in the list

## Risks and Unknowns

- Session file parsing performance — workspaces with many/large sessions could be slow — mitigated by only parsing headers + first message (not full content) for listing, and lazy-loading full content
- `switch_session` RPC behavior — need to verify it properly restores message history and emits events the webview can render — retire this risk first in S01

## Existing Codebase / Prior Art

- `src/extension/rpc-client.ts` — has `newSession()` and `getState()` but no `switchSession()` or `listSessions()`; needs `switchSession()` and `setSessionName()` methods added
- `src/extension/webview-provider.ts` — handles `new_conversation` message; needs session list/switch handling
- `src/shared/types.ts` — message protocol types; needs new message types for session listing
- `src/webview/index.ts` — header has "New" button; needs "History" button and session list UI
- GSD session files at `~/.gsd/agent/sessions/<encoded-cwd>/` — JSONL format with `SessionHeader` on line 1
- GSD `switch_session` RPC command — takes `sessionPath`, returns `{ cancelled: boolean }`
- GSD `set_session_name` RPC command — takes `name` string
- `SessionInfo` shape from pi-coding-agent: `{ path, id, cwd, name, created, modified, messageCount, firstMessage, allMessagesText }`

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Scope

### In Scope

- List sessions for the current workspace
- Display session metadata (name, first message, date, message count)
- Switch to a previous session (via RPC `switch_session`)
- Name/rename current session (via RPC `set_session_name`)
- Search/filter sessions by text
- Delete sessions (filesystem delete + confirm)
- Session list UI in the webview (overlay panel, like model picker)

### Out of Scope / Non-Goals

- Cross-workspace session browsing (listAll) — future milestone
- Session export/import between machines
- Session branching/forking UI (fork command exists but is separate)
- Session diff/comparison
- Offline session viewing (rendered HTML export already exists via `/export`)

## Technical Constraints

- Session listing must be done from the extension host (Node.js), not the webview (browser sandbox)
- Session files are JSONL — we parse them ourselves rather than importing SessionManager (which resolves to wrong config dir `.pi` vs `.gsd`)
- The `switch_session` RPC command handles all the heavy lifting of loading, migrating, and restoring session state — we only provide the file path
- Session directory path encoding: `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`

## Integration Points

- GSD RPC process — `switch_session`, `set_session_name`, `get_state` commands
- Filesystem — `~/.gsd/agent/sessions/<encoded-cwd>/` directory for session JSONL files
- Webview message protocol — new message types for session list/switch/rename

## Open Questions

- Should session delete require double-confirm (it's destructive and irreversible)? — Yes, use a confirm dialog
- Should the history panel show sessions from ALL workspaces or just the current one? — Current workspace only for M002; cross-workspace is a future feature
