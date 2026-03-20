# S02: Inline Style Removal & Security Hardening

**Goal:** CSP no longer needs `'unsafe-inline'` for styles. Five security hardening items (crypto nonce, workspace boundary, file size limit, DOMPurify wrap, bash validation) are implemented. All inline `style.display` toggles replaced with CSS class operations.
**Demo:** `rg "unsafe-inline" src/` returns zero hits. `rg "style\.display" src/webview/ --glob '!__tests__'` returns zero hits. `rg "Math\.random" src/extension/html-generator.ts` returns zero hits. All 607+ tests pass. VSIX packages cleanly.

## Must-Haves

- `getNonce()` uses `crypto.randomBytes(16).toString('base64url')` instead of `Math.random`
- `handleCheckFileAccess` validates all paths are within the workspace boundary before checking access
- `handleSaveTempFile` rejects payloads exceeding 50MB before writing
- `formatMarkdownNotes` wraps output through `DOMPurify.sanitize()`
- `run_bash` case shows VS Code confirmation dialog for destructive shell patterns
- `.gsd-hidden { display: none !important; }` CSS utility class replaces all `style.display` toggling
- Zero `style.display` assignments in webview source files (52 sites replaced)
- Zero HTML `style=""` attributes in webview source files (8 sites replaced)
- CSP `style-src` is `${webview.cspSource}` with no `'unsafe-inline'`
- All test assertions updated from `style.display` to classList checks (19 assertions across 6 files)
- All 607+ existing tests pass after changes
- Build succeeds and VSIX packages cleanly

## Proof Level

- This slice proves: integration
- Real runtime required: yes (VSIX install + overlay toggle test)
- Human/UAT required: yes (manual verification that overlays, panels, progress bars, badges toggle correctly)

## Verification

- `npx vitest --run` — all tests pass (607+)
- `npm run build` — esbuild succeeds
- `rg "style\.display" src/webview/ --glob '!__tests__'` — zero hits
- `rg 'style="' src/webview/ --glob '!__tests__'` — zero hits
- `rg "unsafe-inline" src/` — zero hits
- `rg "Math\.random" src/extension/html-generator.ts` — zero hits
- `npx vsce package --no-dependencies` — VSIX packages cleanly
- `npx vitest --run src/extension/file-ops.test.ts` — workspace boundary rejection and size limit rejection tests pass (diagnostic/failure-path coverage)

## Observability / Diagnostics

- Runtime signals: `[sessionId] Blocked check_file_access outside workspace: <path>` log when workspace boundary rejects a path. `[sessionId] Blocked save_temp_file: payload exceeds 50MB limit` log on oversized file. VS Code warning dialog on destructive bash patterns.
- Inspection surfaces: VS Code Output Channel "Rokket GSD" for security boundary logs. CSP visible in browser DevTools (F12 → Application → Frames) when inspecting the webview.
- Failure visibility: CSP violations logged to browser console if any inline styles remain. Workspace boundary rejections logged with the offending path.
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: `html-generator.ts` (S01 extracted), `file-ops.ts` (S01 wired), `message-dispatch.ts` (S01 extracted), all webview source files
- New wiring introduced in this slice: `.gsd-hidden` CSS class used by all visibility toggles, `crypto` import in html-generator, DOMPurify call in formatMarkdownNotes, VS Code dialog in run_bash handler
- What remains before the milestone is truly usable end-to-end: S03 (bundle optimization), S04 (quick wins + coverage)

## Tasks

- [x] **T01: Harden security functions — crypto nonce, workspace boundary, file size limit, DOMPurify, bash validation** `est:45m`
  - Why: Delivers R003 (security hardening) — five independent fixes across extension-side and webview code. Each addresses a specific audit finding (SEC-02/03/04/05/10). Independent of the inline style work.
  - Files: `src/extension/html-generator.ts`, `src/extension/file-ops.ts`, `src/extension/message-dispatch.ts`, `src/webview/helpers.ts`, `src/extension/file-ops.test.ts`
  - Do: (1) Replace `Math.random` nonce with `crypto.randomBytes(16).toString('base64url')` in `getNonce()`. (2) Add workspace boundary check to `handleCheckFileAccess` using the same pattern as `handleOpenFile` (lines 68-78 of file-ops.ts — `realpathSync` + `startsWith`). (3) Add 50MB size limit check in `handleSaveTempFile` before `Buffer.from`. (4) Wrap `formatMarkdownNotes` return through `DOMPurify.sanitize()`. (5) Add destructive pattern detection + confirmation dialog in `run_bash` case of message-dispatch.ts. Add/update unit tests for each change.
  - Verify: `npx vitest --run` passes, `rg "Math\.random" src/extension/html-generator.ts` returns zero, `npm run build` succeeds
  - Done when: All five security hardening items implemented with tests, build passes, zero `Math.random` in html-generator.ts

