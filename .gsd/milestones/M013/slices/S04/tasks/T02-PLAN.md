---
estimated_steps: 7
estimated_files: 0
---

# T02: Final verification and bundle size audit

**Slice:** S04 — CSS Organization
**Milestone:** M013

## Description

Clean verification pass to confirm the CSS split from T01 is correct. Check every partial's line count, confirm bundle sizes meet milestone criteria, ensure lint and tests pass. This is a read-only audit task — no files should be modified.

## Steps

1. **Count lines in each partial.** Run `wc -l src/webview/styles/*.css`. All 12 partials must be ≤600 lines.

2. **Build and record sizes.** Run `npm run build`. Record extension bundle size, webview JS size, and webview CSS size.

3. **Compare against baselines.** Extension ~144KB, webview JS ~335KB, webview CSS ~122KB. All must be within 15%.

4. **Run lint.** Run `npm run lint`. Must pass clean with no errors.

5. **Run tests.** Run `npm test`. All existing tests must pass.

6. **Verify barrel file.** Confirm `src/webview/styles/index.css` has exactly 12 `@import` lines.

7. **Verify original deleted.** Confirm `src/webview/styles.css` does not exist.

## Must-Haves

- [ ] All 12 partial files ≤600 lines
- [ ] `npm run build` succeeds
- [ ] Bundle sizes within 15% of baselines
- [ ] `npm run lint` passes clean
- [ ] `npm test` — all tests pass
- [ ] Barrel has exactly 12 `@import` directives
- [ ] Original `src/webview/styles.css` does not exist

## Verification

- `wc -l src/webview/styles/*.css` — no partial exceeds 600 lines
- `npm run build` — succeeds, sizes within 15% of baselines
- `npm run lint` — clean
- `npm test` — all tests pass
- `grep -c "@import" src/webview/styles/index.css` — returns 12
- `ls src/webview/styles.css` — file not found

## Observability Impact

No new runtime signals — this is a verification-only task. Produces recorded size baselines in the task summary for future comparison.

## Inputs

- `src/webview/styles/*.css` — the 12 partials + barrel from T01
- `dist/` — build output

## Expected Output

- No file changes — this is a read-only audit
- Task summary documenting all verification results and recorded baselines
