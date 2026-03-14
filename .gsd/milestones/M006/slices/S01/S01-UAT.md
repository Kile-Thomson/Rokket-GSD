# S01: Test framework + unit tests for pure logic — UAT

**Milestone:** M006
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: All deliverables are verifiable via CLI commands — no runtime UI or user interaction required

## Preconditions

- Node.js installed, `npm install` has been run

## Smoke Test

Run `npm test` — should complete with 73 passing tests and 0 failures.

## Test Cases

### 1. All tests pass

1. Run `npm test`
2. **Expected:** 73 tests pass across 2 test files, 0 failures

### 2. Build still works

1. Run `npm run build`
2. **Expected:** Build succeeds, produces `dist/` output without test files

### 3. Test files not in bundle

1. Run `npm run build`
2. Check `dist/` directory for any `.test.` files
3. **Expected:** No test files in dist/

## Edge Cases

### Test isolation

1. Run `npm test` twice in succession
2. **Expected:** Both runs pass — no state leakage between runs

## Failure Signals

- `npm test` reports any failures or errors
- `npm run build` fails after test framework changes
- Test files appear in `dist/` output

## Requirements Proved By This UAT

- none (no REQUIREMENTS.md)

## Not Proven By This UAT

- Integration test coverage for extension↔webview messaging
- DOM-coupled webview code correctness
- CI pipeline execution (deferred to S02)

## Notes for Tester

Straightforward — two commands, both should succeed.
