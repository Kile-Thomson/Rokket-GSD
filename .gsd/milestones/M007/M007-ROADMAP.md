# M007: UX Polish & Interaction Improvements

**Vision:** A polished, modern chat experience with the standard UX patterns users expect — scroll navigation, timestamps, quick actions, copy, toasts, thinking management, message editing, and input flexibility.

## Success Criteria

- User can jump to latest message after scrolling up
- Messages show timestamps
- Welcome screen offers clickable quick actions
- Full assistant responses are copyable with one click
- Actions produce brief toast feedback
- Thinking blocks default to collapsed with size indicator
- User can edit and resend a previous message
- Input area is manually resizable by dragging

## Key Risks / Unknowns

- Message edit/resend needs to interact with prompt re-submission — low risk, protocol already supports it

## Slices

- [x] **S01: Scroll-to-bottom FAB, timestamps, quick actions** `risk:low` `depends:[]`
  > After this: floating ↓ button appears when scrolled up, messages show timestamps, welcome screen has clickable action chips
- [x] **S02: Copy response, toast system, thinking collapse** `risk:low` `depends:[]`
  > After this: assistant turns have a copy button, actions show auto-dismissing toasts, thinking blocks default collapsed with line count
- [x] **S03: Message edit/resend, drag-to-resize input** `risk:low` `depends:[]`
  > After this: user can click to edit sent messages and resend, input area is draggable to resize

## Boundary Map

### S01 → S02

Produces:
- Toast notification system (S02 builds it, but S01 could use it for future features)

Consumes:
- nothing (independent)

### S02 → S03

Produces:
- nothing (independent)

Consumes:
- nothing (independent)
