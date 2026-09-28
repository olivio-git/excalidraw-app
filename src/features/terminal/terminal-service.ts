import { create } from "zustand";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { usePanelStore } from "@/core/panel/panel-store";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useThemeStore } from "@/stores/themeStore";
import {
  getActiveThemeColors,
  onActiveThemeColorsChanged,
} from "@/plugins/vscode/color-theme-service";
import { killPty, listShells, resizePty, spawnPty, writePty, type ShellInfo } from "./pty";
import { currentMonoFont, currentXtermTheme } from "./xterm-theme";

/**
 * Terminal sessions live outside React: each owns an xterm.js instance that
 * is re-parented into the panel when shown, so switching views or terminals
 * never loses scrollback. A session is backed either by a PTY (a real shell)
 * or by a "virtual" backend (an extension's Pseudoterminal).
 */

export const TERMINAL_VIEW_ID = "terminal";

export interface TerminalBackend {
  /** User input (keystrokes, paste). */
  input(data: string): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
}

export interface TerminalInfo {
  id: string;
  title: string;
  kind: "shell" | "extension";
  exited: boolean;
  exitCode?: number | null;
}

export interface CreateShellTerminalOptions {
  name?: string;
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Show the panel and focus the terminal (default true). */
  show?: boolean;
}

export interface CreateVirtualTerminalOptions {
  name: string;
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onClose?: () => void;
  show?: boolean;
}

interface TerminalStoreState {
  terminals: TerminalInfo[];
  activeId: string | null;
}

export const useTerminalStore = create<TerminalStoreState>()(() => ({
  terminals: [],
  activeId: null,
}));

function updateInfo(id: string, patch: Partial<TerminalInfo>): void {
  useTerminalStore.setState((state) => ({
    terminals: state.terminals.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}

export class TerminalSession {
  readonly term: Terminal;
  readonly host: HTMLDivElement;
  private readonly fitAddon = new FitAddon();
  private backend: TerminalBackend | null = null;
  private pendingInput: string[] = [];
  private disposed = false;
  /** xterm is opened on first attach: it measures glyphs, which needs a laid-out element. */
  private opened = false;
  readonly id: string;
  readonly kind: TerminalInfo["kind"];

  constructor(id: string, kind: TerminalInfo["kind"]) {
    this.id = id;
    this.kind = kind;
    this.host = document.createElement("div");
    this.host.className = "qori-terminal-host h-full w-full";
    this.host.style.setProperty("--qori-terminal-font", currentMonoFont());
    this.term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: currentMonoFont(),
      fontSize: 13,
      scrollback: 5000,
      theme: currentXtermTheme(getActiveThemeColors()),
    });
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());
    this.term.onData((data) => {
      if (this.backend) this.backend.input(data);
      else this.pendingInput.push(data);
    });
    this.term.onResize(({ cols, rows }) => this.backend?.resize(cols, rows));
  }

  setBackend(backend: TerminalBackend): void {
    this.backend = backend;
    for (const data of this.pendingInput) backend.input(data);
    this.pendingInput = [];
    backend.resize(this.term.cols, this.term.rows);
  }

  write(data: string): void {
    if (!this.disposed) this.term.write(data);
  }

  /** Programmatic input, as if typed (VS Code's `Terminal.sendText`). */
  sendText(text: string, addNewLine = true): void {
    const data = addNewLine ? `${text}\r` : text;
    if (this.backend) this.backend.input(data);
    else this.pendingInput.push(data);
  }

  /** Show this terminal in `container`, replacing whichever terminal was there. */
  attach(container: HTMLElement): void {
    if (this.host.parentElement !== container) container.replaceChildren(this.host);
    if (!this.opened && this.host.isConnected) {
      this.opened = true;
      this.term.open(this.host);
    }
    this.fit();
  }

  fit(): void {
    if (this.disposed || !this.opened || !this.host.isConnected) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    try {
      this.fitAddon.fit();
    } catch {
      // The renderer is not ready yet; the next resize will fit.
    }
  }

  focus(): void {
    this.term.focus();
  }

  refreshTheme(): void {
    this.term.options.theme = currentXtermTheme(getActiveThemeColors());
    this.term.options.fontFamily = currentMonoFont();
    this.host.style.setProperty("--qori-terminal-font", currentMonoFont());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.backend?.dispose();
    this.term.dispose();
    this.host.remove();
  }
}

const sessions = new Map<string, TerminalSession>();
const closeListeners = new Set<(id: string) => void>();
let counter = 0;
let shellsPromise: Promise<ShellInfo[]> | null = null;
let themeWatchInstalled = false;

function nextId(): string {
  counter += 1;
  return `term-${counter}`;
}

function watchTheme(): void {
  if (themeWatchInstalled) return;
  themeWatchInstalled = true;
  const refresh = () => {
    // Wait for the CSS variables of the new theme to be applied.
    requestAnimationFrame(() => sessions.forEach((session) => session.refreshTheme()));
  };
  onActiveThemeColorsChanged(refresh);
  useThemeStore.subscribe((state, prev) => {
    if (state.resolvedTheme !== prev.resolvedTheme) refresh();
  });
}

