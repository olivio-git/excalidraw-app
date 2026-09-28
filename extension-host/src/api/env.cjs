"use strict";

const path = require("node:path");
const { EventEmitter, noneEvent, Uri, UIKind, LogLevel } = require("./types.cjs");

/** `vscode.env`. */
function createEnv(host) {
  const onDidChangeLogLevel = new EventEmitter();
  const onDidChangeShell = new EventEmitter();

  return {
    get appName() {
      return "QoriApp";
    },
    get appRoot() {
      return path.resolve(__dirname, "..", "..");
    },
    appHost: "desktop",
    uriScheme: "qoriapp",
    get language() {
      return host.config.language ?? "en";
    },
    get machineId() {
      return host.config.machineId ?? "someValue.machineId";
    },
    get sessionId() {
      return host.config.sessionId ?? `${Date.now()}`;
    },
    remoteName: undefined,
    get shell() {
      return (
        host.config.shell ??
        process.env.SHELL ??
        (process.platform === "win32" ? "powershell.exe" : "/bin/sh")
      );
    },
    uiKind: UIKind.Desktop,
    isNewAppInstall: false,
    isTelemetryEnabled: false,
    telemetryLevel: "off",
    onDidChangeTelemetryEnabled: noneEvent,
    onDidChangeShell: onDidChangeShell.event,
    get logLevel() {
      return host.logLevel;
    },
    onDidChangeLogLevel: onDidChangeLogLevel.event,
    clipboard: {
      readText: () => host.rpc.request("env.clipboard.readText", {}).then((text) => text ?? ""),
      writeText: (value) => host.rpc.request("env.clipboard.writeText", { text: String(value) }),
    },
    openExternal: (uri) =>
      host.rpc
        .request("env.openExternal", { url: typeof uri === "string" ? uri : uri.toString(true) })
        .then((ok) => ok !== false),
    asExternalUri: (uri) => Promise.resolve(uri instanceof Uri ? uri : Uri.parse(String(uri))),
    createTelemetryLogger: (sender) => ({
      isUsageEnabled: false,
      isErrorsEnabled: false,
      onDidChangeEnableStates: noneEvent,
      logUsage() {},
      logError() {},
      dispose() {
        sender?.flush?.();
      },
    }),
    get LogLevel() {
      return LogLevel;
    },
  };
}

module.exports = { createEnv };
