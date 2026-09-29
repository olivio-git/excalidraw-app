"use strict";

const { Disposable, Uri } = require("./types.cjs");

/**
 * `vscode.commands`. Commands registered by extensions live here; unknown
 * commands activate the extension that declares them (`onCommand:`) and,
 * failing that, are forwarded to the app (workbench commands).
 */
function createCommands(host) {
  const registry = new Map();

  const builtins = {
    setContext(key, value) {
      host.rpc.notify("context.set", { key, value });
    },
    async "vscode.open"(uri, columnOrOptions) {
      const target = typeof uri === "string" ? Uri.parse(uri) : uri;
      if (target && target.scheme === "file") {
        return host.rpc.request("window.showTextDocument", {
          path: target.fsPath,
          options: columnOrOptions && typeof columnOrOptions === "object" ? columnOrOptions : {},
        });
      }
      if (target) return host.rpc.request("env.openExternal", { url: target.toString(true) });
      return undefined;
    },
    async "vscode.openWith"(uri) {
      return builtins["vscode.open"](uri);
    },
    async "vscode.openFolder"(uri) {
      return host.rpc.request("commands.executeWorkbench", {
        id: "vscode.openFolder",
        args: [uri ? uri.fsPath : undefined],
      });
    },
    async "workbench.action.openSettings"(query) {
      return host.rpc.request("commands.executeWorkbench", {
        id: "workbench.action.openExtensionSettingsJson",
        args: [query],
      });
    },
    "workbench.action.openSettingsJson"() {
      return builtins["workbench.action.openSettings"]();
    },
    "workbench.extensions.action.showExtensionsWithIds"() {
      return undefined;
    },
    "_workbench.captureSyntaxTokens"() {
      return [];
    },
  };

  function registerCommand(id, callback, thisArg, extensionId) {
    if (typeof id !== "string" || typeof callback !== "function") {
      throw new Error("Invalid arguments to registerCommand");
    }
    if (registry.has(id)) throw new Error(`command '${id}' already exists`);
    registry.set(id, { callback, thisArg, extensionId });
    host.rpc.notify("commands.registered", { id, extensionId });
    return new Disposable(() => {
      if (registry.get(id)?.callback !== callback) return;
      registry.delete(id);
      host.rpc.notify("commands.unregistered", { id });
    });
  }

  async function executeCommand(id, ...args) {
    let entry = registry.get(id);
    if (!entry && !(id in builtins)) {
      await host.activateByEvent(`onCommand:${id}`);
      entry = registry.get(id);
    }
    if (entry) return entry.callback.apply(entry.thisArg, args);
    if (id in builtins) return builtins[id](...args);
    return host.rpc.request("commands.executeWorkbench", { id, args: host.toTransferable(args) });
  }

  /** The namespace object handed to one extension. */
  function forExtension(extensionId) {
    return {
      registerCommand: (id, callback, thisArg) =>
        registerCommand(id, callback, thisArg, extensionId),
      registerTextEditorCommand: (id, callback, thisArg) =>
        registerCommand(
          id,
          (...args) => {
            const editor = host.getActiveTextEditor();
            if (!editor) return undefined;
            return editor.edit((builder) => callback.call(thisArg, editor, builder, ...args));
          },
          undefined,
          extensionId
        ),
      executeCommand,
      getCommands: async (filterInternal) => {
        const ids = [...registry.keys(), ...Object.keys(builtins)];
        return filterInternal ? ids.filter((id) => !id.startsWith("_")) : ids;
      },
      registerDiffInformationCommand: (id, callback, thisArg) =>
        registerCommand(id, callback, thisArg, extensionId),
    };
  }

  return { registry, executeCommand, forExtension, has: (id) => registry.has(id) };
}

module.exports = { createCommands };
