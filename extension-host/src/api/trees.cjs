"use strict";

const path = require("node:path");
const { EventEmitter, Uri, TreeItemCollapsibleState } = require("./types.cjs");

/**
 * Tree views (`window.createTreeView` / `registerTreeDataProvider`). The app
 * asks for children by handle; handles are derived from `TreeItem.id` or the
 * label path so they stay stable across refreshes (expanded state survives).
 */
function createTrees(host) {
  const views = new Map();

  function labelText(item) {
    if (typeof item.label === "string") return item.label;
    if (item.label && typeof item.label.label === "string") return item.label.label;
    if (item.resourceUri) return path.basename(item.resourceUri.fsPath ?? item.resourceUri.path);
    return "";
  }

  function tooltipText(tooltip) {
    if (!tooltip) return undefined;
    return typeof tooltip === "string" ? tooltip : tooltip.value;
  }

  function serialize(view, item, handle, extension) {
    const label = labelText(item);
    let description = item.description;
    if (description === true && item.resourceUri) {
      description = host.workspace.asRelativePath(path.dirname(item.resourceUri.fsPath));
    }
    return {
      handle,
      label,
      description: typeof description === "string" ? description : undefined,
      tooltip: tooltipText(item.tooltip),
      collapsibleState: item.collapsibleState ?? TreeItemCollapsibleState.None,
      icon: host.serializeIcon(item.iconPath, extension),
      resourcePath: item.resourceUri?.scheme === "file" ? item.resourceUri.fsPath : undefined,
      isFolderResource:
        item.iconPath?.id === "folder" || (item.resourceUri && item.collapsibleState > 0),
      contextValue: item.contextValue,
      command: item.command
        ? { title: item.command.title, command: item.command.command }
        : undefined,
      checkboxState:
        item.checkboxState === undefined
          ? undefined
          : typeof item.checkboxState === "number"
            ? item.checkboxState
            : item.checkboxState.state,
    };
  }

  function createTreeView(viewId, options, extension) {
    const provider = options.treeDataProvider;
    if (!provider) throw new Error("createTreeView: treeDataProvider is required");
    const existing = views.get(viewId);
    if (existing) existing.dispose();

    const state = {
      provider,
      extension,
      elements: new Map(),
      items: new Map(),
      selection: [],
      visible: false,
      title: undefined,
      description: undefined,
      message: undefined,
      badge: undefined,
    };
    const emitters = {
      selection: new EventEmitter(),
      visibility: new EventEmitter(),
      expand: new EventEmitter(),
      collapse: new EventEmitter(),
      checkbox: new EventEmitter(),
    };
    const update = (changes) => host.rpc.notify("tree.update", { viewId, ...changes });
    const subscription = provider.onDidChangeTreeData
      ? provider.onDidChangeTreeData(() => host.rpc.notify("tree.refresh", { viewId }))
      : undefined;

    const treeView = {
      get visible() {
        return state.visible;
      },
      get selection() {
        return state.selection;
      },
      get title() {
        return state.title;
      },
      set title(value) {
        state.title = value;
        update({ title: value });
      },
      get description() {
        return state.description;
      },
      set description(value) {
        state.description = value;
        update({ description: value });
      },
      get message() {
        return state.message;
      },
      set message(value) {
        state.message = value;
        update({ message: typeof value === "string" ? value : value?.value });
      },
      get badge() {
        return state.badge;
      },
      set badge(value) {
        state.badge = value;
        update({ badge: value ? { value: value.value, tooltip: value.tooltip } : null });
      },
      onDidChangeSelection: emitters.selection.event,
      onDidChangeVisibility: emitters.visibility.event,
      onDidExpandElement: emitters.expand.event,
      onDidCollapseElement: emitters.collapse.event,
      onDidChangeCheckboxState: emitters.checkbox.event,
      async reveal(element, revealOptions = {}) {
        let handle;
        for (const [h, el] of state.elements) if (el === element) handle = h;
        host.rpc.notify("tree.reveal", {
          viewId,
          handle,
          select: revealOptions.select !== false,
          focus: !!revealOptions.focus,
          expand: revealOptions.expand ?? false,
        });
      },
      dispose() {
        subscription?.dispose();
        Object.values(emitters).forEach((e) => e.dispose());
        views.delete(viewId);
        host.rpc.notify("tree.disposed", { viewId });
      },
    };
    state.treeView = treeView;
    state.emitters = emitters;
    views.set(viewId, state);
    host.rpc.notify("tree.registered", {
      viewId,
      extensionId: extension?.id,
      canSelectMany: !!options.canSelectMany,
      showCollapseAll: !!options.showCollapseAll,
    });
    return treeView;
  }

  async function getChildren(viewId, parentHandle) {
    const state = views.get(viewId);
    if (!state) return null;
    const parent = parentHandle ? state.elements.get(parentHandle) : undefined;
    if (parentHandle && parent === undefined) return [];
    const children = (await state.provider.getChildren(parent)) ?? [];
    const labels = new Map();
    return Promise.all(
      children.map(async (element, index) => {
        let item = await state.provider.getTreeItem(element);
        if (state.provider.resolveTreeItem && !item.tooltip) {
          item =
            (await state.provider.resolveTreeItem(item, element, {
              isCancellationRequested: false,
            })) ?? item;
        }
        const label = labelText(item) || String(index);
        const count = labels.get(label) ?? 0;
        labels.set(label, count + 1);
        const handle =
          item.id !== undefined
            ? `id:${item.id}`
            : `${parentHandle ?? ""}/${label}${count ? `#${count}` : ""}`;
        state.elements.set(handle, element);
        state.items.set(handle, item);
        return serialize(state, item, handle, state.extension);
      })
    );
  }

  function elementsFor(state, handles) {
    return (handles ?? []).map((h) => state.elements.get(h)).filter((e) => e !== undefined);
  }

  host.rpc.on("tree.getChildren", ({ viewId, handle }) => getChildren(viewId, handle));
  host.rpc.on("tree.executeItemCommand", async ({ viewId, handle }) => {
    const command = views.get(viewId)?.items.get(handle)?.command;
    if (!command) return;
    return host.commands.executeCommand(command.command, ...(command.arguments ?? []));
  });
  host.rpc.on("tree.executeMenuCommand", async ({ viewId, handle, command, selectedHandles }) => {
    const state = views.get(viewId);
    if (!state) return host.commands.executeCommand(command);
    if (!handle) return host.commands.executeCommand(command);
    const element = state.elements.get(handle);
    const selected = elementsFor(state, selectedHandles);
    return host.commands.executeCommand(
      command,
      element,
      selected.length > 1 ? selected : undefined
    );
  });
  host.rpc.on("tree.selection", ({ viewId, handles }) => {
    const state = views.get(viewId);
    if (!state) return;
    state.selection = elementsFor(state, handles);
    state.emitters.selection.fire({ selection: state.selection });
  });
  host.rpc.on("tree.visibility", ({ viewId, visible }) => {
    const state = views.get(viewId);
    if (!state || state.visible === visible) return;
    state.visible = visible;
    state.emitters.visibility.fire({ visible });
  });
  host.rpc.on("tree.expanded", ({ viewId, handle, expanded }) => {
    const state = views.get(viewId);
    const element = state?.elements.get(handle);
    if (element === undefined) return;
    (expanded ? state.emitters.expand : state.emitters.collapse).fire({ element });
  });
  host.rpc.on("tree.checkbox", ({ viewId, handle, checked }) => {
    const state = views.get(viewId);
    const element = state?.elements.get(handle);
    if (element === undefined) return;
    state.emitters.checkbox.fire({ items: [[element, checked ? 1 : 0]] });
  });

  return {
    createTreeView,
    registerTreeDataProvider(viewId, provider, extension) {
      const view = createTreeView(viewId, { treeDataProvider: provider }, extension);
      return { dispose: () => view.dispose() };
    },
    has: (viewId) => views.has(viewId),
    getChildren,
    Uri,
  };
}

module.exports = { createTrees };
