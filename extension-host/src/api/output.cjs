"use strict";

const util = require("node:util");
const { EventEmitter, LogLevel } = require("./types.cjs");

/**
 * `window.createOutputChannel`. Text is streamed to the app's Output panel.
 * `{ log: true }` returns a LogOutputChannel with leveled, timestamped lines.
 */
function createOutputChannels(host) {
  let nextId = 1;

  function timestamp() {
    const d = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  function createOutputChannel(name, languageIdOrOptions) {
    const id = `output-${nextId++}`;
    const isLog = typeof languageIdOrOptions === "object" && languageIdOrOptions?.log === true;
    let disposed = false;
    const send = (method, params) => {
      if (!disposed) host.rpc.notify(method, { id, ...params });
    };
    host.rpc.notify("output.create", { id, name, log: isLog });

    const channel = {
      name,
      append: (value) => send("output.append", { text: String(value) }),
      appendLine: (value) => send("output.append", { text: `${value}\n` }),
      replace: (value) => {
        send("output.clear", {});
        send("output.append", { text: String(value) });
      },
      clear: () => send("output.clear", {}),
      show: (columnOrPreserveFocus, preserveFocus) =>
        send("output.show", {
          preserveFocus:
            typeof columnOrPreserveFocus === "boolean" ? columnOrPreserveFocus : !!preserveFocus,
        }),
      hide: () => send("output.hide", {}),
      dispose: () => {
        send("output.dispose", {});
        disposed = true;
      },
    };
    if (!isLog) return channel;

    const levelEmitter = new EventEmitter();
    const write = (level, label, message, args) => {
      if (host.logLevel > level) return;
      const text = args.length
        ? util.format(message, ...args)
        : message instanceof Error
          ? message.stack
          : String(message);
      channel.appendLine(`${timestamp()} [${label}] ${text}`);
    };
    return Object.assign(channel, {
      get logLevel() {
        return host.logLevel;
      },
      onDidChangeLogLevel: levelEmitter.event,
      trace: (message, ...args) => write(LogLevel.Trace, "trace", message, args),
      debug: (message, ...args) => write(LogLevel.Debug, "debug", message, args),
      info: (message, ...args) => write(LogLevel.Info, "info", message, args),
      warn: (message, ...args) => write(LogLevel.Warning, "warning", message, args),
      error: (error, ...args) => write(LogLevel.Error, "error", error, args),
    });
  }

  return { createOutputChannel };
}

module.exports = { createOutputChannels };
