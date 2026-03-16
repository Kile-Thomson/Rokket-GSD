# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? |
|---|------|-------|----------|--------|-----------|------------|
| 1 | 2026-03-12 | arch | UI framework | Vanilla DOM | Keeps bundle small (~136KB VSIX), avoids framework lock-in, sufficient for current complexity | Yes |
| 2 | 2026-03-12 | arch | Bundler | esbuild | Fast builds, handles both CJS (extension) and IIFE (webview) targets, CSS loading built in | Yes |
| 3 | 2026-03-12 | arch | Markdown rendering | marked v15 | Lightweight, extensible renderer, supports GFM, custom code block and link renderers | Yes |
| 4 | 2026-03-12 | arch | Streaming model | Sequential segments with rAF batching | Text/thinking/tool segments append in arrival order, no full re-renders, smooth performance | No |
| 5 | 2026-03-12 | arch | Process communication | JSON-RPC over stdin/stdout (JSONL) | Standard protocol, works cross-platform, no port conflicts, child process lifecycle management | No |
| 6 | 2026-03-12 | arch | Multi-session support | One RPC client per sidebar/tab | Each session is independent with its own GSD process, prevents cross-contamination | Yes |
| 7 | 2026-03-12 | arch | Session listing strategy | Direct filesystem read of JSONL files | Importing SessionManager from pi-coding-agent resolves to wrong config dir (.pi vs .gsd) due to getPackageDir() walking to pi-coding-agent's package.json. Direct read is ~50 lines, self-contained, and correct. RPC switch_session still handles the complex load/migrate/restore. | No |
| 8 | 2026-03-13 | arch | GSD spawn on Windows | Parse .cmd wrapper, invoke node directly | `shell: true` with .cmd wrapper fails when user path has spaces (e.g., `C:\Users\First Last\...`), triggers DEP0190 on Node 22, creates extra cmd.exe process breaking signal propagation. Direct `node <entry.js>` avoids all three issues. | No |
| 9 | 2026-03-13 | arch | Process resilience strategy | 5-layer defense: spawn fix, forceKill, health monitor, tool watchdog, force-restart UI | No single layer catches all hang scenarios. Spawn fix solves the known root cause; remaining layers are safety nets for unknown failures. | Yes |
| 10 | 2026-03-13 | arch | Tool watchdog timeout | 180s client-side (above bash-safety's 120s server-side) | Client-side watchdog catches anything bash-safety misses (non-bash tools, extension load failures, etc). 60s buffer above server timeout avoids false positives. | Yes |
| 11 | 2026-03-13 | ui | Workflow state source | Parse STATE.md from disk | RPC `get_state` doesn't expose GSD workflow state. `setWidget` progress data uses factory functions which RPC mode drops. STATE.md is always up-to-date, simple to parse, and doesn't require upstream changes. | Yes |
| 12 | 2026-03-13 | ui | Thinking level selection | Dropdown picker, not cycling | Cycling through 6 levels blindly is poor UX. Dropdown shows available levels, descriptions, and active state. Calls `set_thinking_level` directly. | No |
| 13 | 2026-03-13 | ui | Model reasoning detection | Derive from AvailableModel.reasoning boolean | No new RPC needed. XHigh support checked via model ID string match (opus-4-6/opus-4.6), matching pi-ai's supportsXhigh(). | Yes |
| 14 | 2026-03-13 | ui | Context visualization | Thin progress bar + text badge | Bar provides at-a-glance pressure awareness. Text badge kept for precise numbers. Color transitions at 70% and 90% thresholds. | Yes |
| 15 | 2026-03-13 | test | Test framework | vitest + per-file jsdom | vitest is fast and ESM-native. jsdom only on files that need DOM (via pragma) keeps non-DOM tests fast. | Yes |
| 16 | 2026-03-13 | test | State-parser testability | Export parseActiveRef/parsePhase | Small pure functions were module-private. Exporting them enables direct unit testing without touching vscode imports. | No |
| 17 | 2026-03-13 | quality | ESLint no-explicit-any | Disabled project-wide | 64 hits across VS Code message-passing boundaries. Typing these adds complexity without safety — real contracts are the message protocol, not TS types on `any`. | Yes |
| 18 | 2026-03-13 | quality | ESLint config style | Flat config (eslint.config.mjs) | New ESLint standard. typescript-eslint recommended + @eslint/js recommended as base. | No |
| 19 | 2026-03-14 | arch | RPC buffer overflow strategy | Full reset (not truncation) | JSONL protocol means truncating mid-line corrupts JSON and cascades parse errors. Full reset loses in-flight data but preserves protocol integrity. | No |
| 20 | 2026-03-14 | arch | Watchdog timer leak fix | Incrementing nonce guard | Simpler than AbortController — no extra object lifecycle. setTimeout callbacks check nonce before acting; stale callbacks silently bail. | No |
| 21 | 2026-03-14 | arch | Tool grouping as render-time transform | Separate module, no data model changes | Grouping is purely a display concern — `TurnSegment[]` and `ToolCallState` stay unchanged. New `tool-grouping.ts` module owns classification and grouping logic, renderer consumes it. Keeps data flow clean for S05 decomposition. | No |
| 22 | 2026-03-14 | ui | Groupable tool classification | Read-only tools only | Only "low-stakes" read-only tools group (Read, search, fetch, browser reads, mac reads, github list/view). Mutating tools (Write, Edit, bash, click, type) always show individually so users see each action. Matches Cline's proven approach. | Yes |
