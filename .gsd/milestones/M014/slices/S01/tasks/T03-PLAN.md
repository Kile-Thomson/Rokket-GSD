---
estimated_steps: 4
estimated_files: 3
---

# T03: Render parallel worker cards in webview progress widget with tests

**Slice:** S01 — Parallel Worker Progress & Budget Alerts
**Milestone:** M014

## Description

Add the user-facing worker cards to the auto-progress widget in the webview. When `data.workers` is non-null and non-empty, render a grid of worker cards below the existing progress detail row. Each card shows the worker's milestone ID, state badge, current unit, cost, and budget bar. Stale workers are visually dimmed. Add CSS styling and extend the existing test suite.

## Steps

1. **Add worker card rendering to `src/webview/auto-progress.ts`**:
   - Add a new function `buildWorkerCards(data: AutoProgressData): string` that returns empty string when `data.workers` is null/undefined/empty array.
   - For each worker in `data.workers`, render a card:
     ```html
     <div class="gsd-auto-progress-worker-card ${worker.stale ? 'stale' : ''}">
       <div class="gsd-auto-progress-worker-header">
         <span class="gsd-auto-progress-worker-id">${worker.id}</span>
         <span class="gsd-auto-progress-worker-state gsd-auto-progress-worker-state--${worker.state}">${stateLabel}</span>
       </div>
       <div class="gsd-auto-progress-worker-unit">${unitDescription}</div>
       <div class="gsd-auto-progress-worker-footer">
         <span class="gsd-auto-progress-worker-cost">$${worker.cost.toFixed(2)}</span>
         ${budgetBarHtml}
       </div>
     </div>
     ```
   - State badge labels: running → "Running", paused → "Paused", stopped → "Stopped", error → "Error"
   - State badge colors via CSS classes: `--running` (green), `--paused` (yellow), `--stopped` (gray), `--error` (red)
   - Unit description: if `worker.currentUnit`, show `"${type} ${id}"` (e.g., "executing T03"); if null, show "Idle"
   - Budget bar: if `worker.budgetPercent` is not null, render a mini progress bar. Fill color: green (<80%), orange (80-99%), red (>=100%). If null, omit budget bar.
   - Stale indicator: when `worker.stale` is true, add "stale" CSS class (dims the card) and append "(stale)" text
   - If `data.budgetAlert` is true, add a small "⚠️ Budget" badge in the stats area
   - Call `buildWorkerCards(data)` in `render()` and insert after the detail row

2. **Add CSS to `src/webview/styles.css`**:
   - `.gsd-auto-progress-workers` — flex-wrap container with gap
   - `.gsd-auto-progress-worker-card` — card styling: border, border-radius, padding, min-width ~180px, background using VS Code theme variables (`var(--vscode-editor-background)`, `var(--vscode-panel-border)`)
   - `.gsd-auto-progress-worker-card.stale` — opacity: 0.5
   - `.gsd-auto-progress-worker-state--running` — color green (`var(--vscode-testing-iconPassed)`)
   - `.gsd-auto-progress-worker-state--paused` — color yellow (`var(--vscode-editorWarning-foreground)`)
   - `.gsd-auto-progress-worker-state--error` — color red (`var(--vscode-errorForeground)`)
   - `.gsd-auto-progress-worker-state--stopped` — color gray (`var(--vscode-descriptionForeground)`)
   - `.gsd-auto-progress-worker-budget-track` / `.gsd-auto-progress-worker-budget-fill` — same pattern as existing progress bars but smaller height
   - Budget fill colors: green default, orange at 80% (via `--warning` class), red at 100% (via `--danger` class)

3. **Extend tests in `src/webview/__tests__/auto-progress.test.ts`**:
   - Import `WorkerProgress` type from `../../shared/types`
   - Add helper `makeWorker(overrides?: Partial<WorkerProgress>): WorkerProgress` returning a valid default worker
   - Tests to add:
     - "renders worker cards when workers array is present" — pass `workers: [makeWorker()]`, verify `.gsd-auto-progress-worker-card` exists in DOM
     - "renders multiple worker cards" — pass 3 workers, verify 3 cards
     - "shows state badge with correct class" — pass worker with `state: "running"`, verify `.gsd-auto-progress-worker-state--running` class
     - "shows budget bar when budgetPercent is set" — pass worker with `budgetPercent: 65`, verify budget bar fill at 65%
     - "marks stale workers" — pass worker with `stale: true`, verify card has `.stale` class
     - "shows budget alert badge" — pass `budgetAlert: true`, verify "⚠️" or "Budget" text appears
     - "renders no worker cards when workers is null" — pass `workers: null`, verify no `.gsd-auto-progress-worker-card` elements
     - "renders no worker cards when workers is empty array" — pass `workers: []`, verify no cards
     - "shows current unit description" — verify "executing T03" text for a worker with `currentUnit: { type: "executing", id: "T03" }`
     - "shows Idle when no current unit" — pass worker with `currentUnit: null`, verify "Idle" text

4. **Build and run all tests**: `npm run build && npx vitest run src/webview/__tests__/auto-progress.test.ts`

## Must-Haves

- [ ] Worker cards render when `data.workers` is non-null and non-empty
- [ ] Each card shows: milestone ID, state badge, current unit, cost, budget bar
- [ ] State badges have distinct colors per state
- [ ] Budget bar fill changes color at 80% and 100% thresholds
- [ ] Stale workers are visually dimmed with "(stale)" label
- [ ] Budget alert badge visible when `data.budgetAlert` is true
- [ ] No worker cards rendered when `workers` is null or empty (graceful degradation)
- [ ] All existing auto-progress tests still pass
- [ ] All new tests pass

## Verification

- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — all tests pass (existing + new)
- `npm run build` — no type errors
- Visual: install VSIX, confirm worker cards appear correctly styled in VS Code dark/light themes

## Inputs

- `src/shared/types.ts` — `WorkerProgress` interface and extended `AutoProgressData` from T01
- `src/webview/auto-progress.ts` — existing render function to extend
- `src/webview/__tests__/auto-progress.test.ts` — existing test suite to extend
- `src/webview/styles.css` — existing stylesheet for the webview

## Observability Impact

- **DOM inspection**: Worker cards are rendered as `.gsd-auto-progress-worker-card` elements inside `#autoProgressWidget`. Inspect in the webview DevTools to verify card count, state classes, and budget bar fill widths.
- **Stale indicator**: Stale workers get `.stale` CSS class and "(stale)" text — visible in DOM and visually dimmed.
- **Budget alert**: When `budgetAlert` is true, "⚠️ Budget" badge appears in the stats area — inspectable via `.gsd-auto-progress-budget-alert` selector.
- **Failure visibility**: If `data.workers` is null/empty/undefined, no worker card DOM elements are rendered — graceful degradation confirmed by absence of `.gsd-auto-progress-worker-card` in the DOM.
- **Test coverage**: 10 new unit tests verify all rendering paths including edge cases (null workers, empty array, stale, budget thresholds).

## Expected Output

- `src/webview/auto-progress.ts` — modified with `buildWorkerCards()` function and updated `render()`
- `src/webview/__tests__/auto-progress.test.ts` — extended with ~10 new test cases for worker cards
- `src/webview/styles.css` — extended with worker card CSS styles
