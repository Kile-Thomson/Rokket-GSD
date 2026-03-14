# M008: Research — Hardening, Performance & UX

**Completed:** 2026-03-14

## Codebase Audit Findings

### Speed
- **index.ts is 2,379 lines** — monolith with 38 functions and 31 event listeners
- **3 duplicate `formatNotes` functions** — identical markdown-to-HTML in showUpdateCard, showWhatsNew, showChangelog
- **No message batching** beyond rAF for text segments
- **Bundle size is fine** — 427KB total (100KB ext + 259KB webview + 68KB CSS)

### Security
- **47 silent catch blocks**, 15 are `catch { /* ignored */ }` — some appropriate, some swallowing real errors
- **107 innerHTML calls** with manual escapeHtml — DOMPurify only used in renderer for markdown
- **CSP is solid** — nonce-based script-src, proper cspSource
- **RPC buffer has no size limit** — could OOM from misbehaving pi process

### UI/UX
- **Zero ARIA attributes** — only 2 lines mention accessibility in entire webview
- **No keyboard navigation** — header actions, model picker, etc. are mouse-only
- **CSS is 3,350 lines in one file** — no organization beyond section comments
- **No loading indicators** — changelog, dashboard, model fetch show nothing while loading
- **No tool call grouping** — each read_file/search shows as separate entry

### Stability
- **82 tests across 4 files** — zero tests for webview-provider.ts (1,497 lines), update-checker.ts, dashboard-parser.ts
- **Prompt watchdog timer leak** — inner setTimeout handle not stored in map, can't be cancelled
- **retainContextWhenHidden: true** — keeps webview alive, memory never freed for inactive sessions
- **No error recovery for webview crashes** — entire panel goes blank

## Competitive Analysis (Cline, Continue, Cody)

### What they have that we don't
1. **Cline: Tool call grouping** — low-stakes ops collapsed into "Read 3 files" summaries
2. **Cline: react-virtuoso** — virtual scrolling for long conversations (only Cline does this)
3. **Cline: Declarative button state machine** — maps message states to button configs
4. **Cline: Auto-retry with countdown UI** — "Attempt 2 of 3 — Retrying in 5s..."
5. **Continue: Cmd+F chat search** — text search across history
6. **Continue: Conversation compaction** — summarize + dim older messages
7. **Cody: Scrollbar markers** — dots showing human message positions
8. **Cody: Smart Apply prefetching** — diff computation starts when code block finishes
9. **Cody: Code block completion detection** — gates Copy/Apply buttons during streaming
10. **All three: Per-message error boundaries** — one bad message doesn't crash chat

### What we already do well
- Sequential segment streaming with rAF batching (matches industry)
- Multi-session support with independent processes
- Theme-aware CSS variables (good coverage)
- DOMPurify for markdown content
- Process resilience layers (watchdog, health monitoring, force-kill)
