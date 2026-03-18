# S03: Model Picker Grouping & Discussion Pause — Research

**Date:** 2026-03-19
**Depth:** Light research — both features use established patterns already in the codebase.

## Summary

This slice has two deliverables: (1) model picker grouped by provider, and (2) discussion-pause visibility in the progress widget. The model picker **already groups by provider** — `model-picker.ts` builds a `Map<string, AvailableModel[]>` keyed by provider, renders `gsd-model-picker-group` containers with `gsd-model-picker-provider` headers, and the CSS is fully styled. No work needed there.

The discussion-pause detection is partially done. `formatPhase()` in the webview auto-progress already maps `needs-discussion` → `"DISCUSS"`, and `dashboard.ts`/`visualizer.ts` map `discussing` → `"Discussing"`. What's missing is: (a) a distinct "Awaiting Discussion" visual state instead of the generic `"DISCUSS"` label, (b) a prompt to use `/gsd discuss` in the progress widget, and (c) keeping the progress widget visible during the discussion pause (currently the poller stops on `"paused"` state, which hides the widget).

## Recommendation

Since the model picker is already complete, focus entirely on the discussion-pause UX. The work is small:

1. In `src/webview/auto-progress.ts`, detect `phase === "needs-discussion"` during render and show a distinct "Awaiting Discussion" state with a hint to use `/gsd discuss`.
2. In `src/extension/auto-progress.ts`, decide whether `needs-discussion` arrives via the phase (from STATE.md polling) or via the `autoState` (from `setStatus`). Based on the codebase, the phase comes from STATE.md via `parsePhase()` in `state-parser.ts`, while autoState comes from `setStatus` events. When `require_slice_discussion` triggers, gsd-pi likely sets the phase in STATE.md to `needs-discussion` and may also set `autoState` to `"paused"`. The poller currently stops on `"paused"`, hiding the widget. The fix: when `autoState` is `"paused"`, still do one final poll to capture the phase, then display a static "Awaiting Discussion" state.
3. Add unit tests following the existing patterns in `src/webview/__tests__/auto-progress.test.ts`.

## Implementation Landscape

### Key Files

- `src/webview/auto-progress.ts` — Webview-side progress widget. `formatPhase()` already handles `needs-discussion` → `"DISCUSS"`. Needs enhancement: when `phase === "needs-discussion"`, render a distinct "Awaiting Discussion" state with `/gsd discuss` hint instead of the generic phase label. Also needs a new mode icon (e.g., `💬`) for the discussion-paused state.
- `src/extension/auto-progress.ts` — Extension-side poller. Currently stops polling and clears the widget when `autoState` becomes `"paused"`. Needs a change: when state transitions to `"paused"`, do one final poll before clearing. Or better: keep the widget visible with `autoState: "paused"` + `phase: "needs-discussion"` data so the webview can render the discussion state. The simplest approach is to modify `onAutoModeChanged()` so that `"paused"` stops the interval but sends a final progress snapshot instead of calling `sendClear()`.
- `src/webview/__tests__/auto-progress.test.ts` — Existing test file with `makeProgressData()` helper. Add tests for the discussion-pause rendering.
- `src/shared/types.ts` — `AutoProgressData` interface. No changes needed — `autoState: "paused"` + `phase: "needs-discussion"` already representable with existing fields.
- `src/webview/model-picker.ts` — **Already complete.** Groups models by provider with section headers, arrow-key navigation across groups, CSS styled. No changes needed.
- `src/webview/styles.css` — May need a small CSS addition for the discussion-pause visual state (e.g., a `.gsd-auto-progress-discussion` class with distinct styling).

### Build Order

1. **Extension poller: keep widget visible on pause** — Modify `onAutoModeChanged()` in `src/extension/auto-progress.ts` so that when `autoState` transitions to `"paused"`, it does one final poll (capturing the current phase from STATE.md) and posts that data to the webview instead of clearing. This unblocks the webview rendering.
2. **Webview: "Awaiting Discussion" rendering** — In `src/webview/auto-progress.ts`, detect `autoState === "paused" && phase === "needs-discussion"` and render a distinct visual: swap mode icon to `💬`, show "AWAITING DISCUSSION" as phase, add a hint line "Use /gsd discuss to continue". Stop the elapsed timer in this state.
3. **CSS for discussion state** — Add minimal CSS for the hint text styling.
4. **Tests** — Add test cases to `auto-progress.test.ts` for the discussion-pause state rendering.
5. **Model picker verification** — Confirm existing model picker tests pass (or add a basic test if none exist). The model picker grouping is already implemented; this is just validation.

### Verification Approach

- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — Verify discussion-pause rendering tests pass.
- Create a model picker test file if one doesn't exist, or verify by code inspection that grouping works (it does — the `byProvider` Map logic is clear).
- Manual verification: set `.gsd/STATE.md` phase to `needs-discussion` during an auto-mode session and confirm the progress widget shows "Awaiting Discussion" with the `/gsd discuss` prompt.
- `npx vitest run` — Full test suite, no regressions.

## Constraints

- The extension poller currently has a strict lifecycle: `autoState === "paused"` → stop polling → clear widget. Changing this must not break the normal pause/resume flow (e.g., user manually pausing auto-mode should still show the paused icon, not a discussion state).
- S01's parallel worker additions (on `milestone/M014` branch but not yet on HEAD) add `workers` and `budgetAlert` fields to `AutoProgressData` and worker card rendering to the webview. S03 changes must be compatible with these additions. Since S03 only touches the phase rendering and poller lifecycle (not worker cards), there's no conflict.
- The model picker is fully implemented — do not modify it. Any "model picker" task in this slice should be a verification-only task.

## Common Pitfalls

- **Breaking normal pause behavior** — If the poller is changed to keep the widget visible on all pauses, a normal user-initiated pause would incorrectly show a progress widget. The fix: only keep the widget visible when the *phase* is `needs-discussion`, not on every pause. Check `phase` in the final poll data before deciding whether to display or clear.
- **Stale discussion state** — If the user runs `/gsd discuss` and auto-mode resumes, the progress widget must transition back to the normal auto-mode display. The existing `onAutoModeChanged("auto")` flow handles this — it restarts polling, which will pick up the new phase.
