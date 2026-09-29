"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("./types.cjs");

/**
 * `ExtensionContext.globalState` / `workspaceState` (Memento) and `secrets`,
 * persisted as JSON files in the extension's storage folders. Writes are
 * debounced; values must be JSON-serializable, as in VS Code.
 */

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), mode ? { mode } : undefined);
}

function createMemento(file) {
  let data = readJson(file);
  let timer = null;
  const flush = () => {
    timer = null;
    try {
      writeJson(file, data);
    } catch (error) {
      console.error(`[exthost] Could not persist ${file}:`, error);
    }
  };
  return {
    keys: () => Object.keys(data),
    get(key, defaultValue) {
      return key in data ? JSON.parse(JSON.stringify(data[key])) : defaultValue;
    },
    update(key, value) {
      if (value === undefined) delete data[key];
      else data[key] = JSON.parse(JSON.stringify(value));
      if (!timer) timer = setTimeout(flush, 100);
      return Promise.resolve();
    },
    setKeysForSync() {},
    /** Write pending changes now (on shutdown). */
    flush() {
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    },
    /** Reload from disk (tests). */
    _reload() {
      data = readJson(file);
    },
  };
}

/**
 * SecretStorage. Stored in a user-only (0600) file in the global storage
 * folder — not an OS keychain.
 */
function createSecretStorage(file) {
  const onDidChange = new EventEmitter();
  let data = readJson(file);
  const save = () => writeJson(file, data, 0o600);
  return {
    get: (key) => Promise.resolve(data[key]),
    keys: () => Promise.resolve(Object.keys(data)),
    store(key, value) {
      data[key] = String(value);
      save();
      onDidChange.fire({ key });
      return Promise.resolve();
    },
    delete(key) {
      delete data[key];
      save();
      onDidChange.fire({ key });
      return Promise.resolve();
    },
    onDidChange: onDidChange.event,
    _reload() {
      data = readJson(file);
    },
  };
}

module.exports = { createMemento, createSecretStorage };
