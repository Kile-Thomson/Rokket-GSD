# Knowledge

<!-- Append-only. Read this at the start of every unit. -->

| # | When | Rule/Pattern | Detail |
|---|------|-------------|--------|
| 1 | 2026-03-12 | RPC mode drops factory functions | `ctx.ui.setWidget(key, factory)` is silently ignored in RPC mode. Only `setWidget(key, stringArray)` passes through. Any feature depending on TUI widget factories must be reimplemented extension-side. |
| 2 | 2026-03-13 | Windows spawn — never use shell:true with .cmd | Parse the .cmd wrapper and invoke `node <entry.js>` directly. Shell wrappers break on paths with spaces. |
| 3 | 2026-03-13 | VS Code env vars leak to child processes | ELECTRON_RUN_AS_NODE, NODE_OPTIONS, VSCODE_* must be stripped from env before spawning GSD. Otherwise grandchild processes (e.g. Next.js workers) can crash-loop. |
| 4 | 2026-03-14 | Dropbox conflicted copies | Dropbox creates `(Kile's conflicted copy)` files. Never read or edit these — always use the canonical filename. |
| 5 | 2026-03-14 | Buffer overflow → full reset, not truncation | JSONL protocol means truncating mid-line corrupts JSON. Full buffer reset preserves protocol integrity. |
| 6 | 2026-03-14 | Auto-mode state comes from setStatus events | `extension_ui_request` with `method: "setStatus"` and `statusKey: "gsd-auto"` carries the auto-mode state. Values: `"auto"`, `"next"`, `"paused"`, or `undefined` (stopped). |
| 7 | 2026-03-17 | get_state returns current model | When dynamic model routing switches models, `get_state` RPC returns the new model. No explicit "model_changed" event — must poll and compare. |
| 8 | 2026-03-17 | STATE.md milestone registry format | Parser expects `✅` for done and `⬜` for not-done. Other emoji (🔲, 🚧) won't parse correctly. |
