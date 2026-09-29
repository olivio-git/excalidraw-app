"use strict";

const { EventEmitter, ConfigurationTarget } = require("./types.cjs");

/**
 * `workspace.getConfiguration`. Settings are a flat map (`"a.b.c": value`)
 * of contributed defaults overlaid with the user's settings.json; sections
 * read as nested objects like in VS Code.
 */
function createConfiguration(host) {
  let defaults = {};
  let user = {};
  const onDidChange = new EventEmitter();

  function merged() {
    return { ...defaults, ...user };
  }

  function lookup(values, key) {
    if (key in values) return { found: true, value: values[key] };
    const prefix = `${key}.`;
    let found = false;
    const nested = {};
    for (const [k, v] of Object.entries(values)) {
      if (!k.startsWith(prefix)) continue;
      found = true;
      const parts = k.slice(prefix.length).split(".");
      let target = nested;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof target[parts[i]] !== "object" || target[parts[i]] === null)
          target[parts[i]] = {};
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = v;
    }
    return { found, value: found ? nested : undefined };
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function getConfiguration(section) {
    const values = merged();
    const full = (key) => (section ? `${section}.${key}` : key);
    const sectionObject = section ? lookup(values, section).value : undefined;

    const config = {
      get(key, defaultValue) {
        const { found, value } = lookup(values, full(key));
        return found ? clone(value) : defaultValue;
      },
      has(key) {
        return lookup(values, full(key)).found;
      },
      inspect(key) {
        const k = full(key);
        const d = lookup(defaults, k);
        const u = lookup(user, k);
        return {
          key: k,
          defaultValue: d.found ? clone(d.value) : undefined,
          globalValue: u.found ? clone(u.value) : undefined,
          workspaceValue: undefined,
          workspaceFolderValue: undefined,
        };
      },
      async update(key, value, target = ConfigurationTarget.Global) {
        await host.rpc.request("configuration.update", {
          key: full(key),
          value: host.toTransferable(value),
          target,
        });
        const changed = [full(key)];
        if (value === undefined) delete user[full(key)];
        else user[full(key)] = value;
        fireChanged(changed);
      },
    };
    // Section values are also readable as plain properties (`config.enable`).
    if (sectionObject && typeof sectionObject === "object") {
      for (const [k, v] of Object.entries(sectionObject)) {
        if (!(k in config)) config[k] = clone(v);
      }
    } else if (!section) {
      for (const [k] of Object.entries(values)) {
        const top = k.split(".")[0];
        if (!(top in config)) config[top] = lookup(values, top).value;
      }
    }
    return Object.freeze(config);
  }

  function fireChanged(keys) {
    onDidChange.fire({
      affectsConfiguration(section) {
        return keys.some(
          (key) => key === section || key.startsWith(`${section}.`) || section.startsWith(`${key}.`)
        );
      },
    });
  }

  function setValues(nextDefaults, nextUser) {
    const before = merged();
    defaults = { ...(nextDefaults ?? {}) };
    user = { ...(nextUser ?? {}) };
    const after = merged();
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
    );
    if (changed.length > 0) fireChanged(changed);
  }

  host.rpc.on("configuration.changed", ({ defaults: d, user: u }) => setValues(d, u));

  return { getConfiguration, setValues, onDidChangeConfiguration: onDidChange.event };
}

module.exports = { createConfiguration };
