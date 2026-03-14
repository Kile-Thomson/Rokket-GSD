# S01: Test framework + unit tests for pure logic — Research

**Date:** 2026-03-13

## Summary

The codebase has two main sources of testable pure logic: `src/webview/helpers.ts` (14+ exported pure functions) and `src/extension/state-parser.ts` (STATE.md parsing). helpers.ts is mostly pure but has two complications: `renderMarkdown` depends on DOMPurify (needs DOM/jsdom), and `buildSubagentOutputHtml` calls `renderMarkdown`. state-parser.ts exports only `parseGsdWorkflowState` which does fs I/O — the internal pure parsers (`parseActiveRef`, `parsePhase`) are not exported.

Vitest is the right tool: fast, TypeScript-native, zero-config for most cases, and the project already uses esbuild so there's no bundler conflict. We can test ~12 pure helpers directly, test state-parser either by exporting the pure internals or using `memfs`/temp files, and test markdown rendering with vitest's jsdom environment on just that test file.

## Recommendation

1. Install `vitest` as devDependency. Add `npm test` script.
2. Create `vitest.config.ts` — default node environment, include `src/**/*.test.ts`.
3. Export `parseActiveRef` and `parsePhase` from state-parser.ts (they're useful pure functions, no reason to hide them).
4. Write tests for:
   - **helpers.ts pure functions** (~12 functions): `escapeHtml`, `escapeAttr`, `sanitizeUrl`, `formatCost`, `formatTokens`, `formatContextUsage`, `shortenPath`, `formatDuration`, `truncateArg`, `getToolCategory`, `getToolIcon`, `getToolKeyArg`, `isLikelyFilePath`, `formatRelativeTime`, `formatToolResult`
   - **state-parser.ts**: `parseActiveRef`, `parsePhase` (pure), `parseGsdWorkflowState` (with temp file or mock fs)
   - **renderMarkdown**: use `// @vitest-environment jsdom` pragma on that test file only
5. Place tests alongside source: `src/webview/helpers.test.ts`, `src/extension/state-parser.test.ts`.
6. Exclude test files from esbuild bundle via tsconfig or esbuild config.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Test runner + assertions | vitest | TS-native, fast, works with esbuild projects, built-in coverage |
| DOM environment for DOMPurify tests | vitest jsdom environment | Per-file `@vitest-environment jsdom` avoids global jsdom overhead |

## Existing Code and Patterns

- `src/webview/helpers.ts` — 14+ exported functions, ~12 are pure (no DOM). `scrollToBottom` is DOM-only (skip). `renderMarkdown` and `buildSubagentOutputHtml` need jsdom for DOMPurify.
- `src/extension/state-parser.ts` — `parseActiveRef` and `parsePhase` are pure string parsers but currently not exported. `parseGsdWorkflowState` does async fs read. Export the pure internals for direct testing.
- `src/shared/types.ts` — type-only, no runtime code, no tests needed.
- `tsconfig.json` — strict mode, ES2022 target, CJS module. Vitest handles this natively.
- `esbuild.mjs` (build script) — need to ensure `*.test.ts` files are excluded from production bundle.

## Constraints

- **No vscode imports in test files.** state-parser.ts imports `fs` and `path` (fine in Node), no vscode dependency. helpers.ts imports `marked`, `DOMPurify`, and webview types — all available in Node/jsdom.
- **esbuild build must not bundle test files.** Verify esbuild entry points don't glob-capture test files.
- **DOMPurify requires DOM.** Only `renderMarkdown` uses it — isolate to jsdom environment on that specific test file.
- **`marked` renderer is configured at module scope** via side effects. Tests importing helpers.ts will trigger that config — should be fine but worth verifying.
- **`codeBlockIdCounter` is module-level mutable state** — markdown rendering tests may need to account for non-deterministic IDs or reset between tests.

## Common Pitfalls

- **Importing helpers.ts triggers marked config side effects** — This is fine for testing but the `codeBlockIdCounter` increments across tests. Use regex patterns for ID matching in assertions rather than exact string matches.
- **DOMPurify in Node without jsdom throws** — Must use `@vitest-environment jsdom` pragma on the markdown test file, not globally. Global jsdom would slow all tests.
- **state-parser parseGsdWorkflowState reads real filesystem** — Either export pure internals (preferred) or use `vi.mock('fs')` / temp dirs. Exporting is cleaner.

## Open Risks

- **marked v15 renderer API** — The custom renderer uses `{ href, text }` object params. Need to verify vitest + marked v15 work together without issues (low risk, but worth a quick smoke test early).
- **esbuild exclusion** — Need to confirm test files aren't accidentally included in the production bundle after adding them alongside source.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| vitest | onmax/nuxt-skills@vitest (662 installs) | Available but Nuxt-specific — not relevant |
| vitest | pproenca/dot-skills@vitest (331 installs) | Available but generic — vitest is simple enough without a skill |

No skills recommended for installation — vitest setup is straightforward for this project.

## Sources

- Codebase inspection of `src/webview/helpers.ts`, `src/extension/state-parser.ts`, `tsconfig.json`
- M006-CONTEXT.md and M006-ROADMAP.md for scope constraints
