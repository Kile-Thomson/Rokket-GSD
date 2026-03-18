# S04: CSS Organization

**Goal:** Split the 5165-line `src/webview/styles.css` monolith into 12 feature-scoped CSS files under `src/webview/styles/`, each under 600 lines, with a barrel `index.css` using `@import` directives. No visual changes — identical CSS output.

**Demo:** `npm run build` produces a `dist/webview/index.css` that is identical (or whitespace-only different) to the pre-split version. All tests pass. Bundle sizes within 15%.

## Must-Haves

- All 12 CSS partials created under `src/webview/styles/` with correct content
- Barrel `index.css` imports all partials in original cascade order
- `src/webview/index.ts` updated to `import "./styles/index.css"`
- Original `src/webview/styles.css` deleted
- Build succeeds, all tests pass, bundle sizes within 15% of baseline
- No visual/behavioral changes — CSS output is functionally identical

## Verification

- `npm run build` succeeds
- `npm test` — all existing tests pass
- `dist/webview/index.css` exists and is within 5% size of the pre-split version
- No individual partial file exceeds 600 lines
- `src/webview/styles.css` no longer exists
- `src/webview/styles/index.css` exists with 12 `@import` directives

## Tasks

- [x] **T01: Extract all CSS sections into feature-scoped partials** `est:45m`
  - Why: This is the core work — splitting the monolith into 12 files while preserving cascade order.
  - Files: `src/webview/styles.css` (read), `src/webview/styles/index.css` (new), `src/webview/styles/base.css` (new), `src/webview/styles/header.css` (new), `src/webview/styles/messages.css` (new), `src/webview/styles/tools.css` (new), `src/webview/styles/dashboard.css` (new), `src/webview/styles/dialogs.css` (new), `src/webview/styles/input.css` (new), `src/webview/styles/overlays.css` (new), `src/webview/styles/progress.css` (new), `src/webview/styles/visualizer.css` (new), `src/webview/styles/themes.css` (new), `src/webview/styles/utilities.css` (new), `src/webview/index.ts` (edit)
  - Do:
    1. Record pre-split baseline: run `npm run build`, note `dist/webview/index.css` file size.
    2. Read `src/webview/styles.css` and identify the 44 section boundaries marked with `/* === */` banners.
    3. Create `src/webview/styles/` directory.
    4. Extract sections into 12 files per the mapping in S04-RESEARCH.md (base.css, header.css, messages.css, tools.css, dashboard.css, dialogs.css, input.css, overlays.css, progress.css, visualizer.css, themes.css, utilities.css). Each file gets the exact CSS content from its mapped line ranges.
    5. Create `src/webview/styles/index.css` barrel with `@import` directives in cascade order: base → header → messages → tools → dashboard → dialogs → input → overlays → progress → visualizer → themes → utilities.
    6. Update `src/webview/index.ts` line 9: change `import "./styles.css"` to `import "./styles/index.css"`.
    7. Delete `src/webview/styles.css`.
    8. Run `npm run build` and compare `dist/webview/index.css` size to baseline.
    9. Run `npm test` to confirm no breakage.
  - Verify: `npm run build` succeeds, `npm test` passes, `dist/webview/index.css` size within 5% of baseline
  - Done when: All 12 partials + barrel exist, original deleted, build succeeds, tests pass, no file exceeds 600 lines

- [x] **T02: Final verification and bundle size audit** `est:15m`
  - Why: Clean verification pass to confirm the split is correct — check every partial's line count, confirm bundle sizes meet milestone criteria, and ensure lint passes.
  - Files: `src/webview/styles/*.css` (read), `dist/` (read)
  - Do:
    1. Count lines in each of the 12 partial files — all must be under 600.
    2. Run `npm run build` and record extension bundle size, webview JS size, and webview CSS size.
    3. Compare against baseline (extension ~144KB, webview JS ~335KB, webview CSS ~122KB) — all within 15%.
    4. Run `npm run lint` — must pass clean.
    5. Run `npm test` — all tests pass.
    6. Verify `src/webview/styles/index.css` has exactly 12 `@import` lines.
    7. Verify `src/webview/styles.css` does not exist.
  - Verify: `npm run lint` passes, `npm test` passes, all bundle sizes within 15%, no partial exceeds 600 lines
  - Done when: All verification criteria pass — lint clean, tests green, bundles within tolerance, line counts confirmed

## Observability / Diagnostics

- **Build output inspection:** `dist/webview/index.css` file size is the primary signal — compare pre/post split sizes to detect missing or duplicated CSS sections.
- **Partial file line counts:** `wc -l src/webview/styles/*.css` — any file exceeding 600 lines indicates incorrect section boundaries.
- **Missing CSS detection:** If the post-split CSS is significantly smaller than baseline, sections were dropped during extraction. Diff the built CSS to find missing selectors.
- **Cascade order verification:** Visual regressions in the webview indicate incorrect `@import` order in the barrel file. The barrel order must match original section order.
- **Build failure diagnostics:** esbuild errors referencing `@import` paths indicate missing or misnamed partial files. Check `src/webview/styles/` directory listing.
- **No redaction constraints** — CSS files contain no secrets or PII.

## Verification

- `npm run build` succeeds
- `npm test` — all existing tests pass
- `dist/webview/index.css` exists and is within 5% size of the pre-split version
- No individual partial file exceeds 600 lines
- `src/webview/styles.css` no longer exists
- `src/webview/styles/index.css` exists with 12 `@import` directives
- **Diagnostic check:** Build output contains no CSS-related warnings or errors (inspect stderr from `npm run build`)

## Files Likely Touched

- `src/webview/styles.css` (deleted)
- `src/webview/styles/index.css` (new barrel)
- `src/webview/styles/base.css` (new)
- `src/webview/styles/header.css` (new)
- `src/webview/styles/messages.css` (new)
- `src/webview/styles/tools.css` (new)
- `src/webview/styles/dashboard.css` (new)
- `src/webview/styles/dialogs.css` (new)
- `src/webview/styles/input.css` (new)
- `src/webview/styles/overlays.css` (new)
- `src/webview/styles/progress.css` (new)
- `src/webview/styles/visualizer.css` (new)
- `src/webview/styles/themes.css` (new)
- `src/webview/styles/utilities.css` (new)
- `src/webview/index.ts` (edit import)
