---
task: T03
title: Allow deleting current session in history panel
status: done
---

# T03: Allow deleting current session in history panel

## What Changed

- Removed the `if (!isCurrent)` guard on the delete button — all sessions now show delete
- Added `data-is-current` attribute to delete buttons for flow branching
- Updated `deleteSession()` to handle current session: shows different confirm message, then triggers `onNewConversation()` callback after delete
- Added `onNewConversation` to `SessionHistoryDeps` interface
- Wired `handleNewConversation` from index.ts as the callback

## Flow for current session delete

1. User clicks 🗑 on current session
2. Confirm dialog: "Delete current session? This will start a new conversation."
3. On confirm: sends `delete_session` to extension, hides history panel, calls `handleNewConversation()`
4. Extension deletes file, refreshes list
5. `handleNewConversation()` sends `new_conversation` to extension, clears entries, resets state

## Files Changed

- `src/webview/session-history.ts` — delete button guard removed, `deleteSession()` updated, new dep
- `src/webview/index.ts` — passes `handleNewConversation` to session history init

## Verification

- `npm run build` passes cleanly
