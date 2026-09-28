import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakeTerminal, xtermInstances, ptyHandlers } = vi.hoisted(() => {
  const xtermInstances: InstanceType<typeof FakeTerminal>[] = [];
  const ptyHandlers: Array<{ onData: (d: string) => void; onExit: (c: number | null) => void }> =
    [];
  class FakeTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    written: string[] = [];
    dataHandler: ((data: string) => void) | null = null;
    disposed = false;
    constructor() {
      xtermInstances.push(this);
    }
    loadAddon() {}
    open() {}
    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
    }
    onResize() {}
    write(data: string) {
      this.written.push(data);
    }
    focus() {}
    dispose() {
      this.disposed = true;
    }
  }
  return { FakeTerminal, xtermInstances, ptyHandlers };
});

vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@/plugins/vscode/color-theme-service", () => ({
  getActiveThemeColors: () => ({}),
  onActiveThemeColorsChanged: () => () => undefined,
}));

vi.mock("./pty", () => ({
  isPtyAvailable: () => true,
  listShells: vi.fn(async () => [
    { name: "bash", path: "/bin/bash", args: [], isDefault: true },
    { name: "PowerShell", path: "/usr/bin/pwsh", args: [], isDefault: false },
  ]),
  spawnPty: vi.fn(async (_opts: unknown, on: (typeof ptyHandlers)[number]) => {
    ptyHandlers.push(on);
    return ptyHandlers.length;
  }),
  writePty: vi.fn(async () => undefined),
  resizePty: vi.fn(async () => undefined),
  killPty: vi.fn(async () => undefined),
}));

import * as pty from "./pty";
import { usePanelStore } from "@/core/panel/panel-store";
import {
  TERMINAL_VIEW_ID,
  __resetTerminalsForTests,
  createShellTerminal,
  createVirtualTerminal,
  getTerminalSession,
  killTerminal,
  onDidCloseTerminal,
  toggleTerminal,
  useTerminalStore,
} from "./terminal-service";

let unmountPanel: (() => void) | null = null;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  usePanelStore.setState({ open: false, activeViewId: null });
  // Stand-in for the terminal panel: attach the active session like the view does.
  const container = document.createElement("div");
  document.body.appendChild(container);
  unmountPanel = useTerminalStore.subscribe((state) => {
    if (state.activeId) getTerminalSession(state.activeId)?.attach(container);
  });
});

afterEach(() => {
  unmountPanel?.();
  __resetTerminalsForTests();
  xtermInstances.length = 0;
  ptyHandlers.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("terminal-service", () => {
  it("spawns the default shell and opens the panel on the terminal view", async () => {
    const session = await createShellTerminal();

    expect(pty.spawnPty).toHaveBeenCalledWith(
      expect.objectContaining({ shell: "/bin/bash", cols: 80, rows: 24 }),
      expect.any(Object)
    );
    expect(useTerminalStore.getState().terminals).toEqual([
      { id: session.id, title: "bash", kind: "shell", exited: false },
    ]);
    expect(useTerminalStore.getState().activeId).toBe(session.id);
    expect(usePanelStore.getState()).toMatchObject({ open: true, activeViewId: TERMINAL_VIEW_ID });
  });

  it("streams PTY output to xterm and keystrokes to the PTY", async () => {
    await createShellTerminal({ shell: "/usr/bin/pwsh", name: "PowerShell" });
    const term = xtermInstances[0];

    ptyHandlers[0].onData("PS> ");
    expect(term.written).toContain("PS> ");

    term.dataHandler?.("ls\r");
    expect(pty.writePty).toHaveBeenCalledWith(1, "ls\r");
    expect(useTerminalStore.getState().terminals[0].title).toBe("PowerShell");
  });

  it("marks the terminal as exited when the process ends", async () => {
    await createShellTerminal();
    ptyHandlers[0].onExit(0);
    expect(useTerminalStore.getState().terminals[0]).toMatchObject({ exited: true, exitCode: 0 });
  });

  it("shows spawn errors inside the terminal", async () => {
    vi.mocked(pty.spawnPty).mockRejectedValueOnce(new Error("no such shell"));
    await createShellTerminal({ shell: "/nope" });
    expect(xtermInstances[0].written.join("")).toContain("no such shell");
    expect(useTerminalStore.getState().terminals[0].exited).toBe(true);
  });

  it("kills the PTY, activates a neighbour and notifies listeners on close", async () => {
    const first = await createShellTerminal();
    const second = await createShellTerminal();
    const closed = vi.fn();
    onDidCloseTerminal(closed);

    killTerminal(second.id);

    expect(pty.killPty).toHaveBeenCalledWith(2);
    expect(useTerminalStore.getState().activeId).toBe(first.id);
    expect(getTerminalSession(second.id)).toBeUndefined();
    expect(closed).toHaveBeenCalledWith(second.id);
  });

  it("routes virtual terminal I/O through callbacks (extension pseudoterminals)", () => {
    const onInput = vi.fn();
    const onClose = vi.fn();
    const session = createVirtualTerminal({ name: "Task", onInput, onClose });

    xtermInstances[0].dataHandler?.("y");
    session.write("hello");
    session.sendText("echo", true);
    killTerminal(session.id);

    expect(onInput).toHaveBeenCalledWith("y");
    expect(onInput).toHaveBeenCalledWith("echo\r");
    expect(xtermInstances[0].written).toContain("hello");
    expect(onClose).toHaveBeenCalled();
    expect(pty.spawnPty).not.toHaveBeenCalled();
  });

  it("toggle creates a terminal the first time and hides the panel the next", async () => {
    await toggleTerminal();
    expect(useTerminalStore.getState().terminals).toHaveLength(1);
    expect(usePanelStore.getState().open).toBe(true);

    await toggleTerminal();
    expect(usePanelStore.getState().open).toBe(false);
    expect(useTerminalStore.getState().terminals).toHaveLength(1);
  });
});
