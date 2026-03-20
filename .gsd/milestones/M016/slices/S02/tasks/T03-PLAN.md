---
estimated_steps: 5
estimated_files: 12
---

# T03: Sweep remaining 8 webview files, fix remaining HTML inline styles, update tests, and flip CSP

**Slice:** S02 — Inline Style Removal & Security Hardening
**Milestone:** M016

## Description

Complete the inline style removal by sweeping the remaining 8 webview files (15 `style.display` sites), fixing the remaining 6 HTML `style=""` attributes in auto-progress.ts and visualizer.ts, updating 4 test files (10 assertions), and flipping the CSP to remove `'unsafe-inline'`. This is the capstone task that closes both R003 and R004.

**Critical knowledge from S02 research:**
- Same classList pattern as T02: `style.display = "none"` → `classList.add('gsd-hidden')`, visible values → `classList.remove('gsd-hidden')`
- Progress bar `style="width: X%"` in HTML templates (auto-progress.ts lines 212, 226, 338 and visualizer.ts lines 322, 426) must be removed from innerHTML and set via JS `.style.width` AFTER the innerHTML assignment. You need to querySelector the newly created fill element after innerHTML renders it.
- `style="margin-top: 12px;"` in visualizer.ts line 477 → add `.gsd-viz-section-spaced { margin-top: 12px; }` to styles.css and use the class
- CSP final state should be `style-src ${webview.cspSource}` (no nonce needed for styles — there are zero `<style>` elements; only a `<link>` stylesheet)
- Non-display inline styles (style.left, style.top, style.cursor, style.height, etc.) are CSP-safe and should NOT be changed — they use JS property access, not HTML attributes

## Steps

1. **Sweep remaining 8 webview files** — Apply the same mechanical replacement as T02:
   - `src/webview/auto-progress.ts` (3 `style.display` sites)
   - `src/webview/visualizer.ts` (2 `style.display` sites)
   - `src/webview/model-picker.ts` (3 sites)
   - `src/webview/thinking-picker.ts` (2 sites)
   - `src/webview/slash-menu.ts` (2 sites)
   - `src/webview/renderer.ts` (1 site)
   - `src/webview/message-handler.ts` (1 site)
   - `src/webview/keyboard.ts` (1 site)
   
   Pattern: `el.style.display = "none"` → `el.classList.add('gsd-hidden')`, `el.style.display = "block"/"flex"` → `el.classList.remove('gsd-hidden')`.

2. **Fix HTML `style="width: X%"` in auto-progress.ts** (3 sites at lines ~212, ~226, ~338) — For each site:
   - Remove the `style="width: ${pct}%"` from the HTML template string
   - After the `innerHTML` assignment, querySelector the fill/bar element that was just created
   - Set `.style.width = \`${pct}%\`` via JS
   - Example transformation:
     ```typescript
     // Before:
     el.innerHTML = `<div class="bar-fill" style="width: ${pct}%"></div>`;
     // After:
     el.innerHTML = `<div class="bar-fill"></div>`;
     const fill = el.querySelector('.bar-fill') as HTMLElement;
     if (fill) fill.style.width = `${pct}%`;
     ```
   - The exact element selectors may vary — read the actual code to identify the correct class names.

3. **Fix HTML `style=""` in visualizer.ts** (3 sites) — Same pattern for `style="width: X%"` at lines ~322 and ~426. For `style="margin-top: 12px;"` at line ~477:
   - Add to `styles.css`: `.gsd-viz-section-spaced { margin-top: 12px; }`
   - Replace `style="margin-top: 12px;"` with `class="gsd-viz-section-spaced"` (or add to existing class list)

