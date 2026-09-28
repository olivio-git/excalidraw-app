"use strict";

const { StatusBarAlignment } = require("./types.cjs");

/**
 * `window.createStatusBarItem`. Item state is pushed to the app whenever it
 * changes while visible; clicks come back as `statusBar.click`.
 */
function createStatusBar(host) {
  let nextId = 1;
  const items = new Map();

  function colorValue(color) {
    if (!color) return undefined;
    return typeof color === "string" ? color : { themeColor: color.id };
  }

  function createStatusBarItem(idOrAlignment, alignmentOrPriority, maybePriority, extensionId) {
    let alignment = StatusBarAlignment.Left;
    let priority;
    let itemId;
    if (typeof idOrAlignment === "string") {
      itemId = idOrAlignment;
      alignment = alignmentOrPriority ?? StatusBarAlignment.Left;
      priority = maybePriority;
    } else {
      alignment = idOrAlignment ?? StatusBarAlignment.Left;
      priority = alignmentOrPriority;
    }
    const id = `status-${nextId++}`;
    const state = {
      text: "",
      tooltip: undefined,
      command: undefined,
      color: undefined,
      backgroundColor: undefined,
      name: undefined,
      accessibilityInformation: undefined,
    };
    let visible = false;
    let scheduled = false;

    const push = () => {
      if (!visible || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!visible) return;
        const command = state.command;
        host.rpc.notify("statusBar.update", {
          id,
          itemId: itemId ?? `${extensionId}.${id}`,
          extensionId,
          alignment: alignment === StatusBarAlignment.Right ? "right" : "left",
          priority: priority ?? 0,
          text: state.text,
          name: state.name,
          tooltip: typeof state.tooltip === "string" ? state.tooltip : state.tooltip?.value,
          hasCommand: !!command,
          color: colorValue(state.color),
          backgroundColor: colorValue(state.backgroundColor),
        });
      });
    };

    const item = {
      get id() {
        return itemId ?? id;
      },
      get alignment() {
        return alignment;
      },
      get priority() {
        return priority;
      },
      show() {
        visible = true;
        push();
      },
      hide() {
        visible = false;
        host.rpc.notify("statusBar.dispose", { id });
      },
      dispose() {
        item.hide();
        items.delete(id);
      },
    };
    for (const key of Object.keys(state)) {
      Object.defineProperty(item, key, {
        enumerable: true,
        get: () => state[key],
        set: (value) => {
          state[key] = value;
          push();
        },
      });
    }
    items.set(id, { item, state });
    return item;
  }

  /** Runs the item's command (string or Command object). */
  async function click(id) {
    const entry = items.get(id);
    const command = entry?.state.command;
    if (!command) return;
    if (typeof command === "string") return host.commands.executeCommand(command);
    return host.commands.executeCommand(command.command, ...(command.arguments ?? []));
  }

  return { createStatusBarItem, click };
}

module.exports = { createStatusBar };
