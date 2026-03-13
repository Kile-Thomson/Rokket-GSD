---
estimated_steps: 8
estimated_files: 6
---

# T01: Install vitest, write unit tests for all pure logic

**Slice:** S01 — Test framework + unit tests for pure logic
**Milestone:** M006

## Description

Set up vitest with a single task since the work is straightforward: install, configure, export a couple of internals, write test files, verify. All the target functions are identified in research — this is execution, not exploration.

## Steps

1. Install `vitest` and `jsdom` as devDependencies
2. Create `vitest.config.ts` — node environment default, include `src/**/*.test.ts`
3. Add `"test": "vitest run"` script to package.json
4. Export `parseActiveRef` and `parsePhase` from `src/extension/state-parser.ts`
5. Write `src/webview/helpers.test.ts` — tests for all pure functions: `escapeHtml`, `escapeAttr`, `sanitizeUrl`, `formatCost`, `formatTokens`, `formatContextUsage`, `shortenPath`, `formatDuration`, `truncateArg`, `getToolCategory`, `getToolIcon`, `getToolKeyArg`, `isLikelyFilePath`, `formatRelativeTime`, `formatToolResult`
6. Write `src/extension/state-parser.test.ts` — tests for `parseActiveRef`, `parsePhase`, and `parseGsdWorkflowState` (using temp files for the async function)
7. Add markdown rendering tests (jsdom environment) for `renderMarkdown` — use `@vitest-environment jsdom` pragma, regex patterns for code block IDs
8. Verify `npm run build` still works (esbuild entry points don't capture test files)

## Must-Haves

- [ ] vitest installed and `npm test` script works
- [ ] All ~12 pure helper functions have tests with meaningful assertions
- [ ] `parseActiveRef` and `parsePhase` exported and tested
- [ ] `parseGsdWorkflowState` tested with real temp files
- [ ] `renderMarkdown` tested under jsdom environment
- [ ] Production build unaffected — `npm run build` succeeds
- [ ] No test file imports `vscode`

## Verification

- `npm test` — all tests pass
- `npm run build` — succeeds without errors
- Inspect esbuild output to confirm no `.test.ts` files bundled

## Inputs

- `src/webview/helpers.ts` — source of pure functions to test
- `src/extension/state-parser.ts` — source of parsers, needs exports added
- `esbuild.mjs` — verify entry points don't glob test files
- S01-RESEARCH.md findings on codeBlockIdCounter, DOMPurify constraints, marked v15 renderer

## Expected Output

- `vitest.config.ts` — test runner configuration
- `src/webview/helpers.test.ts` — comprehensive pure function + markdown tests
- `src/extension/state-parser.test.ts` — parser unit tests
- `src/extension/state-parser.ts` — modified to export pure internals
- `package.json` — updated with vitest devDep and test script
