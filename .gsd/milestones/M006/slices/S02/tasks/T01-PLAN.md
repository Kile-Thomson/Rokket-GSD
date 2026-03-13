---
estimated_steps: 5
estimated_files: 5
---

# T01: Install ESLint, configure, fix errors, and add CI workflow

**Slice:** S02 — ESLint + CI pipeline
**Milestone:** M006

## Description

Install ESLint with typescript-eslint, create flat config, add npm run lint script, fix all lint errors in the codebase, and create a GitHub Actions CI workflow that runs lint + test on push to main and PRs.

## Steps

1. Install `eslint`, `typescript-eslint`, `@eslint/js` as devDependencies
2. Create `eslint.config.mjs` with flat config — `@eslint/js` recommended + `tseslint.configs.recommended`, ignore `dist/`
3. Add `"lint": "eslint src/"` to package.json scripts
4. Run `npm run lint`, fix all errors — use `--fix` for auto-fixable, manually fix the rest. If a rule produces excessive noise without value, disable it in config with a comment explaining why.
5. Create `.github/workflows/ci.yml` — trigger on push to main and pull_request, steps: checkout, setup-node@v4 with node 20, npm ci, npm run lint, npm test

## Must-Haves

- [ ] ESLint flat config with typescript-eslint recommended rules
- [ ] `npm run lint` exits 0 with no errors
- [ ] CI workflow triggers on push to main and pull_request
- [ ] CI runs both lint and test steps
- [ ] `npm test` still passes (no regressions from lint fixes)

## Verification

- `npm run lint` — exits 0
- `npm test` — all 73 tests pass
- Review `ci.yml` for correct triggers (push main, pull_request) and steps (lint, test)

## Inputs

- `package.json` — existing scripts and devDependencies from S01
- `.github/workflows/release.yml` — pattern to mirror for CI setup steps
- S01 summary — test file pattern is `src/**/*.test.ts`, lint should cover these

## Expected Output

- `eslint.config.mjs` — flat ESLint config
- `package.json` — updated with lint script and eslint devDependencies
- `.github/workflows/ci.yml` — CI workflow
- Various `src/**/*.ts` — lint fixes applied
