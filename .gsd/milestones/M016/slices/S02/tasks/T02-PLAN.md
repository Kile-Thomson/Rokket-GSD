---
estimated_steps: 5
estimated_files: 8
---

# T02: Add .gsd-hidden CSS class and sweep high-count webview files

**Slice:** S02 — Inline Style Removal & Security Hardening
**Milestone:** M016

## Description

Establish the `.gsd-hidden` CSS utility class and replace all `style.display` toggles in the 5 highest-touch webview files: `ui-updates.ts` (16 sites), `dashboard.ts` (9), `session-history.ts` (4), `index.ts` (4), `file-handling.ts` (4). This covers 37 of 52 total `style.display` sites. Also fixes 2 of 8 HTML `style=""` attributes (in index.ts and dashboard.ts) and updates the corresponding test files.

**Critical knowledge from S02 research:**
- `el.style.display = "none"` → `el.classList.add('gsd-hidden')`
- `el.style.display = "block"/"flex"/"inline-flex"/""` → `el.classList.remove('gsd-hidden')`
- `el.style.display !== "none"` (read-checks in ui-updates.ts lines 138-139) → `!el.classList.contains('gsd-hidden')`
- Elements whose CSS base rule is `display: none` need their CSS changed to the visible display value + `gsd-hidden` class added in HTML
- `.gsd-hidden` needs `!important` to override theme-specific selectors
- `style="display:none"` in index.ts line 148 → add `gsd-hidden` to class list
- `style="width: ${fillPct}%"` in dashboard.ts line 104 → set via JS `.style.width` after innerHTML (this is CSP-safe)

## Steps

1. **Add `.gsd-hidden` utility class to `styles.css`** — Near the top of the file (after the `:root` / base variable declarations), add:
   ```css
   .gsd-hidden {
     display: none !important;
   }
   ```
   The `!important` is necessary because theme overrides (e.g. `.gsd-app[data-theme="phosphor"] .gsd-slash-menu { ... }`) would otherwise override a simple class-based `display: none`.

2. **Update base CSS for elements that start hidden** — Find elements in `styles.css` that have `display: none` as their base CSS rule and are shown via JS `style.display = "block"/"flex"`. Change their base CSS to the visible display value. The JS will now use `.gsd-hidden` to hide them. Key elements to check and update:
   - `.gsd-slash-menu` — if base is `display: none`, change to `display: block`
   - `.gsd-model-picker` — if base is `display: none`, change to `display: block`
   - `.gsd-thinking-picker` — if base is `display: none`, change to `display: block`
   - `.gsd-session-panel` — if base is `display: none`, change to appropriate display value
   - `.gsd-auto-progress` — if base is `display: none`, change to `display: flex` (auto-progress uses flex)
   - Any overlay-indicators, context-bar-container elements
   
   **Important:** For each element whose CSS changes from `display: none` to a visible value, you MUST also add the `gsd-hidden` class in the HTML that creates them (in `index.ts` template or wherever the HTML is generated) to prevent a flash of content on load.

3. **Sweep `ui-updates.ts`** (16 sites) — This is the highest-count file. Replace all `style.display` assignments:
   - `el.style.display = "none"` → `el.classList.add('gsd-hidden')`
   - `el.style.display = "flex"` → `el.classList.remove('gsd-hidden')`
   - `el.style.display = "block"` → `el.classList.remove('gsd-hidden')`
   - `el.style.display = "inline-flex"` → `el.classList.remove('gsd-hidden')` (badges)
   
   **Special case — visibility read-checks (lines ~138-139):** Replace `el.style.display !== "none"` with `!el.classList.contains('gsd-hidden')`. This is used for separator logic and will break if not converted.

4. **Sweep `dashboard.ts`** (9 sites), **`session-history.ts`** (4 sites), **`index.ts`** (4 sites), **`file-handling.ts`** (4 sites) — Same mechanical replacement pattern. Dashboard-specific notes:
   - `resumeChip.style.display = ""` (line ~477) → `resumeChip.classList.remove('gsd-hidden')` — this was reverting to CSS default, which is cleaner with the class approach
   - `style="width: ${fillPct}%"` in dashboard.ts HTML template → remove the `style=""` attribute from the HTML, then after the `innerHTML` assignment, querySelector the fill element and set `.style.width = \`${fillPct}%\`` via JS (CSP-safe)
   - `style="display:none"` in index.ts HTML template → replace with `class="gsd-hidden"` (or add to existing class list)

