# M005: UI Interactions & Polish

**Vision:** Transform functional-but-plain UI into a refined, information-rich interface where every interaction feels intentional and every stat is glanceable.

## Success Criteria

- Thinking level is selectable from a dropdown that shows only levels available for the current model
- Non-reasoning models hide or disable the thinking control entirely
- Any session can be deleted from history, including the current one
- Context usage is displayed as a visual bar with color transitions at pressure thresholds
- Header badges are grouped with clear visual hierarchy
- Panel overlays open/close with smooth transitions
- Tool call running state has visual presence beyond a spinner

## Key Risks / Unknowns

- Available thinking levels per model aren't exposed to the webview — need to derive from `reasoning` boolean on AvailableModel, or add a new message type
- Context bar accuracy depends on session stats polling interval (currently 5s) — may look stale after rapid token consumption

## Verification Classes

- Contract verification: visual inspection in Extension Development Host
- Integration verification: thinking dropdown reflects model capabilities, delete-current triggers new session
- Operational verification: none
- UAT / human verification: UI feels polished and responsive at various sidebar widths

## Milestone Definition of Done

This milestone is complete only when all are true:

- Thinking dropdown works for reasoning and non-reasoning models
- Delete current session works end-to-end
- Context bar renders with correct color zones
- All visual polish changes are cohesive and don't regress existing functionality
- Extension builds cleanly and VSIX packages correctly

## Slices

- [x] **S01: Thinking dropdown + history delete** `risk:medium` `depends:[]`
  > After this: User can select thinking level from a dropdown and delete any session including the current one
- [x] **S02: Visual polish — context bar, stats, header, animations** `risk:low` `depends:[S01]`
  > After this: Context usage shows as a color-coded bar, header layout is refined, panels animate smoothly, tool calls have presence

## Boundary Map

### S01 → S02

Produces:
- Thinking dropdown overlay module (`src/webview/thinking-picker.ts`) following model-picker pattern
- Updated session-history.ts with delete-current support
- Updated index.ts wiring for both new interactions

Consumes:
- nothing (first slice)
