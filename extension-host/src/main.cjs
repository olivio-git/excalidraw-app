#!/usr/bin/env node
"use strict";

/**
 * QoriApp extension host entry point. Spawned by the app (src-tauri) and
 * spoken to over stdin/stdout with newline-delimited JSON (see rpc.cjs).
 * Anything extensions print goes to stderr so it can't corrupt the protocol.
 */

const readline = require("node:readline");
const util = require("node:util");
const { createRpc } = require("./rpc.cjs");
const { ExtensionHost } = require("./host.cjs");

const protocolWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function redirect(chunk, encoding, callback) {
  return process.stderr.write(chunk, encoding, callback);
};

const rpc = createRpc((line) => protocolWrite(`${line}\n`), {
  log: (...args) => process.stderr.write(`[rpc] ${util.format(...args)}\n`),
});
const host = new ExtensionHost(rpc);

process.on("uncaughtException", (error) => {
  host.log("error", `Excepción no capturada: ${error && error.stack ? error.stack : error}`);
});
process.on("unhandledRejection", (reason) => {
  host.log(
    "error",
    `Promesa rechazada sin capturar: ${reason && reason.stack ? reason.stack : reason}`
  );
});

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => rpc.receive(line));
input.on("close", async () => {
  // The app went away: give extensions a chance to clean up, then exit.
  rpc.dispose("App disconnected");
  await host.deactivateAll().catch(() => undefined);
  process.exit(0);
});

rpc.notify("ready", { pid: process.pid });
