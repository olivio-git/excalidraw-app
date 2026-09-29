import {
  createShellTerminal,
  createVirtualTerminal,
  getTerminalSession,
  killTerminal,
  markTerminalExited,
  onDidCloseTerminal,
  renameTerminal,
  showTerminalPanel,
} from "@/features/terminal/terminal-service";
import type { HostConnection } from "./host-connection";

/**
 * Maps extension terminals (`window.createTerminal`) to terminal panel
 * sessions: shell terminals run in a PTY, Pseudoterminals get a virtual
 * session whose I/O goes through the host.
 */
export function registerTerminalBridge(connection: HostConnection): Array<() => void> {
  const sessions = new Map<string, string>();
  const hostIds = new Map<string, string>();
  const closingFromHost = new Set<string>();
  /** Requests that arrive while the session is still being created. */
  const pending = new Map<string, Array<(sessionId: string) => void>>();

  const withSession = (hostId: string, action: (sessionId: string) => void) => {
    const sessionId = sessions.get(hostId);
    if (sessionId) action(sessionId);
    else pending.set(hostId, [...(pending.get(hostId) ?? []), action]);
  };

  const bind = (hostId: string, sessionId: string) => {
    sessions.set(hostId, sessionId);
    hostIds.set(sessionId, hostId);
    for (const action of pending.get(hostId) ?? []) action(sessionId);
    pending.delete(hostId);
  };

  const offs = [
    connection.on("terminal.create", async (params) => {
      const { id, name, pty } = params as { id: string; name: string; pty: boolean };
      if (pty) {
        const session = createVirtualTerminal({
          name,
          show: false,
          onInput: (data) => connection.notify("terminal.input", { id, data }),
          onResize: (cols, rows) => connection.notify("terminal.resize", { id, cols, rows }),
        });
        bind(id, session.id);
        connection.notify("terminal.opened", {
          id,
          cols: session.term.cols,
          rows: session.term.rows,
        });
        return;
      }
      const { shellPath, shellArgs, cwd, env } = params as {
        shellPath?: string;
        shellArgs?: string[];
        cwd?: string;
        env?: Record<string, string>;
      };
      const session = await createShellTerminal({
        name,
        shell: shellPath,
        args: shellArgs,
        cwd,
        env,
        show: false,
      });
      bind(id, session.id);
    }),
    connection.on("terminal.write", ({ id, data }) =>
      withSession(id, (s) => getTerminalSession(s)?.write(data))
    ),
    connection.on("terminal.sendText", ({ id, text, addNewLine }) =>
      withSession(id, (s) => getTerminalSession(s)?.sendText(text, addNewLine))
    ),
    connection.on("terminal.show", ({ id }) => withSession(id, (s) => showTerminalPanel(s))),
    connection.on("terminal.setName", ({ id, name }) =>
      withSession(id, (s) => renameTerminal(s, name))
    ),
    connection.on("terminal.exit", ({ id, code }) =>
      withSession(id, (s) => markTerminalExited(s, code))
    ),
    connection.on("terminal.dispose", ({ id }) =>
      withSession(id, (s) => {
        closingFromHost.add(id);
        killTerminal(s);
      })
    ),
    onDidCloseTerminal((sessionId) => {
      const hostId = hostIds.get(sessionId);
      if (!hostId) return;
      hostIds.delete(sessionId);
      sessions.delete(hostId);
      if (!closingFromHost.has(hostId)) connection.notify("terminal.closed", { id: hostId });
      closingFromHost.delete(hostId);
    }),
  ];
  return offs;
}
