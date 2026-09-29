import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(here, "../src/main.cjs");

type Message = {
  type: string;
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
};

/** Minimal app side of the host protocol, over a real host process. */
export class HostClient {
  child: ChildProcessWithoutNullStreams;
  notifications: Message[] = [];
  requests: Message[] = [];
  stderr = "";
  private nextId = 1;
  private pending = new Map<number, (m: Message) => void>();
  private waiters: Array<{ match: (m: Message) => boolean; resolve: (m: Message) => void }> = [];
  handlers: Record<string, (params: any) => unknown> = {};

  constructor() {
    this.child = spawn(process.execPath, [MAIN], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.on("data", (d) => (this.stderr += d));
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => this.onLine(line));
  }

  private onLine(line: string) {
    const message = JSON.parse(line) as Message;
    if (message.type === "res") {
      this.pending.get(message.id!)?.(message);
      this.pending.delete(message.id!);
      return;
    }
    if (message.type === "req") {
      this.requests.push(message);
      const handler = this.handlers[message.method!];
      Promise.resolve(handler ? handler(message.params) : null).then((result) =>
        this.send({ type: "res", id: message.id, result: result ?? null })
      );
    } else {
      this.notifications.push(message);
    }
    for (const waiter of [...this.waiters]) {
      if (waiter.match(message)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  }

  send(message: Message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: unknown = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) =>
        m.error ? reject(new Error(m.error.message)) : resolve(m.result)
      );
      this.send({ type: "req", id, method, params });
    });
  }

  notify(method: string, params: unknown = {}) {
    this.send({ type: "ntf", method, params });
  }

  waitFor(method: string, predicate: (params: any) => boolean = () => true, timeout = 5000) {
    const match = (m: Message) => m.method === method && predicate(m.params);
    const existing = [...this.notifications, ...this.requests].find(match);
    if (existing) return Promise.resolve(existing.params);
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${method}\n${this.stderr}`)),
        timeout
      );
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m.params);
        },
      });
    });
  }
}