4. **Update remaining test files** (4 files, 10 assertions total):
   - `src/webview/__tests__/auto-progress.test.ts` — 4 `style.display` assertions
   - `src/webview/__tests__/visualizer.test.ts` — 2 `style.display` assertions
   - `src/webview/__tests__/renderer.test.ts` — 2 `style.display` assertions
   - `src/webview/__tests__/keyboard.test.ts` — 2 `style.display` assertions
   
   Change `expect(el.style.display).toBe("none")` → `expect(el.classList.contains('gsd-hidden')).toBe(true)`. Change `expect(el.style.display).toBe("flex"/"block")` → `expect(el.classList.contains('gsd-hidden')).toBe(false)`. Update any test setup that uses `style.display`.

5. **Flip CSP in `html-generator.ts`** — Change line ~33 from:
   ```
   style-src ${webview.cspSource} 'unsafe-inline'
   ```
   to:
   ```
   style-src ${webview.cspSource}
   ```
   This is safe because: (a) all HTML `style=""` attributes have been removed (T02 + this task), (b) there are zero `<style>` elements in the webview, (c) JS `.style.property = value` is not blocked by CSP `style-src`.

6. **Run final verification sweep** — Execute all grep checks to confirm zero remaining inline styles and no `'unsafe-inline'` in the codebase.

## Must-Haves

- [ ] Zero `style.display` assignments in all 8 remaining webview source files
- [ ] 3 HTML `style="width:..."` in auto-progress.ts replaced with JS `.style.width` after innerHTML
- [ ] 2 HTML `style="width:..."` in visualizer.ts replaced with JS `.style.width` after innerHTML
- [ ] 1 HTML `style="margin-top:..."` in visualizer.ts replaced with CSS class
- [ ] Test assertions updated in auto-progress.test.ts, visualizer.test.ts, renderer.test.ts, keyboard.test.ts
- [ ] CSP `style-src` no longer contains `'unsafe-inline'`
- [ ] `rg "style\.display" src/webview/ --glob '!__tests__'` returns zero hits
- [ ] `rg 'style="' src/webview/ --glob '!__tests__'` returns zero hits
- [ ] `rg "unsafe-inline" src/` returns zero hits
- [ ] All tests pass (`npx vitest --run`)
- [ ] Build succeeds and VSIX packages (`npm run build && npx vsce package --no-dependencies`)

## Verification

- `npx vitest --run` — all tests pass (607+)
- `rg "style\.display" src/webview/ --glob '!__tests__'` — zero hits
- `rg 'style="' src/webview/ --glob '!__tests__'` — zero hits
- `rg "unsafe-inline" src/` — zero hits
- `npm run build` — esbuild succeeds
- `npx vsce package --no-dependencies` — VSIX packages cleanly

## Inputs

- T02 completed: `.gsd-hidden` class exists in styles.css, high-count files already swept, base CSS updated for initially-hidden elements
- `src/webview/auto-progress.ts` — 3 `style.display` + 3 HTML `style="width:..."` (lines ~212, ~226, ~338)
- `src/webview/visualizer.ts` — 2 `style.display` + 2 HTML `style="width:..."` (lines ~322, ~426) + 1 HTML `style="margin-top:..."` (line ~477)
- `src/webview/model-picker.ts` — 3 `style.display`
- `src/webview/thinking-picker.ts` — 2 `style.display`
- `src/webview/slash-menu.ts` — 2 `style.display`
- `src/webview/renderer.ts` — 1 `style.display`
- `src/webview/message-handler.ts` — 1 `style.display`
- `src/webview/keyboard.ts` — 1 `style.display`
- `src/extension/html-generator.ts` — CSP meta tag at line ~33, currently has `'unsafe-inline'`
- 4 test files with 10 total `style.display` assertions

## Expected Output

- 8 webview source files — zero `style.display` assignments, using classList
- `src/webview/auto-progress.ts` — progress bar widths set via JS after innerHTML
- `src/webview/visualizer.ts` — progress bar widths via JS, margin-top via CSS class
- `src/webview/styles.css` — `.gsd-viz-section-spaced { margin-top: 12px; }` added
- 4 test files — assertions use classList instead of style.display
- `src/extension/html-generator.ts` — CSP `style-src ${webview.cspSource}` without `'unsafe-inline'`
- VSIX packages cleanly with hardened CSP
