---
id: M002
title: Conversation History
status: complete
started: 2026-03-12
completed: 2026-03-12
slices_completed: 2
total_files_changed: 8
lines_added: ~1350
---

# M002: Conversation History

**Users can browse, search, rename, and resume previous conversations from a session history panel in the VS Code chat sidebar.**

## What Shipped

### S01: Session List & Switch
- `SessionListService` reads JSONL files directly from `~/.gsd/agent/sessions/<encoded-cwd>/`
- Session history overlay panel (model-picker pattern) with loading, empty, and populated states
- Full switch flow: History button → list → click → RPC switch_session → get_messages → render conversation
- Two-pass historical message rendering: index tool results by toolCallId, then render user/assistant messages with thinking, text, and tool_use content blocks

### S02: Search, Name & Delete
- Search input filters sessions by name and firstMessage (case-insensitive)
- Keyboard navigation: ArrowDown/Up, Enter to select, Escape to close
- Rename current session via inline editing
- Delete non-current sessions with confirmation dialog

## Key Decision

**Direct filesystem read of session JSONL files** instead of importing SessionManager from pi-coding-agent. The library's config resolution points to `.pi` instead of `.gsd`, making it unusable. Direct read is ~190 lines, self-contained, and correct. RPC `switch_session` handles the complex load/migrate/restore. (DECISIONS.md #7)

## New Files

- `src/extension/session-list-service.ts` — session directory resolution, JSONL parsing, listing, deletion
- `src/webview/session-history.ts` — overlay panel with search, keyboard nav, rename, delete

## Modified Files

- `src/shared/types.ts` — SessionListItem type, 4 new webview→extension + 3 new extension→webview message types
- `src/extension/rpc-client.ts` — switchSession(), setSessionName()
- `src/extension/webview-provider.ts` — 4 new message handlers
- `src/webview/index.ts` — History button, session_switched handler, renderHistoricalMessages()
- `src/webview/styles.css` — session history panel styles (200+ lines)
- `CHANGELOG.md` — updated
