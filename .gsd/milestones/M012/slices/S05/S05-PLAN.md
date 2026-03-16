# S05: Slash Menu & Command Parity

## Tasks

- [x] **T01: Add new gsd subcommands to slash menu** `est:10min`
- [x] **T02: Handle visualize as local webview command** `est:5min`
- [x] **T03: Build & test** `est:10min`

## Approach

### T01: Add new gsd subcommands
Add to `gsdSubcommands` in `slash-menu.ts`:
- `gsd steer` — Redirect auto-mode to different priorities (sendOnSelect: false, takes args)
- `gsd knowledge` — View or add to project knowledge base (sendOnSelect: true)
- `gsd config` — View or modify GSD configuration (sendOnSelect: true)
- `gsd capture` — Capture a thought during auto-mode (sendOnSelect: false, takes args)
- `gsd visualize` — Open workflow visualizer (handled locally, not sent as prompt)

### T02: Handle visualize as local webview command
`/gsd visualize` in the slash menu should open the visualizer overlay (webview-level), not send as a prompt.

### T03: Build & test
Build, lint, verify existing tests still pass.
