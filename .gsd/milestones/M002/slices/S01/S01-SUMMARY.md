---
id: S01
parent: M002
milestone: M002
provides:
  - SessionListService for reading session JSONL files from filesystem
  - switchSession() and setSessionName() RPC client methods
  - Session list/switch/rename/delete message protocol types
  - Session history overlay panel in webview
  - History button in header toolbar
  - Historical message rendering with tool call support
requires:
  - slice: none
    provides: first slice
affects:
  - S02
key_files:
  - src/extension/session-list-service.ts
  - src/webview/session-history.ts
  - src/shared/types.ts
  - src/extension/rpc-client.ts
  - src/extension/webview-provider.ts
  - src/webview/index.ts
  - src/webview/styles.css
key_decisions:
  - Direct filesystem read of session JSONL files instead of importing SessionManager (DECISIONS.md #7)
patterns_established:
  - Overlay panel pattern extended from model-picker to session-history
  - Two-pass historical message rendering (index tool results first, then render)
observability_surfaces:
  - Output panel (Rokket GSD) logs session list count, switch events, errors
drill_down_paths:
  - .gsd/milestones/M002/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M002/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M002/slices/S01/tasks/T03-SUMMARY.md
  - .gsd/milestones/M002/slices/S01/tasks/T04-SUMMARY.md
duration: ~2h
verification_result: passed
completed_at: 2026-03-12
---

# S01: Session List & Switch

**Full session history overlay with list, switch, and historical message rendering — filesystem-based session discovery with RPC-based session switching.**

## What Happened

Built the complete session history feature in 4 tasks:

1. **Session list service** (`session-list-service.ts`, 190 lines) — reads JSONL files from `~/.gsd/agent/sessions/<encoded-cwd>/`, parses headers and first user messages, returns sorted `SessionInfo[]`. Path encoding matches GSD's exact regex. Verified against real session files.

2. **Message routing** — 4 new handlers in `webview-provider.ts`: `get_session_list` (calls service, maps to serializable items), `switch_session` (RPC switch → get_state + get_messages → post to webview), `rename_session` (RPC set_session_name), `delete_session` (filesystem delete + auto-refresh list).

3. **Session history panel** (`session-history.ts`, 240 lines) — overlay panel following model-picker pattern. Shows session name/preview, relative time, message count. Current session highlighted. Loading/empty states. Click-outside and Escape to close.

4. **Historical message rendering** — two-pass strategy: first indexes all toolResult messages by toolCallId, then renders user/assistant messages with full content block parsing (thinking, text, tool_use). Tool calls display with results pre-attached.

## Verification

- `npm run build` succeeds with no errors (both extension and webview)
- No new TypeScript errors introduced (all tsc errors are pre-existing)
- VSIX packages successfully (224KB)
- Session directory encoding verified against real session files
- Session listing tested against real JSONL files — correct id, timestamp, message count, first message extraction

## Deviations

None — executed as planned.

## Known Limitations

- No search/filter in session list (S02)
- No session naming UI (S02)  
- No session delete with confirmation dialog (S02)
- No keyboard navigation in session list (arrow keys — S02)
- Historical messages render text and tool calls but don't show token usage or cost from the historical session
- Could not verify in Extension Development Host due to VS Code CLI not being set up on this system — needs manual testing

## Follow-ups

- S02 will add search, naming, delete, and keyboard navigation
- Consider adding a loading indicator on the History button while fetching

## Files Created/Modified

- `src/extension/session-list-service.ts` — new: session directory resolution, JSONL parsing, listing
- `src/webview/session-history.ts` — new: overlay panel for browsing sessions
- `src/shared/types.ts` — added SessionListItem, 4 new webview→extension messages, 3 new extension→webview messages
- `src/extension/rpc-client.ts` — added switchSession(), setSessionName()
- `src/extension/webview-provider.ts` — added 4 message handlers, imported session service
- `src/webview/index.ts` — History button, panel element, message handlers, renderHistoricalMessages(), Escape handling
- `src/webview/styles.css` — session history panel styles (160+ lines)

## Forward Intelligence

### What the next slice should know
- The session history panel follows the exact same pattern as model-picker: `init()` with deps, `show()`/`hide()`/`toggle()`, click-outside handler, rendered into a positioned overlay div
- `updateSessions()` is the entry point for refreshing the list — call it whenever the list should be refreshed (e.g., after rename)
- `setCurrentSessionId()` must be called whenever the session changes so the highlight stays correct

### What's fragile
- The `renderHistoricalMessages` function handles the message format from `get_messages` RPC — if the format changes, both the content block parsing and toolResult matching would break
- Session directory encoding must exactly match GSD's regex — if GSD changes `getDefaultSessionDir`, our listing breaks silently (shows no sessions)

### Authoritative diagnostics
- Output panel (Rokket GSD) shows "[sessionId] Listed N sessions" and "[sessionId] Switched session, N messages" — check here first for debugging
- Session list service is pure functions with no state — easy to test in isolation

### What assumptions changed
- No assumptions changed — the RPC protocol and session file format matched expectations exactly
