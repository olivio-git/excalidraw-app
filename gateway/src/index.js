import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import { createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

try {
  const { registerBunOAuthFlows } = await import("@earendil-works/pi-ai/bun-oauth");
  registerBunOAuthFlows();
} catch {
  // Node package usage can lazy-load OAuth modules from node_modules.
  // Bun standalone binaries need the registration above.
}

const PROVIDER_ID = "openai-codex";
const DEFAULT_MODEL_ID = "gpt-5.6-luna";

function parseArgs(argv) {
  const out = { port: 0, token: "", dataDir: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--port") {
      out.port = Number(next);
      i++;
    } else if (arg === "--token") {
      out.token = String(next ?? "");
      i++;
    } else if (arg === "--data-dir") {
      out.dataDir = String(next ?? "");
      i++;
    }
  }
  if (!Number.isFinite(out.port) || out.port < 0) throw new Error("Invalid --port");
  if (!out.token) throw new Error("Missing --token");
  if (!out.dataDir) out.dataDir = join(process.cwd(), ".qori-gateway");
  return out;
}

class FileCredentialStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.chains = new Map();
  }

  async readAll() {
    if (!existsSync(this.filePath)) return {};
    const text = await readFile(this.filePath, "utf8");
    if (!text.trim()) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }

  async writeAll(data) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmp, this.filePath);
  }

  enqueue(providerId, task) {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.chains.set(providerId, next.catch(() => undefined));
    return next;
  }

  async read(providerId) {
    const data = await this.readAll();
    return data[providerId];
  }

  async list() {
    const data = await this.readAll();
    return Object.entries(data).map(([providerId, credential]) => ({
      providerId,
      type: credential?.type ?? "api_key",
    }));
  }

  async modify(providerId, fn) {
    return this.enqueue(providerId, async () => {
      const data = await this.readAll();
      const next = await fn(data[providerId]);
      if (next !== undefined) {
        data[providerId] = next;
        await this.writeAll(data);
      }
      return data[providerId];
    });
  }

  async delete(providerId) {
    await this.enqueue(providerId, async () => {
      const data = await this.readAll();
      delete data[providerId];
      await this.writeAll(data);
    });
  }
}

const args = parseArgs(process.argv.slice(2));
await mkdir(args.dataDir, { recursive: true });
const credentials = new FileCredentialStore(join(args.dataDir, "auth.json"));
const models = createModels({ credentials });
models.setProvider(openaiCodexProvider());

const streams = new Map();
const pendingManualAuthPrompts = new Map();

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  let code = "error";
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("oauth")) {
    code = "auth_required";
  } else if (lower.includes("429") || lower.includes("quota") || lower.includes("rate")) {
    code = "quota_exhausted";
  } else if (lower.includes("network") || lower.includes("fetch")) {
    code = "network";
  }
  return { code, message };
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function respond(ws, requestId, result) {
  send(ws, { type: "response", requestId, ok: true, result });
}

function reject(ws, requestId, error) {
  send(ws, { type: "response", requestId, ok: false, error: safeError(error) });
}

async function authStatus() {
  const credential = await credentials.read(PROVIDER_ID);
  let check;
  try {
    check = await models.checkAuth(PROVIDER_ID);
  } catch {
    check = undefined;
  }
  return {
    provider: PROVIDER_ID,
    loggedIn: Boolean(check || credential?.type === "oauth"),
    account: credential?.accountId ? { id: credential.accountId } : undefined,
    source: check?.source,
  };
}

async function handleLogin(ws, requestId, payload) {
  const method = payload.method === "device" ? "device_code" : "browser";
  const controller = new AbortController();
  const credential = await models.login(PROVIDER_ID, "oauth", {
    signal: controller.signal,
    async prompt(prompt) {
      if (prompt.type === "select") return method;
      if (prompt.type === "manual_code") {
        send(ws, { type: "auth.prompt", requestId, prompt });
        return new Promise((resolve, rejectPrompt) => {
          const cleanup = () => pendingManualAuthPrompts.delete(requestId);
          const onAbort = () => {
            cleanup();
            rejectPrompt(new Error("Login cancelled"));
          };
          pendingManualAuthPrompts.set(requestId, {
            resolve: (value) => {
              cleanup();
              resolve(value);
            },
            reject: (error) => {
              cleanup();
              rejectPrompt(error);
            },
          });
          prompt.signal?.addEventListener("abort", onAbort, { once: true });
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
      send(ws, { type: "auth.prompt", requestId, prompt });
      throw new Error(`Unsupported login prompt type: ${prompt.type}`);
    },
    notify(event) {
      send(ws, { type: "auth.event", requestId, event });
    },
  });
  return {
    provider: PROVIDER_ID,
    loggedIn: true,
    account: credential.accountId ? { id: credential.accountId } : undefined,
  };
}

async function handleModelsList() {
  let available = [];
  try {
    available = await models.getAvailable(PROVIDER_ID);
  } catch {
    available = [];
  }
  const all = models.getModels(PROVIDER_ID);
  const ids = new Set(available.map((m) => m.id));
  return {
    provider: PROVIDER_ID,
    loggedIn: available.length > 0,
    models: all.map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      api: model.api,
      reasoning: model.reasoning,
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      available: ids.has(model.id),
    })),
  };
}

