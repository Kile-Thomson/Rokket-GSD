---
estimated_steps: 6
estimated_files: 3
---

# T01: Implement discussion-pause visibility in progress widget

**Slice:** S03 — Model Picker Grouping & Discussion Pause
**Milestone:** M014

## Description

When `require_slice_discussion` pauses auto-mode, the progress widget currently disappears because `onAutoModeChanged("paused")` calls `stopPolling()` then `sendClear()`. This task modifies both the extension-side poller and webview-side renderer so that when the phase is `needs-discussion`, the widget stays visible with a distinct "Awaiting Discussion" state showing a `/gsd discuss` prompt.

Key constraint: normal user-initiated pauses (where phase is NOT `needs-discussion`) must still clear the widget. Only the discussion-pause phase keeps it visible.

## Steps

1. **Extension poller: final poll on pause** — In `src/extension/auto-progress.ts`, modify `onAutoModeChanged()`. When state transitions to `"paused"` or `undefined` (stopped), instead of immediately calling `sendClear()`, do one final synchronous-style poll. Read the dashboard data (same as `poll()` does) to get the current phase. If `phase === "needs-discussion"`, build an `AutoProgressData` object with `autoState: "paused"` and post it to the webview. Otherwise, call `sendClear()` as before. Stop the polling interval in both cases. Add a log line: `[sessionId] Auto-progress: discussion pause detected, keeping widget visible`.

2. **Webview render: discussion-pause state** — In `src/webview/auto-progress.ts`, modify the `render()` function. After the existing `modeIcon` logic, add a check: if `data.autoState === "paused" && data.phase === "needs-discussion"`, set `modeIcon = "💬"` and override the phase display. Add a `isDiscussionPause` boolean. When true:
   - Set mode icon to `💬`
   - `formatPhase()` already returns `"DISCUSS"` for `needs-discussion` — change this to return `"AWAITING DISCUSSION"` instead
   - Stop the elapsed timer (clear `elapsedTimer` interval and don't start a new one)
   - Add a `.gsd-auto-progress-discussion` class to the widget element
   - Add a hint line after the main row: `<div class="gsd-auto-progress-hint">Use /gsd discuss to continue</div>`

3. **Update `formatPhase()`** — Change the `needs-discussion` case from `return "DISCUSS"` to `return "AWAITING DISCUSSION"`.

4. **CSS for discussion state** — In `src/webview/styles.css`, add styles:
   - `.gsd-auto-progress-discussion` — maybe a subtle border-left or background tint to distinguish from normal state
   - `.gsd-auto-progress-hint` — smaller font, muted color, padding to match the layout

5. **Handle the pulse animation** — When in discussion-pause state, stop the pulse animation (the green dot). Add logic to hide `.gsd-auto-progress-pulse` when `isDiscussionPause` is true (set `display: none` on the pulse span, or omit it from the HTML).

6. **Verify existing tests still pass** — Run `npx vitest run src/webview/__tests__/auto-progress.test.ts` to confirm no regressions.

## Must-Haves

- [ ] `onAutoModeChanged("paused")` does a final poll to check the phase before deciding to clear
- [ ] When phase is `needs-discussion` during pause, widget stays visible with `autoState: "paused"` data
- [ ] Widget renders 💬 icon, "AWAITING DISCUSSION" label, and "/gsd discuss" hint
- [ ] Normal pause (phase is not `needs-discussion`) still clears the widget
- [ ] Elapsed timer stops during discussion-pause state
- [ ] Pulse animation stops during discussion-pause state

## Verification

- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — existing tests pass (no regressions)
- Manual code review: `onAutoModeChanged()` shows the final-poll logic
- Manual code review: `render()` shows the discussion-pause branch

## Inputs

- `src/extension/auto-progress.ts` — `AutoProgressPoller` class with `onAutoModeChanged()`, `poll()`, `sendClear()`, `postToWebview()` methods. The `poll()` method shows how to build `AutoProgressData` from dashboard data and RPC state. Knowledge entry K6: auto-mode state comes from `setStatus` events with values `"auto"`, `"next"`, `"paused"`, or `undefined`.
- `src/webview/auto-progress.ts` — `render()` function builds HTML with mode icon, phase label, target line, progress bars, stats, and worker cards. `formatPhase()` maps phase strings to display labels. `update()` sets `state.autoProgress` and calls `render()`.
- `src/webview/styles.css` — existing `.gsd-auto-progress-*` classes starting around line 4532.
- `src/shared/types.ts` — `AutoProgressData` interface. Fields `autoState` (string) and `phase` (string) are already present — no type changes needed.

## Observability Impact

- **New log signal:** `[sessionId] Auto-progress: discussion pause detected, keeping widget visible` — emitted by `AutoProgressPoller.onAutoModeChanged()` when pause is caused by `needs-discussion` phase. Absence of this line when the widget disappears on discussion pause indicates the final-poll logic failed.
- **DOM surface:** `.gsd-auto-progress-discussion` class on the widget element — inspectable via DevTools to confirm discussion-pause state is active.
- **DOM surface:** `.gsd-auto-progress-hint` element with text "Use /gsd discuss to continue" — visible to the user and inspectable.
- **Failure visibility:** If the widget clears during a discussion pause, the log line above will be absent and `.gsd-auto-progress-discussion` will not appear in the DOM.

## Expected Output

- `src/extension/auto-progress.ts` — `onAutoModeChanged()` modified to do a final poll on pause and conditionally keep widget visible for `needs-discussion` phase
- `src/webview/auto-progress.ts` — `render()` enhanced with discussion-pause branch; `formatPhase()` updated to return "AWAITING DISCUSSION"
- `src/webview/styles.css` — new `.gsd-auto-progress-discussion` and `.gsd-auto-progress-hint` CSS rules
