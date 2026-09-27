import { invoke } from "@tauri-apps/api/core";

export interface GatewayInfo {
  port: number;
  token: string;
}

export interface GatewayResponse<T = unknown> {
  type: "response";
  requestId: string;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
}

export type GatewayEvent =
  | GatewayResponse
  | { type: "auth.event"; requestId: string; event: unknown }
  | { type: "auth.prompt"; requestId: string; prompt: unknown }
  | { type: "stream.event"; requestId: string; event: unknown }
  | { type: "stream.done"; requestId: string; message: unknown }
  | { type: "stream.error"; requestId: string; error: { code: string; message: string } };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type Listener = (event: GatewayEvent) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<Listener>();

  onEvent(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      const info = await invoke<GatewayInfo>("get_gateway_info");
      const ws = new WebSocket(
        `ws://127.0.0.1:${info.port}?token=${encodeURIComponent(info.token)}`
      );
      this.ws = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("Could not connect to LLM gateway"));
      });

      ws.onmessage = (message) => this.handleMessage(message.data);
      ws.onclose = () => {
        this.ws = null;
        for (const pending of this.pending.values()) {
          pending.reject(new Error("LLM gateway disconnected"));
        }
        this.pending.clear();
      };
    })().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  async request<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    await this.connect();
    const requestId =
      typeof payload.requestId === "string" ? payload.requestId : crypto.randomUUID();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("LLM gateway is not connected");

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });

    ws.send(JSON.stringify({ ...payload, type, requestId }));
    return promise;
  }

  async send(type: string, payload: Record<string, unknown> = {}) {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("LLM gateway is not connected");
    ws.send(JSON.stringify({ ...payload, type }));
  }

  private handleMessage(raw: unknown) {
    let event: GatewayEvent;
    try {
      event = JSON.parse(String(raw)) as GatewayEvent;
    } catch {
      return;
    }

    if (event.type === "response") {
      const pending = this.pending.get(event.requestId);
      if (pending) {
        this.pending.delete(event.requestId);
        if (event.ok) pending.resolve(event.result);
        else pending.reject(new Error(event.error?.message ?? "Gateway request failed"));
      }
    }

    for (const listener of this.listeners) listener(event);
  }
}

export const gatewayClient = new GatewayClient();
