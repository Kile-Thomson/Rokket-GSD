# S02: Search, Name & Delete

**Goal:** User can search sessions by text, name/rename the current session, and delete old sessions with confirmation.
**Demo:** Type in a search box to filter sessions → rename current session → delete an old session with confirm dialog → keyboard navigate the list with arrow keys.

## Must-Haves

- Search/filter input in session history panel header
- Filter sessions by name and first message text (case-insensitive)
- Rename current session button/action in the history panel
- Delete session with confirmation dialog
- Keyboard navigation in session list (arrow keys, Enter to select, Escape to close)

## Proof Level

- This slice proves: integration
- Real runtime required: yes
- Human/UAT required: yes

## Verification

- `npm run build` succeeds with no TypeScript errors
- Search filters sessions correctly as user types
- Rename updates the session name and persists across panel reopens
- Delete removes the session file and refreshes the list
- Arrow keys navigate the session list, Enter selects

## Tasks

- [x] **T01: Search filter and keyboard navigation** `est:30m`
  - Why: Core UX improvements — search makes large lists usable, keyboard nav makes the panel efficient
  - Files: `src/webview/session-history.ts`, `src/webview/styles.css`
  - Do:
    1. Add search input to session history header (below title, above list)
    2. Filter sessions by matching name and firstMessage against search text (case-insensitive includes)
    3. Add keyboard navigation: arrow up/down moves highlight, Enter selects highlighted session, Escape closes
    4. Track highlighted index in module state, render highlight class on the active item
    5. Auto-focus search input when panel opens
    6. Clear search when panel closes
    7. Style the search input to match VS Code theme
  - Verify: `npm run build` succeeds; search filters correctly; arrow keys navigate
  - Done when: search filtering and keyboard navigation work

- [x] **T02: Rename session and delete with confirmation** `est:25m`
  - Why: Session management — naming helps identify sessions, delete keeps the list clean
  - Files: `src/webview/session-history.ts`, `src/webview/index.ts`, `src/webview/styles.css`
  - Do:
    1. Add rename icon/button on the current session item in the list
    2. Clicking rename shows an inline text input replacing the preview text
    3. Enter confirms rename (sends `rename_session` message), Escape cancels
    4. After rename, refresh the session list to show the new name
    5. Add delete icon/button on non-current session items (trash icon, small, right-aligned)
    6. Clicking delete shows a confirm dialog ("Delete this session? This cannot be undone.")
    7. On confirm, send `delete_session` message — the extension handler already auto-refreshes the list
    8. Style rename input and delete button to be unobtrusive (show on hover)
  - Verify: `npm run build` succeeds; rename persists; delete removes and refreshes
  - Done when: rename and delete both work end-to-end

## Files Likely Touched

- `src/webview/session-history.ts`
- `src/webview/index.ts`
- `src/webview/styles.css`
