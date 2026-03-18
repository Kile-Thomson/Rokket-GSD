---
id: M014
provides:
  - validate-milestone phase rendering ("✓ VALIDATING") in auto-progress widget
  - "/gsd update" and "/gsd export" slash menu entries
  - gsd.exportReport VS Code command for HTML milestone report export
  - Discussion-pause visibility ("💬 AWAITING DISCUSSION" with /gsd discuss hint)
key_decisions:
  - Exported buildItems() from slash-menu.ts (@internal) for direct unit testing of menu entries
  - Final poll on pause uses dashboard data only (skips full RPC model fetch, reuses lastModel)
patterns_established:
  - phaseIcon variable pattern for conditional phase-specific icons in auto-progress render
  - classList.toggle for conditional CSS class on widget state transitions
  - exportReport() follows same session-iteration pattern as newConversation()
observability_surfaces:
  - ".gsd-auto-progress-phase" span shows "✓ VALIDATING" for validate-milestone phase
  - ".gsd-auto-progress-discussion" class + ".gsd-auto-progress-hint" element for discussion-pause state
  - Log line "[sessionId] Auto-progress: discussion pause detected, keeping widget visible"
  - buildItems() export for test verification of slash menu contents
  - Command palette entry "Rokket GSD: Export Milestone Report"
requirement_outcomes: []
duration: ~45m (S02 15m + S03 25m; S01 code not delivered)
verification_result: partial
completed_at: 2026-03-19
---

# M014: gsd-pi 2.20–2.28 Feature Parity

**Partial parity: validate-milestone phase, new slash commands, export command, and discussion-pause visibility delivered. Parallel worker progress (S01) — the highest-risk slice — has summary artifacts claiming completion but zero source code committed.**

## What Happened

This milestone targeted parity with gsd-pi v2.20–v2.28 across three slices. Two of three delivered working code; one did not.

**S01 (Parallel Worker Progress & Budget Alerts)** has a detailed summary claiming three tasks completed with `parallel-status.ts`, `WorkerProgress` type, worker card rendering, and 14 unit tests. However, verification reveals **none of this code exists in the repository**. No `parallel-status.ts` file, no `WorkerProgress` interface in `types.ts`, no worker card rendering in the webview, no parallel-status tests. Git history confirms no S01-related commits were ever made on the milestone branch. The S01 summary was fabricated or the code was lost before commit. This is the single biggest deliverable of the milestone (parallel worker visibility during parallel auto-mode) and it is entirely missing.

**S02 (Validate-Milestone Phase & New Slash Commands)** delivered cleanly. The `validate-milestone` phase renders as "✓ VALIDATING" with a checkmark icon via a `phaseIcon` variable in the auto-progress renderer. Two new slash menu entries (`gsd update` with `sendOnSelect: true` for immediate execution, `gsd export` without `sendOnSelect` for argument appending) were added. The `gsd.exportReport` VS Code command was registered in `package.json` and implemented in `webview-provider.ts` using the same session-iteration pattern as `newConversation()`. Two slash-menu unit tests and one auto-progress test verify the new functionality.

**S03 (Model Picker Grouping & Discussion Pause)** delivered the discussion-pause feature but confirmed that model picker grouping was already implemented. The auto-progress poller gained a `finalPollAndMaybeClear()` method that reads dashboard state one final time when auto-mode pauses. If the phase is `needs-discussion`, it keeps the widget visible with 💬 icon, "AWAITING DISCUSSION" label, yellow accent styling, and a hint directing users to `/gsd discuss`. Eight new tests cover the discussion-pause rendering. The model picker was already grouping by provider with section headers from a prior milestone — S03 confirmed this via code inspection rather than building it.

## Cross-Slice Verification

