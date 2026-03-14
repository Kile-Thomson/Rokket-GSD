---
id: S01
parent: M006
milestone: M006
provides:
  - vitest test framework configured with npm test script
  - 73 unit tests covering all pure logic (helpers, state-parser, markdown rendering)
  - test file conventions (co-located *.test.ts, per-file jsdom pragma)
requires: []
affects:
  - S02
key_files:
  - vitest.config.ts
  - src/webview/helpers.test.ts
  - src/extension/state-parser.test.ts
  - src/extension/state-parser.ts
key_decisions:
  - Exported parseActiveRef and parsePhase from state-parser.ts for direct unit testing
  - Used per-file @vitest-environment jsdom pragma instead of global jsdom (keeps non-DOM tests fast)
  - Used real temp files for parseGsdWorkflowState tests instead of mocking fs
patterns_established:
  - Test files co-located with source as *.test.ts
  - Per-file jsdom environment via vitest pragma for DOM-dependent tests
  - Regex patterns for code block IDs in markdown assertions (module-level mutable counter)
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M006/slices/S01/tasks/T01-SUMMARY.md
duration: 1 task
verification_result: passed
completed_at: 2026-03-13
---

# S01: Test framework + unit tests for pure logic

**Vitest installed with 73 passing unit tests covering all pure helpers, state-parser internals, and markdown rendering.**

## What Happened

Installed vitest and jsdom as devDependencies. Created vitest.config.ts with node default environment and `src/**/*.test.ts` include pattern. Added `npm test` script to package.json. Exported `parseActiveRef` and `parsePhase` from state-parser.ts to make them directly testable. Wrote 61 tests in helpers.test.ts covering 15 pure functions (escapeHtml, escapeAttr, sanitizeUrl, formatCost, formatTokens, formatContextUsage, shortenPath, formatDuration, truncateArg, getToolCategory, getToolIcon, getToolKeyArg, isLikelyFilePath, formatRelativeTime, formatToolResult) plus renderMarkdown under jsdom. Wrote 12 tests in state-parser.test.ts for parseActiveRef, parsePhase, and parseGsdWorkflowState using real temp files. esbuild already uses explicit entry points so test files are never bundled.

## Verification

- `npm test` — 73 tests pass across 2 test files, 0 failures
- `npm run build` — succeeds, test files not included in bundle output

## Deviations

none

## Known Limitations

- Only pure functions tested — DOM-coupled webview code (renderer, index, slash-menu) has no coverage
- No integration tests for extension↔webview message flow

## Follow-ups

none

## Files Created/Modified

- `vitest.config.ts` — test runner configuration
- `src/webview/helpers.test.ts` — 61 tests for pure helpers + markdown rendering (jsdom)
- `src/extension/state-parser.test.ts` — 12 tests for parser functions
- `src/extension/state-parser.ts` — exported parseActiveRef and parsePhase
- `package.json` — added vitest/jsdom devDeps and test script

## Forward Intelligence

### What the next slice should know
- `npm test` script exists and runs vitest. S02 can add `npm run lint` alongside it in CI.
- Test file pattern is `src/**/*.test.ts` — lint config should include these files.

### What's fragile
- renderMarkdown tests use regex for code block IDs because the counter is module-level mutable state — test order matters if tests share module scope

### Authoritative diagnostics
- `npm test` output — shows pass/fail counts and duration, trustworthy single source of test health

### What assumptions changed
- none — slice executed as planned
