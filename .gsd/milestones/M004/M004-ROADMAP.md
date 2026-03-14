# M004: Header Enhancements

**Vision:** A header that shows workflow context at a glance and is comfortably readable.

## Success Criteria

- User can see current GSD phase and active milestone/slice/task in the header
- Header shows "Self-directed" when no `.gsd/` structure exists
- All header badges and buttons are ~30% larger than v0.2.6
- Layout doesn't break at narrow sidebar widths (≤400px)

## Key Risks / Unknowns

- Narrow sidebar overflow with added workflow badge — handle with responsive truncation

## Verification Classes

- Contract verification: visual inspection in VS Code extension host
- Integration verification: workflow badge updates after agent_end events
- Operational verification: none
- UAT / human verification: header feels right at various sidebar widths

## Milestone Definition of Done

This milestone is complete only when all are true:

- Workflow state badge renders correctly for all phases
- Header sizing is visibly improved
- Responsive behavior works at narrow widths
- STATE.md parsing handles missing files, partial data, and format variations

## Slices

- [x] **S01: Workflow badge + header sizing** `risk:low` `depends:[]`
  > After this: Header shows live GSD workflow state and all elements are comfortably readable
