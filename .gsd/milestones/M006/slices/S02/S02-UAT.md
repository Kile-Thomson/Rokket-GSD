# S02: ESLint + CI pipeline — UAT

**Milestone:** M006
**Written:** 2026-03-13

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: Linting and CI are fully verifiable via command output and file inspection — no runtime or UI behavior to check.

## Preconditions

- Repository cloned with dependencies installed (`npm ci`)

## Smoke Test

Run `npm run lint && npm test` — both exit 0 with no errors.

## Test Cases

### 1. Lint passes clean

1. Run `npm run lint`
2. **Expected:** Exits 0 with no output (no errors or warnings)

### 2. Tests still pass

1. Run `npm test`
2. **Expected:** 73 tests pass across 2 files, exit 0

### 3. CI workflow structure

1. Open `.github/workflows/ci.yml`
2. **Expected:** Triggers on `push` to `main` and `pull_request`. Job uses `ubuntu-latest`, Node 20, runs `npm ci`, `npm run lint`, `npm test` in sequence.

## Edge Cases

### Lint on new files

1. Create a new `.ts` file in `src/` with a deliberate error (e.g., unused variable)
2. Run `npm run lint`
3. **Expected:** Reports the error (proving ESLint is scanning src/)

## Failure Signals

- `npm run lint` exits non-zero or reports errors
- `npm test` fails or test count drops below 73
- CI workflow missing triggers or steps

## Requirements Proved By This UAT

- none (no REQUIREMENTS.md)

## Not Proven By This UAT

- CI workflow actually running on GitHub (requires a push/PR to trigger)

## Notes for Tester

CI workflow correctness is verified by file inspection only — it hasn't been triggered on GitHub yet. First push to main or PR will be the live proof.
