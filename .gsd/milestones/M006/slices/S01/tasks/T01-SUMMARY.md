---
id: T01
parent: S01
milestone: M006
provides:
  - vitest test framework configured
  - 73 unit tests for all pure logic
key_files:
  - vitest.config.ts
  - src/webview/helpers.test.ts
  - src/extension/state-parser.test.ts
  - src/extension/state-parser.ts
key_decisions:
  - Exported parseActiveRef and parsePhase from state-parser.ts for direct testing
  - Used @vitest-environment jsdom pragma on helpers.test.ts only (not global)
  - Used real temp files for parseGsdWorkflowState tests instead of mocking fs
patterns_established:
  - Test files co-located with source as *.test.ts
  - Per-file jsdom environment via vitest pragma for DOM-dependent tests
observability_surfaces:
  - none
duration: 1 task
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T01: Install vitest, write unit tests for all pure logic

**Installed vitest with jsdom, wrote 73 tests covering all pure helpers, state-parser internals, and markdown rendering.**

## What Happened

Installed vitest and jsdom as devDependencies. Created `vitest.config.ts` with node default environment. Added `npm test` script. Exported `parseActiveRef` and `parsePhase` from state-parser.ts. Wrote comprehensive tests for 15 pure functions in helpers.ts (escapeHtml, escapeAttr, sanitizeUrl, formatCost, formatTokens, formatContextUsage, shortenPath, formatDuration, truncateArg, getToolCategory, getToolIcon, getToolKeyArg, isLikelyFilePath, formatRelativeTime, formatToolResult) plus renderMarkdown under jsdom. Wrote tests for parseActiveRef, parsePhase, and parseGsdWorkflowState using real temp files.

## Verification

- `npm test` — 73 tests pass across 2 test files (0 failures)
- `npm run build` — succeeds, no test files in bundle output
- esbuild uses explicit entry points (src/extension/index.ts, src/webview/index.ts) — test files never captured

## Diagnostics

none

## Deviations

none

## Known Issues

none

## Files Created/Modified

- `vitest.config.ts` — test runner configuration
- `src/webview/helpers.test.ts` — 61 tests for pure helpers + markdown rendering (jsdom)
- `src/extension/state-parser.test.ts` — 12 tests for parser functions
- `src/extension/state-parser.ts` — exported parseActiveRef and parsePhase
- `package.json` — added vitest/jsdom devDeps and test script
