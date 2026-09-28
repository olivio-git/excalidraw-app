"use strict";

const { Disposable, noneEvent } = require("./types.cjs");

/**
 * Namespaces and members of the VS Code API the app does not implement
 * (debug, tasks, scm, tests, ...). Instead of crashing an extension at
 * activation, missing members behave like "the feature exists but nothing
 * happens": registrations return a Disposable, events never fire, getters
 * return undefined. Each missing member is reported once to the host log.
 */

const VERB =
  /^(on|register|create|start|stop|add|remove|set|show|execute|get|fetch|update|open|select|save|apply|run|clear|refresh|reveal|focus|provide|resolve|compute|send|request|invoke|call|dispose|delete|write|read|find|watch|map|asRelative|asExternal|is|has|can|try|log|as)[A-Z_]?/;

function stubFunction(name) {
  if (name.startsWith("on")) return noneEvent;
  // `getX`/`findX` look up things that don't exist here.
  if (/^(get|find|is|has|can|fetch|compute|provide|resolve|read)/.test(name)) {
    return () => undefined;
  }
  return () => new Disposable(() => {});
}

/**
 * Proxy that serves `implemented` members and stubs for the rest.
 * `reportMissing(path)` is called once per missing member.
 */
function stubNamespace(namespace, implemented, reportMissing) {
  const reported = new Set();
  return new Proxy(implemented, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol" || prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "then" || prop === "toJSON") return undefined;
      const name = String(prop);
      if (!reported.has(name)) {
        reported.add(name);
        reportMissing(`${namespace}.${name}`);
      }
      if (VERB.test(name)) return stubFunction(name);
      // Collections (`breakpoints`, `tabGroups.all`) are empty, the rest unset.
      return /s$/.test(name) && !/(Status|Focus|Access)$/.test(name) ? [] : undefined;
    },
  });
}

/** Class used for unknown PascalCase members (so `extends vscode.Foo` works). */
function stubClass(name) {
  const Stub = class {
    constructor(...args) {
      this.__args = args;
    }
  };
  Object.defineProperty(Stub, "name", { value: name });
  return Stub;
}

module.exports = { stubNamespace, stubClass, stubFunction };
