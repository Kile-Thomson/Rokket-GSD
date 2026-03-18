---
id: M014
provides:
  - WorkerProgress type and AutoProgressData.workers/budgetAlert fields
  - readParallelWorkers() and readBudgetCeiling() pure filesystem readers
  - Parallel worker card grid rendering in auto-progress webview with state badges, budget bars, stale indicators
  - Budget alert VS Code warning toast at 80% threshold with duplicate prevention
  - validate-milestone phase rendering ("✓ VALIDATING") in auto-progress widget
  - "/gsd update" and "/gsd export" slash menu entries
  - gsd.exportReport VS Code command for HTML milestone report export
  - Discussion-pause visibility ("💬 AWAITING DISCUSSION" with /gsd discuss hint)
key_decisions:
  - Unknown worker state values default to "error" rather than throwing
  - budgetPercent computed by poller (not reader) — reader stays pure, poller owns budget ceiling lookup
  - Budget alert toast fires once per crossing, resets when all workers drop below 80%
  - Budget bar fill clamped to 100% width but color indicates overspend (red at >=100%)
  - 30s TTL cache for budget ceiling to avoid re-parsing preferences.md every 3s poll
  - Exported buildItems() from slash-menu.ts (@internal) for direct unit testing
  - Final poll on pause uses dashboard data only (skips full RPC model fetch, reuses lastModel)
