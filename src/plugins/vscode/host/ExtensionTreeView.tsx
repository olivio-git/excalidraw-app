import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useThemeStore } from "@/stores/themeStore";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { fileIconRegistry } from "@/core/shell/panels/file-icon-registry";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { extensionHost } from "./extension-host-service";
import { useExtensionHostStore } from "./host-store";
import { nextSequence, useTreeStore } from "./view-stores";
import { HostIcon, LabelWithIcons, type SerializedIcon } from "./codicons";
import { CommandIcon } from "./ViewActions";
import type { ViewMenus } from "./view-containers";

/** A tree item as serialized by the extension host (trees.cjs). */
export interface HostTreeItem {
  handle: string;
  label: string;
  description?: string;
  tooltip?: string;
  collapsibleState: 0 | 1 | 2;
  icon?: SerializedIcon;
  resourcePath?: string;
  isFolderResource?: boolean;
  contextValue?: string;
  command?: { title: string; command: string };
  checkboxState?: number;
}

interface NodeState {
  children?: string[];
  loading: boolean;
}

const INDENT = 12;

export function ExtensionTreeView({ viewId, menus }: { viewId: string; menus: ViewMenus }) {
  const view = useTreeStore((s) => s.views[viewId]);
  const hostStatus = useExtensionHostStore((s) => s.status);
  const isDark = useThemeStore((s) => s.resolvedTheme === "dark");
  const [items, setItems] = useState<Record<string, HostTreeItem>>({});
  const [nodes, setNodes] = useState<Record<string, NodeState>>({});
  const [roots, setRoots] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [userSelection, setUserSelection] = useState<{ handle: string; at: number } | null>(null);
  const [activating, setActivating] = useState(true);
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const fetchChildren = useCallback(
    async (handle?: string): Promise<HostTreeItem[]> => {
      const result = await extensionHost.request<HostTreeItem[] | null>("tree.getChildren", {
        viewId,
        handle,
      });
      return result ?? [];
    },
    [viewId]
  );

  const loadNodeRef = useRef<(handle: string) => Promise<void>>(async () => undefined);

  /** Store fetched items; items the extension marks Expanded load their children. */
  const absorb = useCallback((children: HostTreeItem[]) => {
    setItems((prev) => {
      const next = { ...prev };
      for (const child of children) next[child.handle] = child;
      return next;
    });
    const autoExpand = children.filter(
      (child) => child.collapsibleState === 2 && !expandedRef.current.has(child.handle)
    );
    if (autoExpand.length === 0) return;
    setExpanded((prev) => new Set([...prev, ...autoExpand.map((child) => child.handle)]));
    for (const child of autoExpand) void loadNodeRef.current(child.handle);
  }, []);

  const loadNode = useCallback(
    async (handle: string) => {
      setNodes((prev) => ({ ...prev, [handle]: { ...prev[handle], loading: true } }));
      try {
        const children = await fetchChildren(handle);
        absorb(children);
        setNodes((prev) => ({
          ...prev,
          [handle]: { children: children.map((c) => c.handle), loading: false },
        }));
      } catch {
        setNodes((prev) => ({ ...prev, [handle]: { children: [], loading: false } }));
      }
    },
    [fetchChildren, absorb]
  );
  useEffect(() => {
    loadNodeRef.current = loadNode;
  }, [loadNode]);

  // Activate the extension for this view (`onView:`), then wait for its provider.
  useEffect(() => {
    let cancelled = false;
    void extensionHost
      .activateByEvent(`onView:${viewId}`)
      .finally(() => !cancelled && setActivating(false));
    extensionHost.notify("tree.visibility", { viewId, visible: true });
    return () => {
      cancelled = true;
      extensionHost.notify("tree.visibility", { viewId, visible: false });
    };
  }, [viewId, hostStatus]);

  // (Re)load the root and every expanded node whenever the data changes.
  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    void fetchChildren()
      .then((children) => {
        if (cancelled) return;
        absorb(children);
        setRoots(children.map((c) => c.handle));
        for (const handle of expandedRef.current) void loadNode(handle);
      })
      .catch(() => !cancelled && setRoots([]));
    return () => {
      cancelled = true;
    };
  }, [view?.version, view, fetchChildren, absorb, loadNode]);

  // The extension's reveal() wins over an older click selection.
  const reveal = view?.reveal;
  const selected =
    reveal?.handle && (!userSelection || reveal.token > userSelection.at)
      ? reveal.handle
      : (userSelection?.handle ?? null);

  const toggle = (item: HostTreeItem) => {
    if (item.collapsibleState === 0) return;
    const isOpen = expanded.has(item.handle);
    if (!isOpen && !nodes[item.handle]) void loadNode(item.handle);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(item.handle);
      else next.add(item.handle);
      return next;
    });
    extensionHost.notify("tree.expanded", { viewId, handle: item.handle, expanded: !isOpen });
  };

  const activate = (item: HostTreeItem) => {
    setUserSelection({ handle: item.handle, at: nextSequence() });
    extensionHost.notify("tree.selection", { viewId, handles: [item.handle] });
    if (item.command)
      void extensionHost.request("tree.executeItemCommand", { viewId, handle: item.handle });
    else toggle(item);
  };

  const itemMenus = (menus.item.get(viewId) ?? []).filter(Boolean);

  const menuFor = (item: HostTreeItem) =>
    itemMenus.filter((entry) =>
      contextKeyService.evaluateWith(entry.when, {
        view: viewId,
        viewItem: item.contextValue ?? "",
      })
    );

  const runMenu = (item: HostTreeItem, command: string) =>
    void extensionHost.request("tree.executeMenuCommand", { viewId, handle: item.handle, command });

  const renderItem = (handle: string, depth: number): React.ReactNode => {
    const item = items[handle];
    if (!item) return null;
    const isOpen = expanded.has(handle);
    const node = nodes[handle];
    const entries = menuFor(item);
    const inline = entries.filter((entry) => entry.group?.startsWith("inline"));
    const contextEntries = entries.filter((entry) => !entry.group?.startsWith("inline"));
    const fileIcon = item.resourcePath && !item.icon ? fileIconRegistry.resolve(item.label) : null;
    const FileIcon = fileIcon?.icon;

    const row = (
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={item.collapsibleState === 0 ? undefined : isOpen}
        aria-selected={selected === handle}
        tabIndex={0}
        title={item.tooltip ?? item.label}
        onClick={() => activate(item)}
        onKeyDown={(e) => {
          if (e.key === "Enter") activate(item);
          else if (e.key === "ArrowRight" && !isOpen) toggle(item);
          else if (e.key === "ArrowLeft" && isOpen) toggle(item);
        }}
        className={cn(
          "group flex h-6 cursor-pointer items-center gap-1 pr-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring",
          selected === handle ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
        )}
        style={{ paddingLeft: depth * INDENT + 4 }}
      >
        <span
          className="flex size-4 shrink-0 items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            toggle(item);
          }}
        >
          {item.collapsibleState !== 0 &&
            (node?.loading ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            ) : (
              <ChevronRight className={cn("size-3 transition-transform", isOpen && "rotate-90")} />
            ))}
        </span>
        {item.icon ? (
          <HostIcon icon={item.icon} isDark={isDark} className="shrink-0" />
        ) : FileIcon ? (
          <FileIcon className={cn("size-4 shrink-0", fileIcon?.colorClass)} />
        ) : null}
        <span className="truncate">
          <LabelWithIcons text={item.label} />
        </span>
        {item.description && (
          <span className="truncate text-[11px] text-muted-foreground">{item.description}</span>
        )}
        <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {inline.map((entry) => (
            <button
              key={entry.command}
              aria-label={menus.commands.get(entry.command)?.title ?? entry.command}
              title={menus.commands.get(entry.command)?.title ?? entry.command}
              className="flex size-5 items-center justify-center rounded hover:bg-background/60"
              onClick={(e) => {
                e.stopPropagation();
                runMenu(item, entry.command);
              }}
            >
              <CommandIcon command={menus.commands.get(entry.command)} />
            </button>
          ))}
        </span>
      </div>
    );

    return (
      <li key={handle} role="none">
        {contextEntries.length > 0 ? (
          <ContextMenu>
            <ContextMenuTrigger render={row} />
            <ContextMenuContent>
              {contextEntries.map((entry) => (
                <ContextMenuItem key={entry.command} onClick={() => runMenu(item, entry.command)}>
                  {menus.commands.get(entry.command)?.title ?? entry.command}
                </ContextMenuItem>
              ))}
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          row
        )}
        {isOpen && node?.children && node.children.length > 0 && (
          <ul role="group">{node.children.map((child) => renderItem(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  if (!view) {
    return (
      <p className="px-4 py-2 text-xs text-muted-foreground">
        {hostStatus === "running" && !activating
          ? "La extensión no ha registrado datos para esta vista."
          : hostStatus === "error" || hostStatus === "unavailable"
            ? "El Extension Host no está disponible."
            : "Cargando…"}
      </p>
    );
  }

  return (
    <div className="py-1">
      {view.message && <p className="px-4 pb-1 text-xs text-muted-foreground">{view.message}</p>}
      {roots === null ? (
        <p className="px-4 py-1 text-xs text-muted-foreground">Cargando…</p>
      ) : roots.length === 0 ? (
        !view.message && <p className="px-4 py-1 text-xs text-muted-foreground">Sin elementos.</p>
      ) : (
        <ul role="tree" aria-label={view.title ?? viewId}>
          {roots.map((handle) => renderItem(handle, 0))}
        </ul>
      )}
    </div>
  );
}
