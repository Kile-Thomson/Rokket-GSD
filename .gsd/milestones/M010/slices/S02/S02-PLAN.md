# S02: Resume Last Session

**Goal:** Let users resume their most recent conversation with one click or slash command.
**Demo:** On fresh extension launch, a "Resume last session" button appears on the welcome screen. `/resume` in the slash menu switches to the most recent session.

## Must-Haves

- "Resume last session" button on welcome/empty state
- `/resume` slash command
- Uses existing session-list-service to find most recent session
- Graceful no-op when no previous sessions exist

## Verification

- `npm run build` succeeds
- `npm test` passes
- `npm run lint` passes

## Tasks

- [ ] **T01: Resume last session — button + slash command** `est:45m`
  - Why: Users currently have to open session history and find their last session manually
  - Files: `src/webview/slash-menu.ts`, `src/webview/dashboard.ts`, `src/webview/message-handler.ts`, `src/webview/styles.css`
  - Do: Add `/resume` to slash commands that sends a `resume_last_session` message. Add "Resume last session" button to welcome screen. Wire the message to switch_session with the most recent session path.
  - Verify: `npm run build && npm run lint && npm test`
  - Done when: button and slash command both trigger session resume

## Files Likely Touched

- `src/webview/slash-menu.ts`
- `src/webview/dashboard.ts`
- `src/extension/webview-provider.ts`
- `src/webview/styles.css`
