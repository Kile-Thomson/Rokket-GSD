---
estimated_steps: 8
estimated_files: 6
---

# T02: Resolve CSS and webview-side quick-wins

**Slice:** S04 — Quick Wins & Coverage Reporting
**Milestone:** M016

## Description

Resolve 8 webview-side quick-wins in a single pass: prefers-reduced-motion CSS (CSS-003), focus-visible selectors (CSS-007), animation name prefixing (CSS-014), escapeHtml replacement (SEC-07), default switch case (FT-10), resetState function (TEST-06), export description clarity (FT-26), and dead type removal (FT-29). All changes are in webview/shared code with no extension-host dependencies.

**Critical pitfall — CSS-014:** When renaming `@keyframes`, you MUST update both the `@keyframes` declaration AND every `animation:` property that references it. A partial rename silently breaks animations with no build error. After renaming, verify: `grep "@keyframes " src/webview/styles.css | grep -v "gsd-"` returns zero lines, AND `grep "animation:" src/webview/styles.css | grep -v "gsd-\|none\|animation:" | grep -v "/\*"` also returns zero non-prefixed animation references.

## Steps

1. **CSS-003 — prefers-reduced-motion:** Add a `@media (prefers-reduced-motion: reduce)` block at the end of `src/webview/styles.css` that sets `*, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }`. This is the standard pattern — set near-zero duration rather than `none` to preserve animation-fill-mode behavior.

2. **CSS-007 — focus-visible selectors:** In `src/webview/styles.css`, locate the existing `:focus-visible` block (lines ~3668–3675) and add these missing selectors to it:
   - `.gsd-slash-item:focus-visible`
   - `.gsd-stale-echo-bar:focus-visible`
   - `.gsd-model-picker [role="option"]:focus-visible`
   - `.gsd-thinking-picker [role="option"]:focus-visible`
   - `.gsd-ui-option-btn:focus-visible`
   - `.gsd-session-item:focus-visible`

3. **CSS-014 — prefix animation names:** Rename all 12 non-prefixed `@keyframes` in `src/webview/styles.css`:
   - `rocket-glow` → `gsd-rocket-glow`
   - `contextPulse` → `gsd-context-pulse`
   - `entryIn` → `gsd-entry-in`
   - `cursorPulse` → `gsd-cursor-pulse`
   - `dotPulse` → `gsd-dot-pulse`
   - `toolShimmer` → `gsd-tool-shimmer`
   - `toolComplete` → `gsd-tool-complete`
   - `spin` → DELETE (duplicate of existing `gsd-spin`)
   - `parallel-pulse` → `gsd-parallel-pulse`
   - `phosphorPulse` → `gsd-phosphor-pulse`
   - `clarityShimmer` → `gsd-clarity-shimmer`
   - `forgeGlow` → `gsd-forge-glow`
   
   For each rename, also update ALL `animation:` properties that reference the old name. The `spin` keyframes (line ~1685) should be deleted entirely — it's a duplicate of `gsd-spin` (line ~3710). Update the two `animation: spin` references (lines ~421 and ~1681) to `animation: gsd-spin`.
   
   **Verify after:** `grep "@keyframes " src/webview/styles.css | grep -v "gsd-"` must return zero lines.

4. **SEC-07 — replace escapeHtmlBasic:** In `src/webview/tool-grouping.ts`:
   - Add `import { escapeHtml } from "./helpers";` at the top
   - Replace both usages of `escapeHtmlBasic(` with `escapeHtml(` (lines ~188, ~190)
   - Delete the `escapeHtmlBasic` function definition (line ~248, ~4 lines)

5. **FT-10 — default case:** In `src/webview/message-handler.ts`, find the `switch (msg.type)` block (starts ~line 100) and add a default case at the end:
   ```ts
   default:
     console.warn("[gsd-webview] Unrecognized message type:", (msg as any).type);
     break;
   ```

6. **TEST-06 — resetState:** In `src/webview/state.ts`, add a `resetState()` exported function after the `state` object declaration. It must:
   - Reset every field of `state` to its initial value (copy from the object literal above)
   - Reset `entryIdCounter` to 0
   - Clear `state.widgetData` map
   - Export: `export function resetState(): void { ... }`

