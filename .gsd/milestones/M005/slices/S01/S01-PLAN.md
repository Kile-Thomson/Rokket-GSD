# S01: Thinking Dropdown + History Delete

**Goal:** Replace the blind thinking-level cycling button with a model-aware dropdown picker. Allow deleting the current session from history (auto-creates new session).
**Demo:** Click thinking badge → dropdown shows available levels for current model. Click a level → it's applied. Switch to non-reasoning model → thinking control is hidden/disabled. Open history → delete current session → conversation clears and fresh session starts.

## Must-Haves

- Thinking dropdown overlay (follows model-picker pattern: click to open, click outside to close)
- Dropdown shows only levels available for current model (derived from `reasoning` boolean)
- Active level is visually highlighted
- Non-reasoning models: badge shows "N/A" or is hidden, dropdown disabled
- Delete button on current session in history panel
- Deleting current session: sends `delete_session`, then triggers `new_conversation`
- All interactions work at sidebar widths ≥300px

## Proof Level

- This slice proves: integration
- Real runtime required: yes (Extension Development Host with GSD running)
- Human/UAT required: yes (visual verification of dropdown behavior and delete flow)

## Verification

- Build: `npm run build` passes with no errors
- Visual: thinking dropdown opens/closes correctly in Extension Development Host
- Visual: switching to a non-reasoning model hides or disables thinking control
- Visual: deleting current session clears chat and starts fresh
- Functional: `set_thinking_level` RPC is called (verify in Output panel log)

## Tasks

- [x] **T01: Create thinking dropdown picker module** `est:45m`
  - Why: Core new UI component — replaces the cycling click handler
  - Files: `src/webview/thinking-picker.ts`, `src/webview/styles.css`
  - Do: 
    - Create `thinking-picker.ts` following model-picker.ts overlay pattern
    - Show 6 levels (off, minimal, low, medium, high, xhigh) with descriptions
    - Highlight active level with dot indicator
    - Filter: if model has `reasoning: false`, show only "off" or disable entirely
    - If model has `reasoning: true`, show standard 5 levels (off through high); show xhigh only if model ID contains "opus" (matching supportsXhigh logic)
    - Call `set_thinking_level` directly instead of `cycle_thinking_level`
    - Click outside closes, Escape closes
    - Position relative to thinking badge (same as model picker positioning)
  - Verify: `npm run build` passes, module exports init/show/hide/isVisible
  - Done when: thinking-picker.ts compiles and follows the established overlay pattern

- [x] **T02: Wire thinking dropdown into index.ts and update header UI** `est:30m`
  - Why: Replace the cycling handler with the new dropdown, make badge model-aware
  - Files: `src/webview/index.ts`, `src/webview/state.ts`
  - Do:
    - Import thinking-picker, init it with dependencies
    - Replace `thinkingBadge.addEventListener("click", cycle)` with `thinkingBadge.addEventListener("click", thinkingPicker.toggle)`
    - Remove the `cycle_thinking_level` message send from index.ts
    - In `updateHeaderUI()`: if current model has `reasoning: false` (check `state.availableModels` for current model), show badge as disabled/dim with "N/A" text. If no model info yet, show badge normally (will update once model info arrives)
    - Handle `thinking_level_changed` response from extension — update dropdown if visible
    - Add thinking dropdown container element to DOM layout (like model picker)
  - Verify: Build passes, clicking badge opens dropdown instead of cycling
  - Done when: Thinking badge opens dropdown, level selection sends `set_thinking_level` to extension

- [x] **T03: Allow deleting current session in history panel** `est:25m`
  - Why: Users can't delete the active session — it just accumulates forever
  - Files: `src/webview/session-history.ts`, `src/webview/index.ts`
  - Do:
    - In `renderList()`: remove the `if (!isCurrent)` guard on the delete button — show it for all sessions
    - For current session delete: after confirming, send `delete_session` message, then trigger new conversation (post `new_conversation` message and clear local state)
    - Wire an `onNewConversation` callback into session-history init deps so it can trigger the new-conversation flow after delete
    - Update confirm dialog text for current session: "Delete current session? This will start a new conversation."
  - Verify: Build passes, can delete current session from history panel, chat clears
  - Done when: Delete button appears on all sessions, deleting current session starts fresh conversation

- [ ] **T04: Build and verify end-to-end** `est:20m`
  - Why: Ensure both features work together in a real Extension Development Host session
  - Files: (none — verification task)
  - Do:
    - Run `npm run build`
    - Launch Extension Development Host
    - Verify thinking dropdown: open, select levels, check model awareness
    - Verify history delete: create sessions, delete non-current, delete current
    - Verify no regressions: model picker still works, slash menu still works, streaming still works
  - Verify: All interactions work correctly in Extension Development Host
  - Done when: Both features work end-to-end with no regressions

## Files Likely Touched

- `src/webview/thinking-picker.ts` (new)
- `src/webview/index.ts`
- `src/webview/session-history.ts`
- `src/webview/state.ts`
- `src/webview/styles.css`
