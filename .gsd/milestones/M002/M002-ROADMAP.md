# M002: Conversation History

**Vision:** Users can browse, search, and resume previous conversations from within the VS Code chat panel — session history is always one click away.

## Success Criteria

- User can open a session history panel and see all previous sessions for the current workspace
- Each session shows its name (or first message preview), relative timestamp, and message count
- Clicking a session switches to it — chat clears and loads that session's conversation
- User can search/filter sessions by text content
- User can name the current session from the history panel
- User can delete old sessions with confirmation
- History panel has keyboard navigation (arrow keys, Enter, Escape)

## Key Risks / Unknowns

- `switch_session` RPC behavior — unclear if it emits enough events for the webview to reconstruct the conversation, or if messages need to be explicitly fetched after switch — retire first
- Session file parsing performance — large files or many sessions could cause lag in listing

## Proof Strategy

- `switch_session` behavior → retire in S01 by proving a full switch flow works: list → select → switch → get_messages → render conversation
- Parsing performance → retire in S01 by testing with real session directory

## Verification Classes

- Contract verification: `npm run build` succeeds, new types compile, session list returns correct data from test files
- Integration verification: full switch flow exercised in Extension Development Host — list sessions, click one, see conversation load
- Operational verification: handles no-sessions state, corrupted files, concurrent new_session + list, session delete
- UAT / human verification: history panel looks good, keyboard nav feels natural, search is responsive

## Milestone Definition of Done

This milestone is complete only when all are true:

- All slices are complete and verified
- Extension builds cleanly and packages as VSIX
- Full history flow tested end-to-end: open history → browse → select → resume → chat continues
- Session naming, search, and delete all work
- Success criteria re-checked against live behavior

## Slices

- [x] **S01: Session List & Switch** `risk:high` `depends:[]`
  > After this: user can click a "History" button, see a list of previous sessions with metadata, click one to switch, and continue chatting in that session
- [x] **S02: Search, Name & Delete** `risk:medium` `depends:[S01]`
  > After this: user can search sessions by text, name/rename the current session, and delete old sessions with confirmation

## Boundary Map

### S01 → S02

Produces:
- `SessionListService` in extension host with `listSessions(cwd): Promise<SessionInfo[]>` and `deleteSession(path): Promise<void>`
- `SessionInfo` type in shared/types.ts: `{ path, id, name?, firstMessage, created, modified, messageCount }`
- Webview↔extension message types: `get_session_list`, `session_list`, `switch_session`, `session_switched`
- RPC client methods: `switchSession(path)`, `setSessionName(name)`
- Session history overlay panel in webview with basic list rendering and click-to-switch
- Header "History" button wired up

Consumes:
- nothing (first slice)
