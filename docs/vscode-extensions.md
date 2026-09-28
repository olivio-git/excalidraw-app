# VS Code extensions, terminal and code editor

The app installs `.vsix` extensions from Open VSX (or a local file) and runs them much like VS Code does: declarative contributions are applied by the workbench, and extension code runs in a separate **extension host** process with its own implementation of the `vscode` API.

```
┌──────────── Webview (React) ─────────────┐        ┌──── extension-host/ (Node) ────┐
│ Command palette, keybindings, sidebar    │  JSON  │ require("vscode") → API shim    │
│ views, webview tabs, Output, status bar, │◄──────►│ activation events, commands,    │
│ terminal panel, code editor (CodeMirror) │ lines  │ providers, trees, webviews, ... │
└──────────────────▲───────────────────────┘        └───────────────▲────────────────┘
                   │ events / commands                               │ stdin/stdout
             ┌─────┴─────────────── src-tauri (Rust) ────────────────┴─────┐
             │ exthost.rs: spawns the host, relays lines                   │
             │ pty.rs: pseudo-terminals for shells (portable-pty)          │
             └─────────────────────────────────────────────────────────────┘
```

## What works

| Area              | Supported                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Themes            | `themes` (workbench colors + `tokenColors` for the editor), `iconThemes`                                                                                                                                                                                                                                                                                                                                 |
| Languages         | `languages`, TextMate `grammars` (vscode-textmate + Oniguruma), `snippets`, `language-configuration.json` comments/brackets                                                                                                                                                                                                                                                                              |
| Workbench         | `commands` in the palette, `keybindings` (never overriding app shortcuts), `configuration` defaults + `settings.json`, `viewsContainers`/`views`, `menus` for `view/title` and `view/item/context`                                                                                                                                                                                                       |
| Extension code    | `commands`, messages/quick pick/input box, output channels (incl. `LogOutputChannel`), status bar, terminals + `Pseudoterminal`, tree views, webview panels and views (`acquireVsCodeApi`, `asWebviewUri`, `--vscode-*` theme variables), `workspace` (folders, configuration, fs, `findFiles`, watchers, documents, `applyEdit`), `env`, `extensions`, `l10n`, `globalState`/`workspaceState`/`secrets` |
| Language features | Document sync, completion (+ resolve, snippets), hover, go to definition (F12 / Ctrl+click), signature help, formatting (Shift+Alt+F), diagnostics. Works with `vscode-languageclient` (LSP) extensions.                                                                                                                                                                                                 |
| Terminal          | Integrated terminal (Ctrl+\`), shell picker (bash, zsh, PowerShell, cmd, ...), extension terminals                                                                                                                                                                                                                                                                                                       |

APIs the app does not implement (debug, tasks, SCM, testing, notebooks, ...) are **stubbed**: registrations return a `Disposable`, events never fire, and each missing member is logged once to _Output → Extension Host_. An extension that depends on them activates but that part does nothing.

## Requirements and limits

- Extension code needs a JavaScript runtime: `node` on `PATH` (recommended), `QORI_NODE_PATH`, or — as a fallback — the bundled gateway binary acting as a Bun runtime (`BUN_BE_BUN=1`).
- Web-only extensions (`browser` entry, no `main`) are not supported.
- Extensions run with full Node permissions, as in VS Code. Only install extensions you trust.
- `secrets` is stored in a user-only (0600) file in the extension's global storage, not in the OS keychain.
- Extensions that ship their own runtime (e.g. PowerShell needs `pwsh`, Python needs `python`) still need that runtime installed.

## Where things live

| Path                                | Content                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `$APPDATA/extensions/`              | Unpacked extensions and `extensions.json` (index)                  |
| `$APPDATA/extensions/settings.json` | Extension settings (_Preferences: Open Extension Settings (JSON)_) |
| `$APPDATA/extension-data/`          | `globalStorage`, `workspaceStorage`, `logs` per extension          |

## Code map

| Code                                         | Role                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/pty.rs`                       | PTY sessions (`pty_spawn/write/resize/kill`, shell detection)                                              |
| `src-tauri/src/exthost.rs`                   | Host process (`exthost_start/send/stop`)                                                                   |
| `extension-host/src/`                        | The host: `host.cjs` (activation, `require("vscode")`), `api/*.cjs` (API namespaces), `rpc.cjs` (protocol) |
| `src/plugins/vscode/contributions.ts`        | Parses `contributes`                                                                                       |
| `src/plugins/vscode/contribution-service.ts` | Commands/keybindings/configuration into the workbench                                                      |
| `src/plugins/vscode/host/`                   | Host lifecycle, protocol handlers, views, webviews, Output, status bar, language bridge                    |
| `src/features/code-editor/`                  | Code editor, language registry, TextMate highlighting, snippets                                            |
| `src/features/terminal/`                     | Terminal panel (xterm.js)                                                                                  |
| `src/core/panel/`                            | Bottom panel (Terminal, Output, extension panel views)                                                     |

## Protocol

Newline-delimited JSON over the host's stdin/stdout, requests in both directions:

```json
{"type":"req","id":1,"method":"executeCommand","params":{"id":"myExt.run","args":[]}}
{"type":"res","id":1,"result":"done"}
{"type":"ntf","method":"output.append","params":{"id":"output-1","text":"hello\n"}}
```

App → host: `initialize`, `activateByEvent`, `executeCommand`, `tree.getChildren`, `webviewView.resolve`, `document.opened/changed/saved/closed`, `editor.active/selection`, `languages.completion/hover/definition/signatureHelp/format/capabilities`, ...
Host → app: `commands.registered`, `window.showMessage/showQuickPick/showInputBox`, `output.*`, `statusBar.*`, `terminal.*`, `tree.*`, `webview.*`, `diagnostics.set`, `document.applyEdits`, `log`, ...

## Tests

```sh
pnpm vitest run extension-host   # real host process: API, activation, views, LSP (vscode-languageclient)
pnpm vitest run src/plugins/vscode src/features/code-editor src/features/terminal
(cd src-tauri && cargo test)     # PTY and host process spawning
```
