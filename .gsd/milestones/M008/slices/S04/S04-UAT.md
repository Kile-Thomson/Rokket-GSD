# S04: Accessibility — ARIA & keyboard nav — UAT

**Milestone:** M008
**Written:** 2026-03-14

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: ARIA attributes verified via automated tests and grep counts; keyboard nav and focus behavior require live runtime verification in the extension

## Preconditions

- Extension built and loaded in VS Code (F5 debug or installed VSIX)
- A chat session started with at least one assistant response containing tool calls
- Browser dev tools accessible via Help → Toggle Developer Tools (for DOM inspection)

## Smoke Test

Tab from the chat input area — focus should visibly move to header toolbar buttons with an outline. Arrow keys should move between toolbar buttons.

## Test Cases

### 1. Tool block header ARIA attributes

1. Send a message that triggers tool calls (e.g., "read package.json")
2. Open Developer Tools → Elements panel
3. Inspect a `.gsd-tool-header` element
4. **Expected:** Element has `role="button"`, `tabindex="0"`, `aria-label="Toggle {toolName} details"`, and `aria-expanded="false"` (or `"true"` if open)

### 2. Tool block keyboard activation

1. Tab to a collapsed tool block header (focus outline visible)
2. Press Enter
3. **Expected:** Tool block expands, `aria-expanded` changes to `"true"`
4. Press Space
5. **Expected:** Tool block collapses, `aria-expanded` changes to `"false"`

### 3. Header toolbar roving tabindex

1. Tab to the header toolbar area (model name button)
2. Press ArrowRight repeatedly
3. **Expected:** Focus moves to next toolbar button. Only the focused button has `tabindex="0"`, others have `tabindex="-1"`
4. Press Home
5. **Expected:** Focus jumps to first toolbar button
6. Press End
7. **Expected:** Focus jumps to last toolbar button

### 4. Copy button labels

1. Get a response with a code block
2. Inspect the code block's copy button in dev tools
3. **Expected:** Has `aria-label="Copy code"`
4. Inspect the copy-response button (bottom of assistant message)
5. **Expected:** Has `aria-label="Copy response"`, SVG has `aria-hidden="true"`

### 5. Model picker listbox

1. Click the model name in the header to open the model picker
2. Inspect the picker container in dev tools
3. **Expected:** Container has `role="listbox"`, each model option has `role="option"` with `aria-selected`
4. Press ArrowDown/ArrowUp
5. **Expected:** `aria-selected` moves between options, focused option scrolls into view
6. Press Enter
7. **Expected:** Model selected, picker closes, focus returns to the model button in the header

### 6. Thinking picker listbox

1. Click the thinking level indicator to open the thinking picker
2. **Expected:** Container has `role="listbox"`, options have `role="option"` + `aria-selected`
3. ArrowDown/ArrowUp navigates between levels
4. Press Escape
5. **Expected:** Picker closes, focus returns to the thinking level button

### 7. UI dialog focus trap

1. Trigger a confirm dialog (e.g., via a slash command that shows confirmation)
2. **Expected:** Dialog has `role="dialog"`, `aria-modal="true"`, `aria-label`
3. Press Tab repeatedly
4. **Expected:** Focus cycles within dialog buttons — wraps from last to first
5. Press Shift+Tab
6. **Expected:** Focus wraps from first button back to last
7. Press Escape or click Cancel
8. **Expected:** Dialog closes, focus returns to the element that was focused before the dialog opened

### 8. Session history panel

1. Open session history (via header button or slash command)
2. Inspect the panel in dev tools
3. **Expected:** Panel has `role="complementary"`, `aria-label="Session history"`
4. Close the panel with its close button or Escape
5. **Expected:** Focus returns to the button that opened it

## Edge Cases

### Tool group header ARIA (streaming)

1. Send a message that triggers multiple consecutive read-only tool calls (e.g., "read all test files")
2. Wait for tool calls to stream and auto-group
3. Inspect the group `<summary>` element
4. **Expected:** Has `role="button"`, `tabindex="0"`, `aria-label`, `aria-expanded`
5. Toggle with Enter/Space — `aria-expanded` updates

### Rapid overlay switching

1. Open model picker → press Escape → immediately open thinking picker
2. **Expected:** Focus correctly enters thinking picker, not stranded on model button
3. Press Escape
4. **Expected:** Focus returns to thinking picker trigger, not model picker trigger

## Failure Signals

- Any interactive element missing `role`, `tabindex`, or `aria-label` in DOM inspection
- Tab key not moving focus to tool block headers or toolbar buttons
- Enter/Space not toggling tool blocks
- Arrow keys not navigating in pickers or toolbar
- Focus lost (stuck on body) after closing an overlay
- `aria-expanded` not updating when expanding/collapsing

## Requirements Proved By This UAT

- None (no REQUIREMENTS.md)

## Not Proven By This UAT

- Screen reader announcement of new messages (live regions not implemented in this slice)
- Full screen reader compatibility testing (requires actual screen reader)

## Notes for Tester

- The tool-grouping.ts grep count is 1 line rather than the plan's 5+ target — this is because all ARIA attributes are on a single template literal. Functionally complete.
- Focus-visible outlines use VS Code's `--vscode-focusBorder` color. If outlines seem invisible, check your theme's focus border setting.
