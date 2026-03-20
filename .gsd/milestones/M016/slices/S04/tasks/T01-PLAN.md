---
estimated_steps: 4
estimated_files: 2
---

# T01: Configure Vitest v8 coverage reporting

**Slice:** S04 — Quick Wins & Coverage Reporting
**Milestone:** M016

## Description

Install `@vitest/coverage-v8` and configure Vitest to generate coverage reports. This establishes the coverage baseline before any code changes (per D023: measure first, then set CI gate 5% below current). The coverage provider must match the vitest version (`^4.1.0`). No aggressive threshold — just measurement and reporting.

## Steps

1. Run `npm install --save-dev @vitest/coverage-v8@^4.1.0` to add the coverage provider
2. Edit `vitest.config.ts` to add coverage configuration:
   ```ts
   coverage: {
     provider: 'v8',
     reporter: ['text', 'text-summary'],
     reportsDirectory: './coverage',
     include: ['src/**/*.ts'],
     exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
   }
   ```
3. Add a `"test:coverage": "vitest run --coverage"` script to `package.json` scripts section
4. Run `npx vitest --run --coverage` to verify the report generates successfully and record the baseline percentages

## Must-Haves

- [ ] `@vitest/coverage-v8` in devDependencies at `^4.1.0`
- [ ] `vitest.config.ts` has `coverage.provider: 'v8'` configured
- [ ] `npx vitest --run --coverage` generates a coverage report with per-file percentages
- [ ] All 618+ tests still pass
- [ ] `coverage/` directory is in `.gitignore`

## Verification

- `npx vitest --run --coverage` — prints coverage report, all tests pass, exit code 0
- `grep -q "coverage-v8" package.json` — dependency present
- `grep -q "provider.*v8" vitest.config.ts` — config present

## Inputs

- `vitest.config.ts` — current config with no coverage section
- `package.json` — has `vitest: "^4.1.0"` in devDependencies, `"test": "vitest run"` in scripts

## Expected Output

- `vitest.config.ts` — updated with coverage provider configuration
- `package.json` — updated with `@vitest/coverage-v8` devDependency and `test:coverage` script
- Coverage report baseline percentages recorded (informational, no threshold enforcement yet)

## Observability Impact

- **New signal:** `npx vitest --run --coverage` now emits per-file line/branch/function/statement percentages to stdout via the `text` and `text-summary` reporters. Previously, no coverage data was available.
- **Inspection surface:** Run `npm run test:coverage` to regenerate the coverage report at any time. The `coverage/` directory contains detailed data (gitignored, ephemeral).
- **Failure visibility:** If the coverage provider fails to load, Vitest prints a clear error: `Error: Failed to load coverage provider`. A missing `@vitest/coverage-v8` dependency produces: `Cannot find module '@vitest/coverage-v8'`.
- **Future agent use:** Baseline percentages recorded in the task summary establish the "measure first" anchor for D023's CI gate threshold.
