"use strict";

const { EventEmitter, Uri, TerminalExitReason } = require("./types.cjs");

/**
 * `window.createTerminal`. Shell terminals run in the app's PTY-backed
 * terminal panel; `{ pty }` terminals (Pseudoterminal) are rendered by the
 * panel while their I/O is driven from here.
 */
function createTerminals(host) {
  let nextId = 1;
  const terminals = new Map();
  const onDidOpenTerminal = new EventEmitter();
  const onDidCloseTerminal = new EventEmitter();
  const onDidChangeActiveTerminal = new EventEmitter();
  const onDidChangeTerminalState = new EventEmitter();
  let activeTerminal;

  function setActive(terminal) {
    if (activeTerminal === terminal) return;
    activeTerminal = terminal;
    onDidChangeActiveTerminal.fire(terminal);
  }

  function normalizeOptions(nameOrOptions, shellPath, shellArgs) {
    if (typeof nameOrOptions === "object" && nameOrOptions !== null) return nameOrOptions;
    return { name: nameOrOptions, shellPath, shellArgs };
  }

  function createTerminal(nameOrOptions, shellPath, shellArgs) {
    const options = normalizeOptions(nameOrOptions, shellPath, shellArgs);
    const id = `terminal-${nextId++}`;
    const pty = options.pty;
    const disposables = [];
    const terminal = {
      name: options.name || (pty ? "Extensión" : "Terminal"),
      processId: Promise.resolve(undefined),
      creationOptions: Object.freeze({ ...options }),
      exitStatus: undefined,
      state: { isInteractedWith: false, shell: undefined },
      shellIntegration: undefined,
      sendText(text, shouldExecute = true) {
        if (pty) pty.handleInput?.(shouldExecute ? `${text}\r` : text);
        else
          host.rpc.notify("terminal.sendText", {
            id,
            text: String(text),
            addNewLine: shouldExecute,
          });
      },
      show(preserveFocus) {
        setActive(terminal);
        host.rpc.notify("terminal.show", { id, preserveFocus: !!preserveFocus });
      },
      hide() {},
      dispose() {
        host.rpc.notify("terminal.dispose", { id });
        close(TerminalExitReason.Extension);
      },
    };

    const close = (reason, code) => {
      const entry = terminals.get(id);
      if (!entry) return;
      terminals.delete(id);
      terminal.exitStatus = { code, reason };
      for (const d of disposables) d.dispose();
      if (pty) {
        try {
          pty.close();
        } catch (error) {
          host.log("error", `Pseudoterminal close failed: ${error}`);
        }
      }
      if (activeTerminal === terminal) setActive(undefined);
      onDidCloseTerminal.fire(terminal);
    };

    terminals.set(id, { terminal, pty, close, opened: false });

    if (pty) {
      disposables.push(
        pty.onDidWrite((data) => host.rpc.notify("terminal.write", { id, data: String(data) }))
      );
      if (pty.onDidClose) {
        disposables.push(
          pty.onDidClose((code) => {
            host.rpc.notify("terminal.exit", {
              id,
              code: typeof code === "number" ? code : undefined,
            });
            close(TerminalExitReason.Process, typeof code === "number" ? code : undefined);
          })
        );
      }
      if (pty.onDidChangeName) {
        disposables.push(
          pty.onDidChangeName((name) => {
            terminal.name = name;
            host.rpc.notify("terminal.setName", { id, name });
          })
        );
      }
      host.rpc.notify("terminal.create", { id, name: terminal.name, pty: true });
    } else {
      const cwd = options.cwd instanceof Uri ? options.cwd.fsPath : options.cwd;
      const env = options.env
        ? Object.fromEntries(Object.entries(options.env).filter(([, v]) => typeof v === "string"))
        : undefined;
      host.rpc.notify("terminal.create", {
        id,
        name: terminal.name,
        pty: false,
        shellPath: options.shellPath,
        shellArgs: typeof options.shellArgs === "string" ? [options.shellArgs] : options.shellArgs,
        cwd,
        env,
        hideFromUser: !!options.hideFromUser,
      });
    }
    onDidOpenTerminal.fire(terminal);
    if (!options.hideFromUser) setActive(terminal);
    return terminal;
  }

  // ── Events from the app ──────────────────────────────────────────────────
  host.rpc.on("terminal.opened", ({ id, cols, rows }) => {
    const entry = terminals.get(id);
    if (!entry || entry.opened) return;
    entry.opened = true;
    if (entry.pty) entry.pty.open(cols && rows ? { columns: cols, rows } : undefined);
  });
  host.rpc.on("terminal.input", ({ id, data }) => {
    const entry = terminals.get(id);
    if (!entry) return;
    if (!entry.terminal.state.isInteractedWith) {
      entry.terminal.state = { ...entry.terminal.state, isInteractedWith: true };
      onDidChangeTerminalState.fire(entry.terminal);
    }
    entry.pty?.handleInput?.(data);
  });
  host.rpc.on("terminal.resize", ({ id, cols, rows }) => {
    terminals.get(id)?.pty?.setDimensions?.({ columns: cols, rows });
  });
  host.rpc.on("terminal.closed", ({ id, code }) => {
    terminals.get(id)?.close(TerminalExitReason.User, code);
  });
  host.rpc.on("terminal.focused", ({ id }) => {
    const entry = terminals.get(id);
    if (entry) setActive(entry.terminal);
  });

  return {
    createTerminal,
    get terminals() {
      return [...terminals.values()].map((entry) => entry.terminal);
    },
    get activeTerminal() {
      return activeTerminal;
    },
    onDidOpenTerminal: onDidOpenTerminal.event,
    onDidCloseTerminal: onDidCloseTerminal.event,
    onDidChangeActiveTerminal: onDidChangeActiveTerminal.event,
    onDidChangeTerminalState: onDidChangeTerminalState.event,
  };
}

module.exports = { createTerminals };