patterns_established:
  - Dropbox conflicted copy filtering via /^[^(]+\.status\.json$/ filename pattern
  - Pure filesystem reader functions with null-return semantics for missing data
  - 30s TTL cache pattern for infrequently-changing config values
  - One-shot toast with boolean guard to prevent duplicates across poll cycles
  - Worker card HTML builder pattern with per-state CSS classes and budget threshold color changes
  - phaseIcon variable pattern for conditional phase-specific icons
  - classList.toggle for conditional CSS class on widget state transitions
observability_surfaces:
  - Output channel logs "Parallel workers: N" per poll when workers present
  - Output channel logs "Budget alert fired for: ..." on toast trigger
  - DOM .gsd-auto-progress-worker-card elements inside #autoProgressWidget
  - DOM .gsd-auto-progress-budget-alert badge when budgetAlert is true
  - DOM .stale class on worker cards with stale heartbeats
  - ".gsd-auto-progress-phase" span shows "✓ VALIDATING" for validate-milestone phase
  - ".gsd-auto-progress-discussion" class + ".gsd-auto-progress-hint" element for discussion-pause state
  - Command palette entry "Rokket GSD: Export Milestone Report"
requirement_outcomes: []
duration: ~85m
verification_result: passed
completed_at: 2026-03-19
---

# M014: gsd-pi 2.20–2.28 Feature Parity

**Full parity with gsd-pi v2.20–v2.28: parallel worker progress cards with budget alerts, validate-milestone phase rendering, new slash commands, HTML export command, model picker grouping, and discussion-pause visibility.**

## What Happened

Three slices brought the VS Code extension to parity with nine CLI releases (v2.20–v2.28).

**S01 (Parallel Worker Progress & Budget Alerts)** built the full parallel worker visibility feature. A new `parallel-status.ts` module provides two pure filesystem readers: `readParallelWorkers(cwd)` scans `.gsd/parallel/*.status.json` with Dropbox conflicted-copy filtering and corrupt-file skipping, and `readBudgetCeiling(cwd)` parses `budget_ceiling` from `.gsd/preferences.md`. The `AutoProgressPoller.poll()` loop was extended to call both readers, compute `budgetPercent = cost / budgetCeiling` per worker, and attach the results to `AutoProgressData`. A 30s TTL cache avoids re-parsing preferences on every 3s poll. A boolean guard (`lastBudgetAlertFired`) prevents duplicate toasts — the alert fires once when any worker crosses 80%, resets when all drop below. The webview renders a flex-wrap grid of worker cards showing milestone ID, state badge (Running/Paused/Stopped/Error with distinct colors), current unit, cost, and a budget bar with green→orange→red fill at 80%/100% thresholds. Stale workers are dimmed with a "(stale)" label. When `workers` is null, no worker UI renders — identical to pre-feature behavior. 37 tests cover reader edge cases and rendering.

**S02 (Validate-Milestone Phase & New Slash Commands)** added the `validate-milestone` phase rendering ("✓ VALIDATING" with checkmark icon), two new slash menu entries (`gsd update` and `gsd export`), and the `gsd.exportReport` VS Code command for HTML milestone report export from the command palette.

**S03 (Model Picker Grouping & Discussion Pause)** added discussion-pause visibility — when auto-mode pauses for slice discussion, the progress widget shows 💬 "AWAITING DISCUSSION" with a `/gsd discuss` hint instead of disappearing. Model picker grouping by provider was confirmed as already implemented from a prior milestone.

## Cross-Slice Verification

| Success Criterion | Status | Evidence |
|---|---|---|
| Parallel worker progress during parallel auto-mode | ✅ Met | `readParallelWorkers()` reads `.gsd/parallel/*.status.json`, worker cards render in webview. 20 reader tests + 17 rendering tests pass. |
| Budget alert fires at 80% threshold | ✅ Met | `lastBudgetAlertFired` guard in poller, `vscode.window.showWarningMessage` on crossing. Budget bar color changes at 80%/100%. |
| validate-milestone phase renders with distinct label and icon | ✅ Met | `formatPhase("validate-milestone")` returns "VALIDATING"; `phaseIcon` prepends "✓ ". Test passes. |
| `/gsd update` and `/gsd export --html --all` accessible from slash menu | ✅ Met | Both entries in `gsdSubcommands`. 2 slash-menu tests pass. |
| Model picker groups models by provider | ✅ Met (pre-existing) | `Map<string, AvailableModel[]>` grouping with provider section headers in model-picker.ts. |
| Discussion pause shows "Awaiting Discussion" state | ✅ Met | `isDiscussionPause` detection, 💬 icon, "AWAITING DISCUSSION" label, `/gsd discuss` hint. 8 tests pass. |
| HTML report export as VS Code command | ✅ Met | `gsd.exportReport` in package.json, `exportReport()` in webview-provider.ts. |
| No regressions | ✅ Met | 299 tests pass across 16 test files. Build clean (147KB extension, 332KB webview). |

## Requirement Changes

No formal requirements were tracked in REQUIREMENTS.md for this milestone.

## Forward Intelligence

### What the next milestone should know
- The `phaseIcon` pattern and `finalPollAndMaybeClear()` approach in auto-progress.ts are clean extension points for future phase-specific rendering.
- `buildItems()` export from slash-menu.ts makes adding and testing new slash commands straightforward.
- The poll loop in `auto-progress.ts` has a clear pattern for adding new filesystem reads: read → cache → compute → attach to progress data → send to webview.
- Model picker grouping was already done before M014 — verify features before planning.

### What's fragile
- `.gsd/parallel/*.status.json` filename filter uses `/^[^(]+\.status\.json$/` to reject Dropbox conflicted copies — any change to Dropbox's conflict naming pattern would need a regex update.
- Budget ceiling parsing is a simple line scan for `budget_ceiling:` in preferences.md — if the format gains YAML front matter or nested sections, the parser may need updating.
- Phase rendering relies on exact string matching in `formatPhase()` — if gsd-pi changes phase strings, rendering silently falls back to `.toUpperCase()`.

### Authoritative diagnostics
- `npx vitest run` — 299 tests, 16 files, all passing.
- GSD output channel shows `Parallel workers: N` on every poll cycle when workers are present.
- `#autoProgressWidget` in webview DevTools → `.gsd-auto-progress-worker-card` elements confirm rendering.

### What assumptions changed
- Model picker grouping was assumed to be a new M014 deliverable — it was already present from prior work.
- Original roadmap mentioned `.gsd/runtime/` for parallel worker state — actual gsd-pi uses `.gsd/parallel/*.status.json`.

## Files Created/Modified

- `src/shared/types.ts` — Added `WorkerProgress` interface and `workers`/`budgetAlert` fields to `AutoProgressData`
- `src/extension/parallel-status.ts` — New module with `readParallelWorkers()` and `readBudgetCeiling()` pure functions
- `src/extension/__tests__/parallel-status.test.ts` — 20 unit tests covering all reader edge cases
- `src/extension/auto-progress.ts` — Wired parallel readers into poll loop, added budget ceiling cache, alert guard, and output channel logging
- `src/webview/auto-progress.ts` — Added `buildWorkerCards()`, `formatWorkerState()`, `buildWorkerBudgetBar()`, validate-milestone phase, discussion-pause rendering
- `src/webview/__tests__/auto-progress.test.ts` — 17 new worker card tests + 9 prior tests (validate-milestone + discussion-pause)
- `src/webview/__tests__/slash-menu.test.ts` — 2 tests for slash menu entries
- `src/webview/slash-menu.ts` — Added `gsd update` and `gsd export` entries, exported `buildItems()`
- `src/webview/styles.css` — CSS for worker card grid, state badges, budget bar with threshold colors, discussion-pause styling
- `package.json` — Added `gsd.exportReport` command
- `src/extension/index.ts` — Registered `gsd.exportReport` command
- `src/extension/webview-provider.ts` — Added `exportReport()` method
