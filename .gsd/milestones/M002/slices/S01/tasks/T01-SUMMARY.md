---
task: T01
title: Session list service and types
status: complete
started: 2026-03-12
completed: 2026-03-12
---

# T01: Session list service and types

## What Was Done

1. Created `src/extension/session-list-service.ts`:
   - `getSessionDir(cwd)` — computes `~/.gsd/agent/sessions/<encoded-cwd>/`
   - `buildSessionInfo(filePath)` — parses a single JSONL file into SessionInfo
   - `listSessions(cwd)` — lists all sessions sorted by modified desc
   - `deleteSession(sessionPath)` — deletes a session file
   - Handles text extraction from message content (string and array forms)
   - Uses last activity timestamp from messages for accurate modified date

2. Added to `src/shared/types.ts`:
   - `SessionListItem` interface (serializable with string dates)
   - New `WebviewToExtensionMessage` types: `get_session_list`, `switch_session`, `rename_session`, `delete_session`
   - New `ExtensionToWebviewMessage` types: `session_list`, `session_switched`, `session_list_error`

3. Added to `src/extension/rpc-client.ts`:
   - `switchSession(sessionPath)` method
   - `setSessionName(name)` method

## Verification

- `npm run build` succeeds with no errors
