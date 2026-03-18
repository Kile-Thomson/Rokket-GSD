---
estimated_steps: 9
estimated_files: 15
---

# T01: Extract all CSS sections into feature-scoped partials

**Slice:** S04 — CSS Organization
**Milestone:** M013

## Description

Split the 5165-line `src/webview/styles.css` monolith into 12 feature-scoped CSS files under `src/webview/styles/`, create a barrel `index.css` with `@import` directives preserving cascade order, update the TS import, delete the original, and verify the build produces identical output.

The original file has 44 sections delimited by `/* === */` banner comments. These sections map to 12 logical groupings (documented below). esbuild natively resolves CSS `@import` statements, so the split is transparent to the build system.

## Steps

1. **Record baseline.** Run `npm run build`. Note the file size of `dist/webview/index.css` (expected ~122KB). Save this number for comparison in step 8.

2. **Read `src/webview/styles.css`** and identify section boundaries. The file uses `/* ===` banner comments to delimit sections. There are 44 such sections.

3. **Create `src/webview/styles/` directory.** (May already exist — create if missing.)

4. **Extract sections into 12 files.** Use the line ranges from the section mapping below. For each file, copy the exact CSS content from the corresponding line ranges in `styles.css`. Preserve all comments, whitespace, and formatting exactly as-is.

   **Section mapping (file → sections from styles.css):**

   | File | What to include |
   |------|----------------|
   | `base.css` | CSS Variables/resets (~L1-28), Layout primitives (~L29-40) |
   | `header.css` | Header section (~L41-314), Context Usage Bar (~L315-351) |
   | `dashboard.css` | Welcome Screen (~L512-642), Dashboard (~L643-1050) |
   | `messages.css` | Messages Container (~L446-469), Scroll FAB (~L470-511), Message Entries (~L1051-1313), Code Blocks (~L1314-1420), System Messages (~L2023-2053) |
   | `tools.css` | Tool Group (~L1421-1486), Thinking Block (~L1487-1540), Thinking Dots (~L1541-1573), Tool Call Blocks (~L1574-2022) |
   | `dialogs.css` | Slash Command Menu (~L2054-2100), Model Picker (~L2101-2258), Thinking Picker (~L2259-2381), Session History Panel (~L2382-2623) |
   | `input.css` | Input Area (~L2624-2835), Image Preview (~L2836-2885), Footer/Status Bar (~L2886-2940) |
   | `overlays.css` | Overlay Indicators (~L352-445), Inline UI Requests (~L2941-3198), Update Card (~L3232-3374), Changelog (~L3397-3548), What's New (~L3615-3717), Settings Dropdown (~L3812-3918) |
   | `utilities.css` | File Path Links (~L3199-3214), Selection & Copy (~L3215-3231), Header version badge (~L3375-3396), Screen reader (~L3549-3564), Focus indicators (~L3565-3580), Streaming hide (~L3581-3588), Loading spinner (~L3589-3614), Toasts (~L3718-3755), Responsive (~L3756-3769), Stale Echo (~L3770-3811) |
   | `themes.css` | PHOSPHOR theme (~L3919-4151), CLARITY theme (~L4152-4331), FORGE theme (~L4332-4514) |
   | `progress.css` | Auto-Mode Progress Widget (~L4515-4676), Model Badge Flash (~L4677-4702) |
   | `visualizer.css` | Workflow Visualizer Overlay (~L4703-5165) |

   **IMPORTANT:** Line numbers are approximate — use the `/* ===` banner comments as the actual delimiters. Read the file and find each section by its banner text, not by line number alone.

   **IMPORTANT:** The sections in `messages.css`, `overlays.css`, and `utilities.css` are non-contiguous in the original file. You must extract each section from its actual location and concatenate them in their original order within the new file.