async function handleStreamStart(ws, payload) {
  const requestId = payload.requestId;
  if (!requestId) throw new Error("stream.start requires requestId");
  const modelId = payload.modelId || DEFAULT_MODEL_ID;
  const model = models.getModel(PROVIDER_ID, modelId);
  if (!model) throw new Error(`Unknown ${PROVIDER_ID} model: ${modelId}`);

  const controller = new AbortController();
  streams.set(requestId, controller);
  const options = {
    ...(payload.options && typeof payload.options === "object" ? payload.options : {}),
    signal: controller.signal,
    sessionId: payload.sessionId || requestId,
  };
  const context = payload.context;
  if (!context || !Array.isArray(context.messages)) throw new Error("stream.start requires context.messages");

  queueMicrotask(async () => {
    try {
      const stream = models.streamSimple(model, context, options);
      for await (const event of stream) {
        send(ws, { type: "stream.event", requestId, event });
      }
      const message = await stream.result();
      send(ws, { type: "stream.done", requestId, message });
    } catch (error) {
      send(ws, { type: "stream.error", requestId, error: safeError(error) });
    } finally {
      streams.delete(requestId);
    }
  });

  return { started: true, requestId, provider: PROVIDER_ID, modelId };
}

async function dispatch(ws, message) {
  const { type, requestId } = message;
  switch (type) {
    case "auth.status":
      return respond(ws, requestId, await authStatus());
    case "auth.login":
      return respond(ws, requestId, await handleLogin(ws, requestId, message));
    case "auth.provideCode": {
      const loginRequestId = String(message.loginRequestId ?? "");
      const code = String(message.code ?? "").trim();
      const pending = pendingManualAuthPrompts.get(loginRequestId);
      if (!pending) throw new Error("No pending Codex login prompt");
      if (!code) throw new Error("Authorization code is empty");
      pending.resolve(code);
      return respond(ws, requestId, { accepted: true });
    }
    case "auth.cancelLogin": {
      const loginRequestId = String(message.loginRequestId ?? "");
      const pending = pendingManualAuthPrompts.get(loginRequestId);
      pending?.reject(new Error("Login cancelled"));
      return respond(ws, requestId, { cancelled: Boolean(pending) });
    }
    case "auth.logout":
      await models.logout(PROVIDER_ID);
      return respond(ws, requestId, { provider: PROVIDER_ID, loggedIn: false });
    case "models.list":
      return respond(ws, requestId, await handleModelsList());
    case "stream.start":
      return respond(ws, requestId, await handleStreamStart(ws, message));
    case "stream.abort": {
      const controller = streams.get(message.requestId);
      controller?.abort();
      return respond(ws, requestId, { aborted: Boolean(controller), requestId: message.requestId });
    }
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: args.port,
  verifyClient(info, done) {
    try {
      const url = new URL(info.req.url ?? "/", "ws://127.0.0.1");
      done(url.searchParams.get("token") === args.token, 401, "Unauthorized");
    } catch {
      done(false, 401, "Unauthorized");
    }
  },
});

wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
      await dispatch(ws, message);
    } catch (error) {
      reject(ws, message?.requestId, error);
    }
  });

  ws.on("close", () => {
    for (const controller of streams.values()) controller.abort();
    streams.clear();
  });
});

wss.on("listening", () => {
  const address = wss.address();
  const port = typeof address === "object" && address ? address.port : args.port;
  process.stdout.write(JSON.stringify({ type: "gateway.ready", host: "127.0.0.1", port }) + "\n");
});

process.on("SIGTERM", () => {
  for (const controller of streams.values()) controller.abort();
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});