function addSession(session: TerminalSession, title: string, show: boolean): void {
  watchTheme();
  sessions.set(session.id, session);
  useTerminalStore.setState((state) => ({
    terminals: [...state.terminals, { id: session.id, title, kind: session.kind, exited: false }],
    activeId: show || !state.activeId ? session.id : state.activeId,
  }));
  if (show) showTerminalPanel(session.id);
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export function getAvailableShells(): Promise<ShellInfo[]> {
  shellsPromise ??= listShells().catch(() => []);
  return shellsPromise;
}

export function showTerminalPanel(id?: string): void {
  if (id) useTerminalStore.setState({ activeId: id });
  usePanelStore.getState().showView(TERMINAL_VIEW_ID);
  const target = id ?? useTerminalStore.getState().activeId;
  if (target) requestAnimationFrame(() => sessions.get(target)?.focus());
}

export function setActiveTerminal(id: string): void {
  if (!sessions.has(id)) return;
  useTerminalStore.setState({ activeId: id });
  requestAnimationFrame(() => sessions.get(id)?.focus());
}

function shellTitle(shell: string | undefined): string {
  if (!shell) return "terminal";
  const base = shell.split(/[\\/]/).pop() ?? shell;
  return base.replace(/\.exe$/i, "");
}

/** Open a new terminal running a shell in a PTY. */
export async function createShellTerminal(
  options: CreateShellTerminalOptions = {}
): Promise<TerminalSession> {
  const show = options.show ?? true;
  let shell = options.shell;
  let args = options.args;
  if (!shell) {
    const shells = await getAvailableShells();
    const preferred = shells.find((s) => s.isDefault) ?? shells[0];
    shell = preferred?.path;
    args ??= preferred?.args;
  }

  const session = new TerminalSession(nextId(), "shell");
  addSession(session, options.name ?? shellTitle(shell), show);
  // Let the panel mount and lay out the terminal so the PTY starts with its real size.
  // The panel view is lazy-loaded, so the first terminal can take a moment.
  const deadline = Date.now() + 1500;
  while (show && !session.host.isConnected && Date.now() < deadline) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  session.fit();

  try {
    const ptyId = await spawnPty(
      {
        shell,
        args,
        cwd: options.cwd ?? useWorkspaceStore.getState().workspaceDir ?? undefined,
        env: options.env,
        cols: session.term.cols,
        rows: session.term.rows,
      },
      {
        onData: (data) => session.write(data),
        onExit: (code) => {
          updateInfo(session.id, { exited: true, exitCode: code });
          session.write(
            `\r\n\x1b[90m[Proceso terminado${code != null ? ` con código ${code}` : ""}]\x1b[0m\r\n`
          );
        },
      }
    );
    session.setBackend({
      input: (data) => void writePty(ptyId, data).catch(() => undefined),
      resize: (cols, rows) => void resizePty(ptyId, cols, rows).catch(() => undefined),
      dispose: () => void killPty(ptyId).catch(() => undefined),
    });
  } catch (error) {
    updateInfo(session.id, { exited: true, exitCode: null });
    session.write(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`);
  }
  return session;
}

/**
 * Open a terminal whose I/O is handled in JavaScript instead of a process
 * (used for extension Pseudoterminals).
 */
export function createVirtualTerminal(options: CreateVirtualTerminalOptions): TerminalSession {
  const session = new TerminalSession(nextId(), "extension");
  session.setBackend({
    input: options.onInput,
    resize: (cols, rows) => options.onResize?.(cols, rows),
    dispose: () => options.onClose?.(),
  });
  addSession(session, options.name, options.show ?? true);
  return session;
}

export function markTerminalExited(id: string, code?: number | null): void {
  updateInfo(id, { exited: true, exitCode: code });
}

export function renameTerminal(id: string, title: string): void {
  updateInfo(id, { title });
}

export function killTerminal(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.dispose();
  useTerminalStore.setState((state) => {
    const index = state.terminals.findIndex((t) => t.id === id);
    const terminals = state.terminals.filter((t) => t.id !== id);
    const activeId =
      state.activeId === id
        ? (terminals[Math.min(index, terminals.length - 1)]?.id ?? null)
        : state.activeId;
    return { terminals, activeId };
  });
  closeListeners.forEach((listener) => listener(id));
}

export function killActiveTerminal(): void {
  const { activeId } = useTerminalStore.getState();
  if (activeId) killTerminal(activeId);
}

/** Notified after a terminal is closed (by the user or programmatically). */
export function onDidCloseTerminal(listener: (id: string) => void): () => void {
  closeListeners.add(listener);
  return () => closeListeners.delete(listener);
}

/** Toggle the panel on the terminal view, creating a terminal if there is none. */
export async function toggleTerminal(): Promise<void> {
  const panel = usePanelStore.getState();
  if (panel.open && panel.activeViewId === TERMINAL_VIEW_ID) {
    panel.setOpen(false);
    return;
  }
  if (useTerminalStore.getState().terminals.length === 0) {
    await createShellTerminal();
  } else {
    showTerminalPanel();
  }
}

/** Test helper: drop every session without touching the backends. */
export function __resetTerminalsForTests(): void {
  sessions.forEach((session) => session.dispose());
  sessions.clear();
  closeListeners.clear();
  counter = 0;
  shellsPromise = null;
  useTerminalStore.setState({ terminals: [], activeId: null });
}