5. **Create `src/webview/styles/index.css`** barrel file with these exact imports (order preserves cascade):
   ```css
   @import "./base.css";
   @import "./header.css";
   @import "./dashboard.css";
   @import "./messages.css";
   @import "./tools.css";
   @import "./dialogs.css";
   @import "./input.css";
   @import "./overlays.css";
   @import "./progress.css";
   @import "./visualizer.css";
   @import "./themes.css";
   @import "./utilities.css";
   ```

   **CRITICAL:** The import order must match the original section order in styles.css to preserve CSS cascade/specificity. The order above groups sections logically while preserving the correct cascade. If unsure, prefer the order in which sections appear in the original file — put sections that appear earlier in styles.css earlier in the barrel.

   Actually — to be safe, the barrel should import files in the order their **first section** appears in the original file:
   - base.css (L1) → header.css (L41) → overlays.css (first section L352) → messages.css (first section L446) → dashboard.css (L512) → tools.css (L1421) → dialogs.css (L2054) → input.css (L2624) → utilities.css (first section L3199) → themes.css (L3919) → progress.css (L4515) → visualizer.css (L4703)

   Use this order in the barrel file.

6. **Update `src/webview/index.ts`.** Find the line `import "./styles.css"` (expected around line 9) and change it to `import "./styles/index.css"`.

7. **Delete `src/webview/styles.css`.** The original monolith is no longer needed.

8. **Build and compare.** Run `npm run build`. Check that `dist/webview/index.css` exists and its size is within 5% of the baseline from step 1. Minor whitespace differences at `@import` boundaries are expected and acceptable.

9. **Run tests.** Run `npm test` to confirm nothing is broken. CSS split shouldn't affect tests, but this confirms no import path breakage.

## Must-Haves

- [ ] All 12 CSS partial files exist under `src/webview/styles/`
- [ ] Barrel `index.css` imports all 12 partials in correct cascade order
- [ ] `src/webview/index.ts` imports `./styles/index.css` instead of `./styles.css`
- [ ] Original `src/webview/styles.css` is deleted
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `dist/webview/index.css` size within 5% of pre-split baseline
- [ ] No partial file exceeds 600 lines

## Verification

- `npm run build` succeeds without errors
- `npm test` — all existing tests pass
- `dist/webview/index.css` file exists and size is within 5% of baseline (~122KB)
- `wc -l src/webview/styles/*.css` — no file exceeds 600 lines
- `ls src/webview/styles.css` — file does not exist (deleted)

## Observability Impact

- **Build size signal:** The `dist/webview/index.css` file size serves as a correctness proxy — size within 5% of baseline confirms no CSS was lost or duplicated.
- **Inspection surface:** Individual partial files under `src/webview/styles/` can be inspected independently, making it easier to locate CSS issues by feature area.
- **Failure visibility:** If a partial is missing or misnamed, esbuild will fail with a clear `@import` resolution error pointing to the exact file.
- **No new runtime signals** — this is a build-time reorganization only; the shipped CSS bundle is identical.

## Inputs

- `src/webview/styles.css` — the 5165-line monolith to split (read, then delete)
- `src/webview/index.ts` — contains the CSS import to update (line ~9)

## Expected Output

- `src/webview/styles/base.css` — ~40 lines (variables, resets, layout)
- `src/webview/styles/header.css` — ~310 lines (header bar, context bar)
- `src/webview/styles/messages.css` — ~530 lines (message entries, code blocks, system messages)
- `src/webview/styles/tools.css` — ~570 lines (tool calls, thinking blocks)
- `src/webview/styles/dashboard.css` — ~540 lines (welcome screen, dashboard)
- `src/webview/styles/dialogs.css` — ~570 lines (model picker, thinking picker, session history)
- `src/webview/styles/input.css` — ~320 lines (input area, image preview, footer)
- `src/webview/styles/overlays.css` — ~470 lines (overlay indicators, UI requests, update card, changelog)
- `src/webview/styles/progress.css` — ~190 lines (auto-progress, model badge flash)
- `src/webview/styles/visualizer.css` — ~463 lines (workflow visualizer)
- `src/webview/styles/themes.css` — ~596 lines (Phosphor, Clarity, Forge themes)
- `src/webview/styles/utilities.css` — ~140 lines (file links, copy, toasts, responsive)
- `src/webview/styles/index.css` — barrel file with 12 `@import` directives
- `src/webview/index.ts` — updated import path
- `src/webview/styles.css` — deleted