5. **Update test files** — Update assertions in:
   - `src/webview/__tests__/ui-updates.test.ts` (8 `style.display` assertions) — change `expect(el.style.display).toBe("none")` → `expect(el.classList.contains('gsd-hidden')).toBe(true)`, and `expect(el.style.display).toBe("flex")` → `expect(el.classList.contains('gsd-hidden')).toBe(false)`. Also update any test setup that sets `el.style.display = "block"` → `el.classList.remove('gsd-hidden')`.
   - `src/webview/__tests__/loading-states.test.ts` (1 `style.display` assertion) — same pattern

## Must-Haves

- [ ] `.gsd-hidden { display: none !important; }` exists in styles.css
- [ ] Base CSS for initially-hidden elements changed to visible display value
- [ ] `gsd-hidden` class added to HTML templates for initially-hidden elements
- [ ] Zero `style.display` in ui-updates.ts, dashboard.ts, session-history.ts, index.ts, file-handling.ts
- [ ] Read-checks in ui-updates.ts converted from `style.display !== "none"` to `!classList.contains('gsd-hidden')`
- [ ] HTML `style="display:none"` in index.ts replaced with `gsd-hidden` class
- [ ] HTML `style="width:..."` in dashboard.ts replaced with JS `.style.width` after innerHTML
- [ ] Test assertions updated in ui-updates.test.ts and loading-states.test.ts
- [ ] All tests pass (`npx vitest --run`)
- [ ] Build succeeds (`npm run build`)

## Verification

- `npx vitest --run` — all tests pass
- `rg "style\.display" src/webview/ui-updates.ts src/webview/dashboard.ts src/webview/session-history.ts src/webview/index.ts src/webview/file-handling.ts` — zero hits
- `rg 'style="' src/webview/index.ts src/webview/dashboard.ts` — zero hits (HTML inline styles removed)
- `rg "gsd-hidden" src/webview/styles.css` — has hits (class exists)
- `npm run build` — esbuild succeeds

## Inputs

- `src/webview/styles.css` — 5,476 LOC. Check which elements have `display: none` as base rule.
- `src/webview/ui-updates.ts` — 16 `style.display` sites including 2 read-checks at lines ~138-139
- `src/webview/dashboard.ts` — 9 `style.display` sites + 1 HTML `style="width:..."` at line ~104
- `src/webview/session-history.ts` — 4 `style.display` sites
- `src/webview/index.ts` — 4 `style.display` sites + 1 HTML `style="display:none"` at line ~148
- `src/webview/file-handling.ts` — 4 `style.display` sites
- `src/webview/__tests__/ui-updates.test.ts` — 8 `style.display` assertions
- `src/webview/__tests__/loading-states.test.ts` — 1 `style.display` assertion
- T01 must be complete first (security hardening is independent but sequenced before style work)

## Expected Output

- `src/webview/styles.css` — `.gsd-hidden` class added, base CSS updated for initially-hidden elements
- `src/webview/ui-updates.ts` — zero `style.display`, all using classList
- `src/webview/dashboard.ts` — zero `style.display`, progress bar width set via JS after innerHTML
- `src/webview/session-history.ts` — zero `style.display`
- `src/webview/index.ts` — zero `style.display`, zero `style=""` in HTML templates, `gsd-hidden` class on initially-hidden elements
- `src/webview/file-handling.ts` — zero `style.display`
- `src/webview/__tests__/ui-updates.test.ts` — assertions use classList instead of style.display
- `src/webview/__tests__/loading-states.test.ts` — assertion uses classList

## Observability Impact

- **CSP violations**: If any inline `style.display` toggling remains, CSP violations will be logged in the browser DevTools console once `'unsafe-inline'` is removed in T03. This task eliminates 37 of 52 sites.
- **Flash of content**: If `gsd-hidden` class is missing from initially-hidden HTML elements, they will flash visible on load. Inspect via DevTools → Elements on webview open.
- **Failure visibility**: No new runtime signals. The `.gsd-hidden` class is a CSS-only mechanism — failures manifest as visual bugs (elements not hiding/showing), detectable by inspecting class lists in DevTools.
