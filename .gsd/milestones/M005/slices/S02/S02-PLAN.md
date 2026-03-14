# S02: Visual Polish — Context Bar, Stats, Header, Animations

**Goal:** Transform the header and status areas from plain text badges into an information-rich, visually refined interface. Add a context usage bar, improve stats presentation, tighten header layout, and add micro-interactions that give the UI presence.
**Demo:** Context usage shows as a thin color-coded bar below the header. Session stats are clear and glanceable. Tool calls have a shimmer animation when running. Header badges have refined grouping. Panels animate in/out smoothly.

## Must-Haves

- Context usage progress bar below header (green → amber → red with smooth transitions)
- Session stats improvement: clear cost + token breakdown in header or footer
- Running tool call shimmer/glow animation (replaces static spinner-only state)
- Header badge grouping refinement (visual separators between clusters)
- Smooth panel close animations (not just instant disappear)
- Streaming cursor refinement

## Tasks

- [ ] **T01: Context usage bar** `est:30m`
  - Why: Context pressure is the most important stat and currently buried in a text badge
  - Files: `src/webview/index.ts`, `src/webview/styles.css`
  - Do:
    - Add a thin (3px) progress bar element below the header, above overlay indicators
    - Color-code: green (0-70%), amber (70-90%), red (90%+) with smooth CSS transitions
    - Width driven by `state.sessionStats.contextPercent`
    - Bar hidden when no context data, visible on first stat update
    - Subtle pulse animation at critical (>90%) levels
    - Keep the text badge too — bar is supplementary
  - Verify: Build passes, bar appears in Extension Development Host
  - Done when: Context bar visually reflects token pressure with color transitions

- [ ] **T02: Header layout refinement + stats cleanup** `est:30m`
  - Why: Header badges lack visual hierarchy; footer stats are dense and hard to parse
  - Files: `src/webview/index.ts`, `src/webview/styles.css`
  - Do:
    - Add subtle separator dots or dividers between badge groups (model | thinking | cost+context)
    - Refine footer stats: use a cleaner layout with labeled sections instead of dense abbreviations
    - Style cost badge with a $ prefix and slightly bolder weight
    - Tweak spacing between header elements for breathing room
  - Verify: Build passes, header looks cleaner
  - Done when: Header has clear visual hierarchy between badge groups

- [ ] **T03: Tool call + streaming animations** `est:30m`
  - Why: Running tool calls lack visual presence; streaming cursor is basic
  - Files: `src/webview/styles.css`
  - Do:
    - Add a subtle shimmer/sweep animation on running tool blocks (CSS gradient sweep)
    - Refine the streaming cursor: make it a softer, smoother pulse
    - Add a subtle fade-in for tool completion state transitions
    - Ensure running tool border glow is more visible
  - Verify: Build passes, animations look good in Extension Development Host
  - Done when: Tool calls and streaming have refined visual feedback

- [ ] **T04: Build and verify** `est:15m`
  - Why: Ensure all visual changes work together cohesively
  - Files: (none — verification)
  - Do: Build, launch Extension Development Host, verify all changes
  - Verify: No regressions, all new visuals render correctly
  - Done when: Polish changes are cohesive and the UI feels elevated

## Files Likely Touched

- `src/webview/index.ts`
- `src/webview/styles.css`
