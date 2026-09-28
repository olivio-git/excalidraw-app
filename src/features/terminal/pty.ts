/**
 * Thin client over the Rust PTY commands (`src-tauri/src/pty.rs`).
 * Output and exit events arrive on two global Tauri events and are routed to
 * the session that owns the id.
 */

export interface ShellInfo {
  name: string;
  path: string;
  args: string[];
  isDefault: boolean;
}

export interface PtySpawnOptions {
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

interface PtyHandlers {
  onData: (data: string) => void;
  onExit: (code: number | null) => void;
}

const handlers = new Map<number, PtyHandlers>();
/** Output that arrived before the session registered its handlers. */
const early = new Map<number, string[]>();
let listening: Promise<void> | null = null;

export function isPtyAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function ensureListening(): Promise<void> {
  listening ??= (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ id: number; data: string }>("pty:data", ({ payload }) => {
      const handler = handlers.get(payload.id);
      if (handler) handler.onData(payload.data);
      else early.set(payload.id, [...(early.get(payload.id) ?? []), payload.data]);
    });
    await listen<{ id: number; code: number | null }>("pty:exit", ({ payload }) => {
      handlers.get(payload.id)?.onExit(payload.code);
      handlers.delete(payload.id);
      early.delete(payload.id);
    });
  })();
  return listening;
}

export async function listShells(): Promise<ShellInfo[]> {
  if (!isPtyAvailable()) return [];
  return invoke<ShellInfo[]>("pty_list_shells");
}

/** Start a process in a new pseudo-terminal and stream its output. */
export async function spawnPty(options: PtySpawnOptions, on: PtyHandlers): Promise<number> {
  if (!isPtyAvailable()) {
    throw new Error("La terminal integrada solo está disponible en la app de escritorio.");
  }
  await ensureListening();
  const id = await invoke<number>("pty_spawn", { options });
  handlers.set(id, on);
  for (const chunk of early.get(id) ?? []) on.onData(chunk);
  early.delete(id);
  return id;
}

export function writePty(id: number, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

export function resizePty(id: number, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export function killPty(id: number): Promise<void> {
  handlers.delete(id);
  return invoke("pty_kill", { id });
}
