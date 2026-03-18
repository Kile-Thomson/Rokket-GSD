# S04: CSS Organization — UAT

**Milestone:** M013
**Written:** 2026-03-18

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This is a pure structural refactor of CSS with no behavioral changes. Build output comparison and file structure verification prove correctness without needing a live runtime.

## Preconditions

- Working directory is the M013 worktree
- `npm run build` succeeds
- `node_modules` installed

## Smoke Test

Run `npm run build` — it should produce `dist/webview/index.css` at ~120KB with no errors or warnings.

## Test Cases

### 1. All 12 partials exist with correct names

1. Run `ls src/webview/styles/`
2. **Expected:** 13 files listed: `index.css`, `base.css`, `header.css`, `messages.css`, `tools.css`, `dashboard.css`, `dialogs.css`, `input.css`, `overlays.css`, `progress.css`, `visualizer.css`, `themes.css`, `utilities.css`

### 2. No partial exceeds 600 lines

1. Run `wc -l src/webview/styles/*.css`
2. **Expected:** Every file (excluding index.css) is ≤600 lines. tools.css should be exactly 600.

### 3. Barrel file has correct import count and order

1. Run `cat src/webview/styles/index.css`
2. **Expected:** 12 `@import` directives in this order: base, header, overlays, messages, dashboard, tools, dialogs, input, utilities, themes, progress, visualizer

### 4. Original monolith is deleted

1. Run `ls src/webview/styles.css`
2. **Expected:** "No such file or directory"

### 5. TypeScript import updated

1. Run `grep "styles" src/webview/index.ts`
2. **Expected:** Contains `import "./styles/index.css"` — not `import "./styles.css"`

### 6. Build produces CSS within size tolerance

1. Run `npm run build`
2. Check `dist/webview/index.css` size
3. **Expected:** ~120KB (within 5% of 122KB baseline). Extension ~140KB, webview JS ~327KB.

### 7. All tests pass

1. Run `npm test`
2. **Expected:** 251 tests pass across 14 test files, no failures

### 8. Lint passes clean

1. Run `npm run lint`
2. **Expected:** No errors or warnings

## Edge Cases

### Empty partial check

1. Run `wc -l src/webview/styles/base.css`
2. **Expected:** ~40 lines (the smallest partial). Should not be empty — contains CSS variables and resets.

### No duplicate CSS selectors across partials

1. Pick a distinctive selector from the original monolith (e.g., `.tool-group-header`)
2. Run `grep -rl "tool-group-header" src/webview/styles/`
3. **Expected:** Appears in exactly one partial file (tools.css), not duplicated across multiple files.

## Failure Signals

- `npm run build` fails with CSS-related errors → missing or misnamed partial file
- `dist/webview/index.css` size differs by >5% from baseline → sections dropped or duplicated
- Visual regressions when loading the extension → cascade order wrong in barrel file
- A partial exceeds 600 lines → section boundaries need adjustment

## Not Proven By This UAT

- Visual pixel-identical output — this UAT verifies file structure and build correctness, not rendered appearance. A manual visual smoke test in the extension confirms no regressions.
- Runtime CSS loading in the VS Code webview — verified by the build producing the correct bundle, but actual rendering requires launching the extension.

## Notes for Tester

- The build sizes may vary slightly between environments due to esbuild version differences. The key metric is relative change from baseline, not absolute size.
- tools.css is at exactly 600 lines — this is intentional and at the limit. If future CSS is added to tool styles, it will need to be split further or redistributed.
