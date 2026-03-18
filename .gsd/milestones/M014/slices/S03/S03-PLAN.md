# S03: Model Picker Grouping & Discussion Pause

**Goal:** When `require_slice_discussion` pauses auto-mode, the progress widget shows a distinct "Awaiting Discussion" state with a prompt to use `/gsd discuss`. The model picker groups models by provider (already implemented — verification only).

**Demo:** During auto-mode, when the phase transitions to `needs-discussion`, the progress widget stays visible showing 💬 "AWAITING DISCUSSION" with a hint line "Use /gsd discuss to continue" instead of disappearing. When auto-mode resumes, the widget transitions back to normal progress display. The model picker shows provider section headers grouping models.

## Must-Haves

- Progress widget stays visible when auto-mode pauses for discussion (`autoState: "paused"` + `phase: "needs-discussion"`)
- Widget shows 💬 icon, "AWAITING DISCUSSION" phase label, and "/gsd discuss" hint text
- Elapsed timer stops during discussion-pause state
- Normal pause behavior (user-initiated) still clears the widget — only `needs-discussion` phase keeps it visible
- Resuming auto-mode after discussion transitions back to normal progress display
- Model picker groups models by provider with section headers (already done — just verify)

## Proof Level

- This slice proves: contract + integration
- Real runtime required: no (unit tests cover rendering and poller behavior)
- Human/UAT required: yes (visual check of discussion-pause state against live gsd-pi)

## Verification

- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — discussion-pause rendering tests pass
- `npx vitest run` — full test suite, no regressions
- Code inspection confirms model picker grouping is already implemented in `model-picker.ts`

## Observability / Diagnostics

- Runtime signals: `AutoProgressPoller` logs `[sessionId] Auto-progress: discussion pause detected, keeping widget visible` when entering discussion state
- Inspection surfaces: progress widget DOM — `.gsd-auto-progress-discussion` class present, hint text visible
- Failure visibility: if widget clears on discussion pause, the log line above will be absent

## Integration Closure

- Upstream surfaces consumed: `src/extension/auto-progress.ts` (poller lifecycle), `src/webview/auto-progress.ts` (render), `src/shared/types.ts` (AutoProgressData — no changes needed)
- New wiring introduced in this slice: conditional keep-alive in `onAutoModeChanged()` that does a final poll before deciding whether to clear
- What remains before the milestone is truly usable end-to-end: nothing — this is the final slice in M014

## Tasks

- [ ] **T01: Implement discussion-pause visibility in progress widget** `est:45m`
  - Why: When `require_slice_discussion` pauses auto-mode, the widget currently disappears because `onAutoModeChanged("paused")` calls `sendClear()`. Need to keep the widget visible with a distinct "Awaiting Discussion" state showing a `/gsd discuss` prompt.
  - Files: `src/extension/auto-progress.ts`, `src/webview/auto-progress.ts`, `src/webview/styles.css`
  - Do: (1) In `AutoProgressPoller.onAutoModeChanged()`, when state becomes `"paused"` (or undefined/stopped), do one final poll before clearing. If the polled phase is `"needs-discussion"`, post the progress data with `autoState: "paused"` to the webview instead of clearing. Otherwise, clear as normal. (2) In webview `render()`, detect `autoState === "paused" && phase === "needs-discussion"` and render a distinct state: swap mode icon to `💬`, show "AWAITING DISCUSSION" as phase, add a hint line below with "Use /gsd discuss to continue", stop the elapsed timer, add `.gsd-auto-progress-discussion` class. (3) Add minimal CSS for the hint text and discussion state styling.
  - Verify: `npx vitest run src/webview/__tests__/auto-progress.test.ts` (existing tests still pass)
  - Done when: The render function produces 💬 icon, "AWAITING DISCUSSION" label, and `/gsd discuss` hint when given `autoState: "paused"` + `phase: "needs-discussion"` data. Normal pause (non-discussion) still clears the widget.

- [ ] **T02: Add discussion-pause tests and verify model picker grouping** `est:30m`
  - Why: Need test coverage for the discussion-pause rendering, and need to verify that model picker grouping (already implemented) works correctly.
  - Files: `src/webview/__tests__/auto-progress.test.ts`, `src/webview/model-picker.ts`
  - Do: (1) Add test cases to `auto-progress.test.ts`: discussion pause shows widget with 💬 icon and "AWAITING DISCUSSION" label; discussion pause shows "/gsd discuss" hint; discussion pause has `.gsd-auto-progress-discussion` class; normal pause (non-discussion phase) hides widget; elapsed timer element has no active timestamp during discussion pause. Use the existing `makeProgressData()` helper with `{ autoState: "paused", phase: "needs-discussion" }`. (2) Verify model picker grouping by code inspection — confirm `model-picker.ts` builds `Map<string, AvailableModel[]>` and renders `gsd-model-picker-group` with `gsd-model-picker-provider` headers. (3) Run full test suite to confirm no regressions.
  - Verify: `npx vitest run` — all tests pass including new discussion-pause tests
  - Done when: At least 4 new test cases pass covering discussion-pause rendering. Full test suite green.

## Files Likely Touched

- `src/extension/auto-progress.ts`
- `src/webview/auto-progress.ts`
- `src/webview/styles.css`
- `src/webview/__tests__/auto-progress.test.ts`