7. **FT-26 — clarify export descriptions:** In `src/webview/slash-menu.ts`:
   - Line ~155: Change `"Export milestone report (HTML)"` to `"Export milestone report as HTML (via gsd-pi)"`
   - Line ~207: Change `"Export conversation as HTML"` to `"Export current conversation as HTML file"`

8. **FT-29 — remove dead type:** In `src/shared/types.ts`, delete the `RpcExportResult` interface (lines ~257–259, 3 lines). Confirm zero usages first: `grep -rn "RpcExportResult" src/` should only show the definition.

After all changes: run `npx vitest --run` and `npm run build` to verify nothing broke.

## Must-Haves

- [ ] `prefers-reduced-motion` media query present in styles.css
- [ ] All 12 non-prefixed `@keyframes` renamed to `gsd-*` or removed (spin)
- [ ] All `animation:` references updated to match new names
- [ ] `escapeHtmlBasic` function removed from tool-grouping.ts, replaced with `escapeHtml` import
- [ ] `default:` case in message-handler.ts switch
- [ ] `resetState()` exported from state.ts
- [ ] `RpcExportResult` removed from types.ts
- [ ] All 618+ tests pass
- [ ] Build succeeds

## Verification

- `npx vitest --run` — all tests pass
- `npm run build` — esbuild succeeds
- `grep -q "prefers-reduced-motion" src/webview/styles.css` — CSS-003 done
- `grep "@keyframes " src/webview/styles.css | grep -v "gsd-" | wc -l` — returns 0
- `! grep -q "escapeHtmlBasic" src/webview/tool-grouping.ts` — SEC-07 done
- `! grep -q "RpcExportResult" src/shared/types.ts` — FT-29 done
- `grep -q "resetState" src/webview/state.ts` — TEST-06 done
- `grep -q "default:" src/webview/message-handler.ts` — FT-10 done

## Inputs

- `src/webview/styles.css` — 5000+ line CSS file with 21 `@keyframes` (12 non-prefixed, 9 already `gsd-*`), existing `:focus-visible` block at lines 3668–3675, no `prefers-reduced-motion`
- `src/webview/tool-grouping.ts` — has local `escapeHtmlBasic` at line 248, used at lines 188 and 190
- `src/webview/helpers.ts` — exports `escapeHtml` at line 69
- `src/webview/message-handler.ts` — has `switch (msg.type)` at line 100, no `default:` case
- `src/webview/state.ts` — 155 LOC, exports `state: AppState` and `nextId()`, no `resetState()`
- `src/webview/slash-menu.ts` — `/gsd export` at line ~155, `/export` at line ~207
- `src/shared/types.ts` — `RpcExportResult` at line 257, zero usages elsewhere

## Expected Output

- `src/webview/styles.css` — has `prefers-reduced-motion` block, all animations `gsd-*` prefixed, new `:focus-visible` selectors, `@keyframes spin` removed
- `src/webview/tool-grouping.ts` — imports `escapeHtml` from helpers, no local `escapeHtmlBasic`
- `src/webview/message-handler.ts` — has `default:` case with console.warn
- `src/webview/state.ts` — exports `resetState()` function
- `src/webview/slash-menu.ts` — clarified export descriptions
- `src/shared/types.ts` — `RpcExportResult` removed

## Observability Impact

- **FT-10 — default switch case:** Unrecognized message types now emit `console.warn("[gsd-webview] Unrecognized message type:", ...)` to the browser console. Future agents debugging message delivery issues can filter devtools for `[gsd-webview]` to detect extension→webview protocol mismatches.
- **TEST-06 — resetState:** The `resetState()` export enables test isolation; when a test suite fails due to state leakage, calling `resetState()` in beforeEach/afterEach narrows the cause.
- **CSS-003 — prefers-reduced-motion:** Users with reduced-motion preferences will see near-zero animation durations. If animations appear to "not work" in bug reports, check `prefers-reduced-motion` media query match.
- **CSS-014 — animation prefixing:** All `@keyframes` are now `gsd-*` prefixed, eliminating collision risk with VS Code host or other extensions. If an animation breaks, verify the `animation:` property references the `gsd-*` name.
- **SEC-07 — escapeHtml consolidation:** Tool grouping labels now use the same `escapeHtml` helper as the rest of the webview, ensuring consistent XSS protection. If label rendering changes, check `helpers.ts` `escapeHtml` (single source of truth).