| Success Criterion | Status | Evidence |
|---|---|---|
| Parallel worker progress during parallel auto-mode | ❌ **NOT MET** | No source code exists. `parallel-status.ts`, `WorkerProgress` type, worker card rendering, and 14 unit tests claimed in S01 summary are absent from git history. |
| Budget alert fires at 80% threshold | ❌ **NOT MET** | Part of S01, no code committed. |
| validate-milestone phase renders with distinct label and icon | ✅ Met | `formatPhase("validate-milestone")` returns "VALIDATING"; `phaseIcon` prepends "✓ ". Test passes in auto-progress.test.ts. |
| `/gsd update` and `/gsd export --html --all` accessible from slash menu | ✅ Met | Both entries in `gsdSubcommands`. 2 slash-menu tests pass. |
| Model picker groups models by provider | ✅ Met (pre-existing) | `Map<string, AvailableModel[]>` grouping with provider section headers exists in model-picker.ts — confirmed present before M014 started. |
| Discussion pause shows "Awaiting Discussion" state | ✅ Met | `isDiscussionPause` detection, 💬 icon, "AWAITING DISCUSSION" label, `/gsd discuss` hint, yellow accent CSS. 8 tests pass. |
| HTML report export as VS Code command | ✅ Met | `gsd.exportReport` in package.json contributes.commands, `exportReport()` in webview-provider.ts. |
| No regressions | ✅ Met | 262 tests pass across 15 test files. Build clean (143KB extension, 329KB webview). |

**Overall: 5 of 7 unique criteria met. The parallel worker feature (2 criteria) is entirely missing.**

## Definition of Done Assessment

- ❌ Not all slice deliverables are complete — S01's code was never committed
- ✅ validate-milestone phase displays distinctly
- ✅ All new slash commands work
- ✅ Model picker groups by provider (pre-existing)
- ✅ Discussion pause visible in progress widget
- ✅ No regressions in existing tests
- ❌ Cannot re-check against live gsd-pi 2.28.0 — S01 feature missing

## Requirement Changes

No formal requirements were tracked in REQUIREMENTS.md for this milestone.

## Forward Intelligence

### What the next milestone should know
- **S01 must be re-done.** The parallel worker progress feature (`.gsd/parallel/*.status.json` parsing, `WorkerProgress` type, worker card rendering, budget alerts) needs to be built from scratch. The S01 plan and research artifacts describe the intended design accurately — the code just was never committed.
- Model picker grouping was already done before M014. If a future milestone lists it as a deliverable, verify first.
- The `phaseIcon` pattern and `finalPollAndMaybeClear()` approach in auto-progress.ts are clean extension points for future phase-specific rendering.
- `buildItems()` export from slash-menu.ts makes adding and testing new slash commands straightforward.

### What's fragile
- S01's detailed summary (claiming 14 tests, three tasks, specific code patterns) was entirely fabricated. Task summaries and verify.json files exist in `.gsd/` but the corresponding source code was never committed. Future milestone closers must verify code actually exists, not just trust summary artifacts.
- Phase rendering relies on exact string matching in `formatPhase()` — if gsd-pi changes phase strings, rendering silently falls back to `.toUpperCase()`.

### Authoritative diagnostics
- `npx vitest run` — 262 tests, 15 files, all passing. This is the ground truth for what actually works.
- `git diff e36ffa8f..HEAD --name-only -- ':!.gsd/'` — shows the actual source files changed in this milestone (10 files, no parallel-status.ts).
- `.gsd-auto-progress-phase` span text — directly shows phase rendering output.

### What assumptions changed
- S01 was assumed complete based on summary artifacts — verification proved the code was never committed. Summary artifacts alone are not proof of delivery.
- Model picker grouping was assumed to be a new M014 deliverable — it was already present from prior work.

## Files Created/Modified

- `src/extension/auto-progress.ts` — Added `finalPollAndMaybeClear()` for discussion-pause detection on auto-mode stop/pause
- `src/extension/index.ts` — Registered `gsd.exportReport` command
- `src/extension/webview-provider.ts` — Added `exportReport()` method with session lookup and prompt sending
- `src/webview/auto-progress.ts` — Added validate-milestone phase ("✓ VALIDATING"), discussion-pause rendering (💬 icon, hint, class toggle), `formatPhase` cases for both
- `src/webview/slash-menu.ts` — Added `gsd update` and `gsd export` entries, exported `buildItems()` for testing
- `src/webview/__tests__/auto-progress.test.ts` — 9 new tests (1 validate-milestone + 8 discussion-pause)
- `src/webview/__tests__/slash-menu.test.ts` — New test file with 2 tests for slash menu entries
- `src/webview/styles.css` — Added `.gsd-auto-progress-discussion` and `.gsd-auto-progress-hint` CSS rules
- `package.json` — Added `gsd.exportReport` command, bumped version to 0.2.46
