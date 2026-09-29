"use strict";

/**
 * Newline-delimited JSON-RPC between the extension host and the app:
 *
 *   {"type":"req","id":1,"method":"window.showMessage","params":{...}}
 *   {"type":"res","id":1,"result":"OK"}            (or "error":{"message"})
 *   {"type":"ntf","method":"output.append","params":{...}}
 *
 * Both sides send requests; each side answers the other's.
 */

function serializeError(error) {
  if (error instanceof Error)
    return { message: error.message, stack: error.stack, name: error.name };
  return { message: String(error) };
}

function createRpc(writeLine, options = {}) {
  const pending = new Map();
  const handlers = new Map();
  let nextId = 1;
  const log = options.log ?? ((...args) => console.error("[rpc]", ...args));

  function send(message) {
    let line;
    try {
      line = JSON.stringify(message, (_key, value) => {
        if (typeof value === "bigint") return Number(value);
        if (value instanceof Uint8Array) return Array.from(value);
        return value;
      });
    } catch (error) {
      log("Could not serialize message", message && message.method, error);
      if (message.type === "res") {
        line = JSON.stringify({ type: "res", id: message.id, error: serializeError(error) });
      } else {
        return;
      }
    }
    writeLine(line);
  }

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      send({ type: "req", id, method, params });
    });
  }

  function notify(method, params) {
    send({ type: "ntf", method, params });
  }

  function on(method, handler) {
    handlers.set(method, handler);
  }

  async function handleRequest(message) {
    const handler = handlers.get(message.method);
    if (!handler) {
      send({
        type: "res",
        id: message.id,
        error: { message: `Unknown method: ${message.method}` },
      });
      return;
    }
    try {
      const result = await handler(message.params ?? {});
      send({ type: "res", id: message.id, result: result === undefined ? null : result });
    } catch (error) {
      send({ type: "res", id: message.id, error: serializeError(error) });
    }
  }

  function receive(line) {
    if (!line || !line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      log("Invalid message", line.slice(0, 200));
      return;
    }
    if (message.type === "res") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message);
        error.remote = true;
        entry.reject(error);
      } else {
        entry.resolve(message.result === null ? undefined : message.result);
      }
    } else if (message.type === "req") {
      void handleRequest(message);
    } else if (message.type === "ntf") {
      const handler = handlers.get(message.method);
      if (!handler) return;
      // Run now, not in a microtask: a request that follows must see its effects
      // (e.g. `document.closed` then a language request for that document).
      try {
        const result = handler(message.params ?? {});
        if (result && typeof result.catch === "function") {
          result.catch((error) => log(`Notification ${message.method} failed`, error));
        }
      } catch (error) {
        log(`Notification ${message.method} failed`, error);
      }
    }
  }

  /** Fail every pending request (the other side went away). */
  function dispose(reason = "Connection closed") {
    for (const entry of pending.values()) entry.reject(new Error(reason));
    pending.clear();
  }

  return { request, notify, on, receive, dispose };
}

module.exports = { createRpc, serializeError };
