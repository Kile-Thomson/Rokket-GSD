# S01: Parallel Worker Progress & Budget Alerts — UAT

**Milestone:** M014
**Written:** 2026-03-19

## UAT Type

- UAT mode: mixed (artifact-driven for unit tests, live-runtime for visual verification)
- Why this mode is sufficient: Unit tests prove data parsing and rendering logic; live runtime confirms the visual result and toast behavior against actual gsd-pi parallel auto-mode

## Preconditions

- gsd-pi v2.28.0 installed and available on PATH
- VS Code with latest Rokket GSD extension built from this branch (`npm run build` + F5 debug launch)
- A GSD project with at least 2 milestones (to trigger parallel auto-mode)
- `.gsd/preferences.md` contains `budget_ceiling: 0.50` (or similar low value for easy 80% trigger)

## Smoke Test

Run `gsd auto` in a multi-milestone project. Confirm the progress widget in the VS Code sidebar shows per-worker cards below the existing progress bar within 3-6 seconds of parallel workers starting.

## Test Cases

### 1. Worker cards appear during parallel auto-mode

1. Open a GSD project with 2+ milestones in VS Code
2. Start auto-mode via `/gsd auto` or the auto-mode button
3. Wait for parallel workers to spin up (watch GSD output channel for "Parallel workers: N")
4. **Expected:** Progress widget shows one card per active worker. Each card displays: milestone ID, state badge (e.g. "Running" in green), current unit description, cost value, and a budget bar.

### 2. Worker state badges update in real time

1. With parallel auto-mode running, observe worker cards
2. Wait for a worker to transition states (e.g. running → paused between units)
3. **Expected:** State badge updates to reflect current state with appropriate color (Running=green, Paused=yellow, Stopped=gray, Error=red)

### 3. Budget bar fills proportionally

1. Set `budget_ceiling: 0.50` in `.gsd/preferences.md`
2. Start parallel auto-mode
3. As workers accumulate cost, observe budget bars
4. **Expected:** Budget bar fill width matches `cost / budget_ceiling` percentage. Green below 80%, orange at 80-99%, red at 100%+.

### 4. Budget alert toast fires at 80%

1. Set `budget_ceiling: 0.10` in `.gsd/preferences.md` (low value to trigger quickly)
2. Start parallel auto-mode and let workers accumulate cost
3. **Expected:** When any worker's cost exceeds $0.08 (80% of $0.10), a VS Code warning toast appears listing the over-budget worker ID(s). Toast fires only once — not repeated on every poll cycle.

### 5. Budget alert resets and re-fires

1. After initial budget alert, stop the over-budget worker (or it completes)
2. Start a new run that crosses 80% again
3. **Expected:** A new budget alert toast fires for the second crossing.

### 6. Stale worker indicator

1. During parallel auto-mode, abruptly kill one worker's process (e.g. `kill <pid>`)
2. Wait 30+ seconds for the heartbeat to go stale
3. **Expected:** The killed worker's card shows dimmed styling and "(stale)" text next to the state badge.

### 7. Graceful degradation — no parallel directory

1. Delete or rename `.gsd/parallel/` directory
2. Start auto-mode (single worker, non-parallel)
3. **Expected:** Progress widget renders exactly as before S01 — no worker cards section, no budget alert badge, no errors in console or output channel.

## Edge Cases

### Corrupt status file mixed with valid ones

1. Create `.gsd/parallel/worker-1.status.json` with valid JSON
2. Create `.gsd/parallel/worker-2.status.json` with invalid JSON (e.g. `{broken`)
3. **Expected:** Worker card renders for worker-1 only. No error toast or crash. GSD output channel may log a parse skip.

### Dropbox conflicted copy filtering

1. Create `.gsd/parallel/worker-1.status.json` (valid)
2. Create `.gsd/parallel/worker-1 (Kile's conflicted copy 2026-03-19).status.json` (valid JSON)
3. **Expected:** Only one worker card renders (from the canonical file). Conflicted copy is silently ignored.

### No budget ceiling set

1. Remove `budget_ceiling` from `.gsd/preferences.md`
2. Start parallel auto-mode
3. **Expected:** Worker cards render but budget bars show no fill (or 0%). No budget alert toast fires. No errors.

### Empty parallel directory

1. Create `.gsd/parallel/` directory with no files inside
2. **Expected:** No worker cards rendered. Widget behaves identically to "no parallel directory" case.

## Failure Signals

- Worker cards section does not appear when `.gsd/parallel/*.status.json` files exist and contain valid data
- Budget bar fill percentage does not match actual cost/ceiling ratio
- Budget alert toast fires repeatedly on every poll cycle (3s intervals) instead of once
- VS Code error notification or extension crash when parallel data is malformed
- Output channel shows no "Parallel workers:" log lines during parallel auto-mode
- Worker cards still render when `.gsd/parallel/` directory is removed (should gracefully degrade)

## Not Proven By This UAT

- Performance under very large numbers of parallel workers (10+) — current testing assumes 2-4
- Behavior when `.gsd/parallel/` files are written concurrently by gsd-pi while being read by the extension (race condition risk is low given JSON atomicity but not explicitly tested)
- Integration with S02 validate-milestone phase or S03 discussion pause states

## Notes for Tester

- The GSD output channel (View → Output → select "GSD") is the best diagnostic surface. Look for "Parallel workers: N" lines to confirm the poller is finding status files.
- Budget ceiling values are in dollars. Set to a very low value (e.g. 0.05) for quick threshold testing.
- If worker cards don't appear, check that files in `.gsd/parallel/` end exactly in `.status.json` — other extensions are filtered out.
- The stale threshold is 30 seconds from the last heartbeat timestamp in the status JSON. Freshly written files will never show as stale.
