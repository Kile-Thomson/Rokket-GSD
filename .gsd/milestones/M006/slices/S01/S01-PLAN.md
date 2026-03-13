# S01: Test framework + unit tests for pure logic

**Goal:** Vitest runs unit tests covering all pure logic in helpers.ts, state-parser.ts, and markdown rendering.
**Demo:** `npm test` passes with tests for ~12 pure helpers, state-parser internals, and markdown rendering (jsdom).

## Must-Haves

- vitest installed and configured with `npm test` script
- Tests for all pure functions in `src/webview/helpers.ts` (~12 functions)
- Tests for `parseActiveRef` and `parsePhase` from `src/extension/state-parser.ts` (export them)
- Tests for `renderMarkdown` using `@vitest-environment jsdom`
- Test files excluded from production esbuild bundle
- No test imports `vscode`

## Verification

- `npm test` passes with all tests green
- `npm run build` still succeeds (test files not bundled)

## Tasks

- [x] **T01: Install vitest, write unit tests for all pure logic** `est:1h`
  - Why: This is the entire slice — install the framework, configure it, export state-parser internals, write all test files, ensure build still works
  - Files: `package.json`, `vitest.config.ts`, `src/webview/helpers.test.ts`, `src/extension/state-parser.test.ts`, `src/extension/state-parser.ts`, `esbuild.mjs`
  - Do: Install vitest + jsdom as devDeps. Create vitest.config.ts (node env default, include `src/**/*.test.ts`). Export `parseActiveRef` and `parsePhase` from state-parser.ts. Write helpers.test.ts covering all ~12 pure functions. Write state-parser.test.ts for the exported pure parsers plus `parseGsdWorkflowState` with temp files. Add a markdown rendering section in helpers.test.ts (or separate file) with `@vitest-environment jsdom`. Add `test` script to package.json. Verify esbuild doesn't bundle test files (check entry points). Use regex patterns for code block IDs in markdown assertions (counter is module-level mutable state).
  - Verify: `npm test` passes, `npm run build` succeeds
  - Done when: All tests pass, build produces same output as before

## Files Likely Touched

- `package.json`
- `vitest.config.ts`
- `src/webview/helpers.test.ts`
- `src/extension/state-parser.test.ts`
- `src/extension/state-parser.ts`
- `esbuild.mjs`
