# GSD — Get Stuff Done (VS Code Extension)

GSD V2 integrated into VS Code as a native chat panel, with full feature parity with the Claude Code extension experience.

## Features

- **Full Chat UI** — Streaming markdown responses, code blocks with copy buttons, tool execution visibility
- **Image Paste/Drop** — Paste images from clipboard or drag & drop into the input area (sent as base64 to the agent)
- **Copy/Paste** — Native clipboard integration via VS Code API. Select text to copy, click code block copy buttons
- **Native Dialogs** — GSD's `ask_user_questions`, bash safety prompts, and permission requests surface as VS Code QuickPick, InputBox, and modal dialogs
- **Sidebar & Tab** — Open GSD in the sidebar or as a full editor tab
- **Session Management** — New conversation, session persistence, auto-compaction
- **Theme Integration** — Inherits VS Code's active theme via CSS variables

## Architecture

```
┌────────────────────┐     postMessage      ┌────────────────────┐
│   Webview (Chat)   │ ◄──────────────────► │  Extension Host    │
│   - Input + paste  │                      │  - Dialog mapping  │
│   - Image drop     │                      │  - File operations │
│   - Markdown render│                      │  - Clipboard API   │
│   - Inline dialogs │                      │                    │
└────────────────────┘                      └────────┬───────────┘
                                                     │ stdin/stdout
                                                     │ JSON-RPC
                                            ┌────────▼───────────┐
                                            │  gsd --mode rpc    │
                                            │  (Child Process)   │
                                            └────────────────────┘
```

## How It Works

1. **Extension Host** spawns `gsd --mode rpc` as a child process
2. Communication happens via JSON lines over stdin/stdout (the pi RPC protocol)
3. The **Webview** renders the chat UI and handles user input
4. Messages flow: Webview → Extension Host → GSD RPC → Extension Host → Webview
5. **Extension UI Requests** (questions, confirmations) from GSD are intercepted and shown as:
   - `select` → VS Code QuickPick
   - `confirm` → VS Code modal InformationMessage
   - `input` → VS Code InputBox
   - `editor` → Opens a temp document for multi-line editing
   - `notify` → VS Code notification (info/warning/error)

## Installation

### From VSIX (local)

```bash
code --install-extension gsd-vscode-0.1.0.vsix
```

### Development

```bash
cd gsd-vscode
npm install
npm run watch    # Watch mode (extension + webview)
# Press F5 in VS Code to launch Extension Development Host
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gsd.processWrapper` | `""` | Custom executable path for the GSD process |
| `gsd.environmentVariables` | `[]` | Env vars to set when launching GSD |
| `gsd.useCtrlEnterToSend` | `false` | Use Ctrl+Enter to send (Enter for newlines) |
| `gsd.preferredLocation` | `"panel"` | Default open location: `"sidebar"` or `"panel"` |

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| GSD: Open | | Opens in preferred location |
| GSD: Open in New Tab | | Opens as editor tab |
| GSD: Open in Side Bar | | Opens in sidebar |
| GSD: New Conversation | `Ctrl+Shift+N` | Starts fresh session |
| GSD: Focus Input | `Ctrl+Shift+G` | Focuses the input field |

## Requirements

- VS Code 1.94+
- `gsd` CLI installed and in PATH (`npm install -g gsd-pi`)
- Valid API key configured in GSD

## RPC Protocol

The extension communicates with GSD using the [pi RPC protocol](https://github.com/badlogic/pi-mono). Key message types:

**Outbound (to GSD):** `prompt`, `steer`, `follow_up`, `abort`, `get_state`, `set_model`, `set_thinking_level`, `new_session`, `compact`, `extension_ui_response`

**Inbound (from GSD):** `agent_start/end`, `message_update`, `tool_execution_start/update/end`, `extension_ui_request`, `auto_compaction_start/end`, `auto_retry_start/end`
