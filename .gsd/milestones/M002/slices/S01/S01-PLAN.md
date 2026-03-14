# S01: Session List & Switch

**Goal:** User can open a history panel, see previous sessions, click one to switch, and continue chatting in the resumed session.
**Demo:** Click "History" in header → see session list with timestamps and previews → click a session → chat clears and loads that session → send a message and get a response in the resumed session.

## Must-Haves

- Session list service in extension host that reads JSONL files from `~/.gsd/agent/sessions/<encoded-cwd>/`
- `switchSession(path)` and `setSessionName(name)` methods on RPC client
- New message types in protocol: `get_session_list`, `session_list`, `switch_session`, `session_switched`
- Session history overlay panel in webview (similar to model-picker pattern)
- "History" button in header toolbar
- Click-to-switch flow: webview → extension → RPC switch_session → get_messages → re-render
- Current session highlighted in the list

## Proof Level

- This slice proves: integration
- Real runtime required: yes (Extension Development Host with real GSD process and session files)
- Human/UAT required: yes (visual check that sessions render correctly and switching works)

## Verification

- `npm run build` succeeds with no TypeScript errors
- In Extension Development Host: click History → session list appears with real sessions
- Click a previous session → conversation loads → can send new messages
- Click History again → current session is highlighted
- Press Escape → history panel closes
- Empty state shown when no sessions exist

## Observability / Diagnostics

- Runtime signals: session list service logs to GSD output channel — "Listed N sessions for <cwd>" on success, error details on failure
- Inspection surfaces: Output panel (Rokket GSD) shows session list/switch events
- Failure visibility: errors posted to webview as `{ type: "error" }` messages with descriptive text
- Redaction constraints: none (session paths are not secrets)

## Integration Closure

- Upstream surfaces consumed: GSD RPC `switch_session`, `set_session_name`, `get_state`, `get_messages` commands; session JSONL file format
- New wiring introduced in this slice: session-list-service.ts ↔ webview-provider.ts message routing ↔ webview session-history.ts overlay
- What remains before the milestone is truly usable end-to-end: search/filter, naming UI, delete (S02)

## Tasks

- [x] **T01: Session list service and types** `est:30m`
  - Why: Foundation — need the data layer and protocol types before building UI
  - Files: `src/extension/session-list-service.ts`, `src/shared/types.ts`, `src/extension/rpc-client.ts`
  - Do:
    1. Create `src/extension/session-list-service.ts` with:
       - `SessionInfo` interface: `{ path, id, name?, firstMessage, created: Date, modified: Date, messageCount }`
       - `getSessionDir(cwd: string): string` — computes `~/.gsd/agent/sessions/<encoded-cwd>/`
       - `listSessions(cwd: string): Promise<SessionInfo[]>` — reads all `.jsonl` files, parses header + first user message, returns sorted by modified desc
       - `deleteSession(sessionPath: string): Promise<void>` — deletes the file (for S02, but stub it now)
       - `buildSessionInfo(filePath: string): Promise<SessionInfo | null>` — parses a single session file
    2. Add `SessionInfo` to `src/shared/types.ts` (the webview-facing version, with string dates for serialization)
    3. Add new message types to `WebviewToExtensionMessage`: `get_session_list`, `switch_session { path }`, `rename_session { name }`
    4. Add new message types to `ExtensionToWebviewMessage`: `session_list { sessions: SessionInfo[] }`, `session_switched { state }`, `session_list_error { message }`
    5. Add `switchSession(sessionPath: string)` and `setSessionName(name: string)` methods to `rpc-client.ts`
  - Verify: `npm run build` succeeds
  - Done when: all types compile, session list service can be imported, RPC methods exist

- [x] **T02: Extension host message routing** `est:20m`
  - Why: Wire the session list service into the webview provider so messages flow correctly
  - Files: `src/extension/webview-provider.ts`
  - Do:
    1. Import `SessionListService` (or the standalone functions)
    2. Handle `get_session_list` message: call `listSessions(cwd)`, post `session_list` response to webview
    3. Handle `switch_session` message: call `rpcClient.switchSession(path)`, then `rpcClient.getState()` and `rpcClient.getMessages()` (via `get_messages` RPC), post results to webview as `session_switched`
    4. Handle `rename_session` message: call `rpcClient.setSessionName(name)`
    5. Log session operations to output channel
  - Verify: `npm run build` succeeds
  - Done when: all three message handlers are wired and compile

- [x] **T03: Session history overlay panel** `est:45m`
  - Why: The user-facing UI — this is what makes sessions browsable and switchable
  - Files: `src/webview/session-history.ts`, `src/webview/index.ts`, `src/webview/styles.css`
  - Do:
    1. Create `src/webview/session-history.ts` following model-picker pattern:
       - `show(sessions, currentSessionId)` — renders overlay with session list
       - `hide()` — removes overlay
       - `isVisible()` — returns boolean
       - Each session item shows: name or first message (truncated), relative time ("2 hours ago"), message count badge
       - Current session highlighted with accent color
       - Click handler sends `switch_session` message to extension
       - Escape key closes the panel
       - Empty state: "No previous sessions" message
    2. In `index.ts`:
       - Add "History" button to header (between Export and Model buttons)
       - Handle `session_list` message: pass data to session-history.show()
       - Handle `session_switched` message: clear chat entries, process messages from the switched session, hide history panel
       - Wire History button click: send `get_session_list` to extension
    3. In `styles.css`:
       - Add styles for session history overlay (reuse/extend model-picker overlay pattern)
       - Session item styles: preview text, timestamp, message count badge, hover state, active/current highlight
  - Verify: `npm run build` succeeds; in Extension Development Host, History button appears, clicking it shows session list, clicking a session switches to it
  - Done when: full click-to-switch flow works end-to-end in Extension Development Host

- [x] **T04: Session switch conversation rendering** `est:25m`
  - Why: After switching sessions, the chat must display the conversation history — not just a blank screen
  - Files: `src/webview/index.ts`, `src/webview/renderer.ts`, `src/extension/webview-provider.ts`
  - Do:
    1. After `switch_session` succeeds, call `get_messages` RPC to get the full message history
    2. In webview, handle the `session_switched` message:
       - Clear all existing entries from state and DOM
       - Parse the message array into ChatEntry objects (user messages, assistant turns with segments)
       - Render each entry using existing renderer functions
       - Scroll to bottom
       - Update header badges (model, thinking level, etc.) from the new state
    3. Handle edge cases: empty session (no messages), session with only tool calls, session with compaction markers
  - Verify: In Extension Development Host, switch to a session with conversation history → all messages render correctly (user messages, assistant responses with markdown, tool calls)
  - Done when: switched session's conversation is fully visible and correctly rendered, new messages can be sent

## Files Likely Touched

- `src/extension/session-list-service.ts` (new)
- `src/extension/rpc-client.ts`
- `src/extension/webview-provider.ts`
- `src/shared/types.ts`
- `src/webview/session-history.ts` (new)
- `src/webview/index.ts`
- `src/webview/renderer.ts`
- `src/webview/styles.css`
