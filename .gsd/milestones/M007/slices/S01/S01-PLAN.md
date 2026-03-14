# S01: Scroll-to-bottom FAB, Timestamps, Quick Actions

## Tasks

- [ ] **T01: Scroll-to-bottom FAB** `est:20min`
  - Floating ↓ button in bottom-right of messages area
  - Appears when scrolled up >100px from bottom, hides at bottom
  - Click scrolls smoothly to bottom
  - Styled with VS Code theme variables, subtle animation
  - Update scrollToBottom helper to track "user has scrolled up" state

- [ ] **T02: Message timestamps** `est:15min`
  - Show relative timestamp ("2m ago", "1h ago") on each message entry
  - Update timestamps periodically (every 30s)
  - Small, muted text — doesn't compete with message content
  - Absolute time on hover (tooltip)

- [ ] **T03: Welcome screen quick actions** `est:15min`
  - 3-4 clickable chips below the welcome text
  - Actions: "/gsd auto", "/gsd status", "Review this project", custom prompt
  - Clicking inserts the text and sends it
  - Disappear once a conversation starts (welcome screen hides)

## Verification

- Build succeeds
- Visual inspection in running extension
- FAB appears/hides on scroll, timestamps render, chips send messages