- [ ] **T02: Add .gsd-hidden CSS class and sweep high-count webview files (ui-updates, dashboard, session-history, index, file-handling)** `est:1h`
  - Why: Establishes the CSS class infrastructure and tackles the 5 highest-touch files (37 of 52 `style.display` sites + 2 of 8 HTML `style=""` attributes). Includes corresponding test updates so tests pass after this task.
  - Files: `src/webview/styles.css`, `src/webview/ui-updates.ts`, `src/webview/dashboard.ts`, `src/webview/session-history.ts`, `src/webview/index.ts`, `src/webview/file-handling.ts`, `src/webview/__tests__/ui-updates.test.ts`, `src/webview/__tests__/loading-states.test.ts`
  - Do: (1) Add `.gsd-hidden { display: none !important; }` to styles.css. (2) For elements whose CSS base rule is `display: none`, change base to their visible display value (e.g. `flex`, `block`). (3) Add `gsd-hidden` as initial class in HTML templates in index.ts for initially-hidden elements. (4) Sweep ui-updates.ts (16 sites), dashboard.ts (9), session-history.ts (4), index.ts (4), file-handling.ts (4): replace `el.style.display = "none"` → `el.classList.add('gsd-hidden')`, `el.style.display = "block"/"flex"/"inline-flex"/""` → `el.classList.remove('gsd-hidden')`, `el.style.display !== "none"` → `!el.classList.contains('gsd-hidden')`. (5) Fix HTML `style="display:none"` in index.ts → add `gsd-hidden` class. Fix `style="width:..."` in dashboard.ts → set via JS after innerHTML. (6) Update test assertions in ui-updates.test.ts (8 assertions) and loading-states.test.ts (1 assertion).
  - Verify: `npx vitest --run` passes, `rg "style\.display" src/webview/ui-updates.ts src/webview/dashboard.ts src/webview/session-history.ts src/webview/index.ts src/webview/file-handling.ts` returns zero, `npm run build` succeeds
  - Done when: 37 `style.display` sites replaced, 2 HTML inline styles fixed, test assertions updated, all tests pass

- [ ] **T03: Sweep remaining 8 webview files, fix remaining HTML inline styles, update remaining tests, and flip CSP** `est:1h`
  - Why: Completes R004 (CSP tightening) — sweeps the remaining 15 `style.display` sites across 8 files, fixes the remaining 6 HTML `style=""` attributes, updates 4 test files, and removes `'unsafe-inline'` from the CSP. This is the capstone task that closes the slice.
  - Files: `src/webview/auto-progress.ts`, `src/webview/visualizer.ts`, `src/webview/model-picker.ts`, `src/webview/thinking-picker.ts`, `src/webview/slash-menu.ts`, `src/webview/renderer.ts`, `src/webview/message-handler.ts`, `src/webview/keyboard.ts`, `src/webview/__tests__/auto-progress.test.ts`, `src/webview/__tests__/visualizer.test.ts`, `src/webview/__tests__/renderer.test.ts`, `src/webview/__tests__/keyboard.test.ts`, `src/extension/html-generator.ts`
  - Do: (1) Sweep remaining files: auto-progress.ts (3 sites), visualizer.ts (2), model-picker.ts (3), thinking-picker.ts (2), slash-menu.ts (2), renderer.ts (1), message-handler.ts (1), keyboard.ts (1) — same classList pattern as T02. (2) Fix HTML `style="width: X%"` in auto-progress.ts (3 sites) and visualizer.ts (2 sites): remove `style=""` from innerHTML templates, querySelector the fill element after innerHTML, set `.style.width` via JS. (3) Fix `style="margin-top: 12px;"` in visualizer.ts: add `.gsd-viz-section-spaced { margin-top: 12px; }` to styles.css and use the class. (4) Update test assertions in auto-progress.test.ts (4), visualizer.test.ts (2), renderer.test.ts (2), keyboard.test.ts (2). (5) In html-generator.ts, change CSP from `style-src ${webview.cspSource} 'unsafe-inline'` to `style-src ${webview.cspSource}`. (6) Final verification: all grep checks return zero hits.
  - Verify: `npx vitest --run` passes, `rg "style\.display" src/webview/ --glob '!__tests__'` returns zero, `rg 'style="' src/webview/ --glob '!__tests__'` returns zero, `rg "unsafe-inline" src/` returns zero, `npm run build` succeeds, `npx vsce package --no-dependencies` succeeds
  - Done when: Zero `style.display` in webview source, zero `style=""` in webview source, zero `unsafe-inline` in codebase, all tests pass, VSIX packages cleanly

## Files Likely Touched

- `src/extension/html-generator.ts`
- `src/extension/file-ops.ts`
- `src/extension/message-dispatch.ts`
- `src/webview/helpers.ts`
- `src/extension/file-ops.test.ts`
- `src/webview/styles.css`
- `src/webview/ui-updates.ts`
- `src/webview/dashboard.ts`
- `src/webview/session-history.ts`
- `src/webview/index.ts`
- `src/webview/file-handling.ts`
- `src/webview/auto-progress.ts`
- `src/webview/visualizer.ts`
- `src/webview/model-picker.ts`
- `src/webview/thinking-picker.ts`
- `src/webview/slash-menu.ts`
- `src/webview/renderer.ts`
- `src/webview/message-handler.ts`
- `src/webview/keyboard.ts`
- `src/webview/__tests__/ui-updates.test.ts`
- `src/webview/__tests__/auto-progress.test.ts`
- `src/webview/__tests__/renderer.test.ts`
- `src/webview/__tests__/keyboard.test.ts`
- `src/webview/__tests__/visualizer.test.ts`
- `src/webview/__tests__/loading-states.test.ts`
