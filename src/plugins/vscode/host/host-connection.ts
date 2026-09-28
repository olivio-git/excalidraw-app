/**
 * App side of the extension host protocol (mirror of extension-host/src/rpc.cjs):
 * newline-delimited JSON requests, responses and notifications in both
 * directions, carried by a transport (Tauri events + commands in the app,
 * an in-memory fake in tests).
 */

export interface HostTransport {
  start(): Promise<{ pid: number; runtime: string; alreadyRunning?: boolean }>;
  send(line: string): Promise<void>;
  stop(): Promise<void>;
  onMessage(listener: (line: string) => void): () => void;
  onLog(listener: (line: string) => void): () => void;
  onExit(listener: (code: number | null) => void): () => void;
}

type Handler = (params: any) => unknown;

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  method: string;
}

export class HostConnection {
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Handler>();
  private nextId = 1;
  private readonly unsubscribe: () => void;
  private readonly transport: HostTransport;

  constructor(transport: HostTransport) {
    this.transport = transport;
    this.unsubscribe = transport.onMessage((line) => this.receive(line));
  }

  request<T = any>(method: string, params: unknown = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.send({ type: "req", id, method, params }).catch((error) => {
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method: string, params: unknown = {}): void {
    void this.send({ type: "ntf", method, params }).catch(() => undefined);
  }

  on(method: string, handler: Handler): () => void {
    this.handlers.set(method, handler);
    return () => {
      if (this.handlers.get(method) === handler) this.handlers.delete(method);
    };
  }

  /** Fail every pending request (the host exited). */
  dispose(reason = "Extension host stopped"): void {
    this.unsubscribe();
    for (const entry of this.pending.values()) entry.reject(new Error(reason));
    this.pending.clear();
  }

  private send(message: unknown): Promise<void> {
    return this.transport.send(JSON.stringify(message));
  }

  private receive(line: string): void {
    let message: {
      type: string;
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message: string };
    };
    try {
      message = JSON.parse(line);
    } catch {
      console.warn("[exthost] invalid message", line.slice(0, 200));
      return;
    }
    if (message.type === "res" && message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result === null ? undefined : message.result);
      return;
    }
    const handler = message.method ? this.handlers.get(message.method) : undefined;
    if (message.type === "req" && message.id !== undefined) {
      const id = message.id;
      if (!handler) {
        void this.send({
          type: "res",
          id,
          error: { message: `Unknown method: ${message.method}` },
        });
        return;
      }
      Promise.resolve()
        .then(() => handler(message.params ?? {}))
        .then(
          (result) => this.send({ type: "res", id, result: result === undefined ? null : result }),
          (error) =>
            this.send({
              type: "res",
              id,
              error: { message: error instanceof Error ? error.message : String(error) },
            })
        )
        .catch(() => undefined);
      return;
    }
    if (message.type === "ntf" && handler) {
      Promise.resolve()
        .then(() => handler(message.params ?? {}))
        .catch((error) => console.error(`[exthost] ${message.method} failed`, error));
    }
  }
}

/** Transport over the Rust commands in src-tauri/src/exthost.rs. */
export function createTauriTransport(): HostTransport {
  const invoke = async <T>(command: string, args?: Record<string, unknown>) =>
    (await import("@tauri-apps/api/core")).invoke<T>(command, args);

  const messageListeners = new Set<(line: string) => void>();
  const logListeners = new Set<(line: string) => void>();
  const exitListeners = new Set<(code: number | null) => void>();
  let listening: Promise<void> | null = null;

  // Listen before the process starts so its first lines are not lost.
  const ensureListening = () =>
    (listening ??= (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      await Promise.all([
        listen<string>("exthost:message", ({ payload }) =>
          messageListeners.forEach((listener) => listener(payload))
        ),
        listen<string>("exthost:log", ({ payload }) => logListeners.forEach((l) => l(payload))),
        listen<{ code: number | null }>("exthost:exit", ({ payload }) =>
          exitListeners.forEach((listener) => listener(payload.code))
        ),
      ]);
    })());

  const add = <T>(set: Set<T>, listener: T) => {
    set.add(listener);
    return () => void set.delete(listener);
  };

  return {
    start: async () => {
      await ensureListening();
      return invoke("exthost_start");
    },
    send: (line) => invoke("exthost_send", { message: line }),
    stop: () => invoke("exthost_stop"),
    onMessage: (listener) => add(messageListeners, listener),
    onLog: (listener) => add(logListeners, listener),
    onExit: (listener) => add(exitListeners, listener),
  };
}
