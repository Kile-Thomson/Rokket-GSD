---
estimated_steps: 5
estimated_files: 4
---

# T01: Add validate-milestone phase label and new slash menu entries

**Slice:** S02 — Validate-Milestone Phase & New Slash Commands
**Milestone:** M014

## Description

Add the `validate-milestone` phase to the progress widget's phase formatter and render it with a checkmark icon. Add two new slash menu entries (`/gsd update` and `/gsd export`) to the `gsdSubcommands` array. Write tests for both additions.

This follows existing patterns exactly — a new `case` in a switch statement and new entries in an array.

## Steps

1. In `src/webview/auto-progress.ts`, find the `formatPhase()` function (~line 298). Add a new case before `default`: `case "validate-milestone": return "VALIDATING";`

2. In `src/webview/auto-progress.ts`, find the phase rendering in the innerHTML template (~line 165, the `gsd-auto-progress-phase` span). Add a checkmark icon for the validate-milestone phase. The `modeIcon` variable (~line 137) handles auto/next/paused icons. For the phase-specific icon, modify the phase span to prepend `✓ ` when the raw phase is `"validate-milestone"`. This can be done by computing a `phaseIcon` variable: `const phaseIcon = data.phase === "validate-milestone" ? "✓ " : "";` and inserting it in the template: `<span class="gsd-auto-progress-phase">${phaseIcon}${escapeHtml(phase)}</span>`.

3. In `src/webview/slash-menu.ts`, find the `gsdSubcommands` array (~line 115). Add two entries after the existing commands (before the `help` section is fine):
   - `{ name: "gsd update", desc: "Update GSD artifacts and status", sendOnSelect: true }`
   - `{ name: "gsd export", desc: "Export milestone report (HTML)" }` — note: NO `sendOnSelect` property, so it defaults to undefined/false, letting the user append `--html --all` arguments.

4. In `src/webview/__tests__/auto-progress.test.ts`, add a test case inside the existing describe block:
   ```typescript
   it("renders validate-milestone phase with checkmark icon", () => {
     const data = makeProgressData({ phase: "validate-milestone" });
     autoProgress.updateAutoProgress(data);
     const widget = document.querySelector(".gsd-auto-progress-phase");
     expect(widget?.textContent).toContain("VALIDATING");
     expect(widget?.textContent).toContain("✓");
   });
   ```

5. Check if `src/webview/__tests__/slash-menu.test.ts` exists. If not, check if there are slash menu tests in another file. Create or add tests that verify `buildItems()` includes items named `"gsd update"` and `"gsd export"`. The `buildItems()` function is not currently exported — you may need to export it. If exports are blocked by the module structure, verify the entries exist by checking the `gsdSubcommands` array directly in a test, or test through the public `showSlashMenu()` API if feasible. At minimum, add a simple unit test that imports the module and verifies the commands are included.

## Must-Haves

- [ ] `formatPhase("validate-milestone")` returns `"VALIDATING"`
- [ ] Checkmark icon (`✓`) renders in the phase span when phase is `validate-milestone`
- [ ] `gsdSubcommands` array includes `{ name: "gsd update", sendOnSelect: true }`
- [ ] `gsdSubcommands` array includes `{ name: "gsd export" }` without `sendOnSelect`
- [ ] Test in auto-progress.test.ts passes for validate-milestone phase
- [ ] All existing tests pass (`npx vitest run`)

## Verification

- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — new test passes
- `npx vitest run` — full suite passes with no regressions

## Inputs

- `src/webview/auto-progress.ts` — existing `formatPhase()` switch and render template
- `src/webview/slash-menu.ts` — existing `gsdSubcommands` array pattern
- `src/webview/__tests__/auto-progress.test.ts` — existing test structure and `makeProgressData()` helper

## Expected Output

- `src/webview/auto-progress.ts` — new case in `formatPhase()`, checkmark icon in render template
- `src/webview/slash-menu.ts` — two new entries in `gsdSubcommands`
- `src/webview/__tests__/auto-progress.test.ts` — new test case for validate-milestone phase
