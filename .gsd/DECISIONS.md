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
