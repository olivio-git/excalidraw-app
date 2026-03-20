import { useState, useEffect, useMemo, startTransition, useRef, useCallback } from "react";
import { readDir, mkdir, remove } from "@tauri-apps/plugin-fs";
import { rename } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { FolderOpen } from "lucide-react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useExplorerStore } from "@/stores/explorerStore";
import { useFileWatcher } from "@/core/shell/useFileWatcher";
import { fileHandlerRegistry } from "./file-handler-registry";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/utils";
import { ExplorerToolbar } from "./ExplorerToolbar";
import { ExplorerBreadcrumb } from "./ExplorerBreadcrumb";
import { FileTreeNode } from "./FileTreeNode";
import { InlineInput } from "./InlineInput";
import { QuickOpenDialog } from "./QuickOpenDialog";
import { updateTabsAfterRename, closeTabsForDeletedPath } from "./explorer-tab-sync";
import { sortTree, flattenVisible, filterTree, getFilteredExpandedPaths } from "./explorer-utils";
import { useDragAndDrop } from "@/core/shell/hooks/useDragAndDrop";
import { useMultiSelect } from "@/core/shell/hooks/useMultiSelect";
import { useKeyboardNav } from "@/core/shell/hooks/useKeyboardNav";
import { useFileClipboard } from "@/core/shell/hooks/useFileClipboard";
import type { FileEntry, CreatingState, DragData } from "./explorer-types";
import { ChevronRight, ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildTree = async (dir: string, showDotfiles: boolean): Promise<FileEntry[]> => {
  const entries = await readDir(dir);
  const result: FileEntry[] = [];

  for (const entry of entries) {
    if (!entry.name) continue;
    if (!showDotfiles && entry.name.startsWith(".")) continue;
    const fullPath = await join(dir, entry.name);

    if (entry.isDirectory) {
      const children = await buildTree(fullPath, showDotfiles);
      result.push({ name: entry.name, path: fullPath, isDir: true, children });
    } else {
      result.push({ name: entry.name, path: fullPath, isDir: false });
    }
  }

  // Default sort (type-first) — will be re-sorted via sortTree in display useMemo
  return result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
};

const getAncestorPaths = (filePath: string, workspaceDir: string): string[] => {
  const relative = filePath.replace(workspaceDir, "");
  const parts = relative.split("/").filter(Boolean);
  const ancestors: string[] = [];
  let current = workspaceDir;
  for (let i = 0; i < parts.length - 1; i++) {
    current = `${current}/${parts[i]}`;
    ancestors.push(current);
  }
  return ancestors;
};

// ---------------------------------------------------------------------------
// ExplorerPanel — container component
// All async Tauri calls live here. Presentational children receive callbacks.
// ---------------------------------------------------------------------------

export const ExplorerPanel = () => {
  // --- Store subscriptions ---
  const workspaceDir = useWorkspaceStore((s) => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore((s) => s.setWorkspaceDir);
  const addTab = useTabStore((s) => s.addTab);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const sortOrder = useExplorerStore((s) => s.sortOrder);
  const showDotfiles = useExplorerStore((s) => s.showDotfiles);

  // --- Tree state ---
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(workspaceDir ? [workspaceDir] : [])
  );
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingState | null>(null);

  // --- Phase 1: selection + focus ---
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  // --- Phase 2: inline filter ---
  const [filterQuery, setFilterQuery] = useState("");

  // --- Phase 2: quick open ---
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);

  // --- Ref for keyboard nav focus detection ---
  const containerRef = useRef<HTMLDivElement | null>(null);

  // --- Phase 1: multi-select (must be declared early — used by handleBatchDelete) ---
  const { selectedPaths, setSelectedPaths, handleNodeClick, clearSelection } = useMultiSelect();

  // --- Derived: sorted display tree ---
  const sortedTree = useMemo(() => {
    return sortTree(tree, sortOrder);
  }, [tree, sortOrder]);

  // --- Phase 2: filtered tree (applies when filterQuery is non-empty) ---
  const displayTree = useMemo(() => {
    if (!filterQuery.trim()) return sortedTree;
    return filterTree(sortedTree, filterQuery);
  }, [sortedTree, filterQuery]);

  // --- Phase 2: filter result count (total nodes in filtered tree) ---
  const filterResultCount = useMemo(() => {
    if (!filterQuery.trim()) return undefined;
    let count = 0;
    function countNodes(entries: FileEntry[]) {
      for (const e of entries) {
        count++;
        if (e.isDir && e.children) countNodes(e.children);
      }
    }
    countNodes(displayTree);
    return count;
  }, [displayTree, filterQuery]);

  // --- Phase 2: auto-expand paths that contain filter matches ---
  const filterExpandedPaths = useMemo(() => {
    if (!filterQuery.trim()) return null;
    return getFilteredExpandedPaths(sortedTree, filterQuery);
  }, [sortedTree, filterQuery]);

  // --- Flat nodes for keyboard nav + multi-select range ---
  const flatNodes = useMemo(() => {
    // When filtering, use filter-expanded paths so all matching nodes are visible
    const effectiveExpanded = filterExpandedPaths
      ? new Set([...expandedPaths, ...filterExpandedPaths])
      : expandedPaths;
    return flattenVisible(displayTree, effectiveExpanded);
  }, [displayTree, expandedPaths, filterExpandedPaths]);

  useEffect(() => {
    if (workspaceDir) {
      startTransition(() => {
        setExpandedPaths((prev) => new Set(prev).add(workspaceDir));
      });
    }
  }, [workspaceDir]);

  const activeFilePath = useMemo(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    return tab?.metadata?.filePath as string | undefined;
  }, [tabs, activeTabId]);

  // -------------------------------------------------------------------------
  // Tree loading
  // -------------------------------------------------------------------------

  const refresh = useCallback(async () => {
    if (!workspaceDir) return;
    const entries = await buildTree(workspaceDir, showDotfiles);
    setTree(entries);
  }, [workspaceDir, showDotfiles]);

  useEffect(() => {
    startTransition(() => {
      void refresh();
    });
  }, [refresh]);
  useFileWatcher(workspaceDir, refresh);

  // -------------------------------------------------------------------------
  // Auto-expand folders to reveal the active file
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!activeFilePath || !workspaceDir) return;
    const ancestors = getAncestorPaths(activeFilePath, workspaceDir);
    if (ancestors.length === 0) return;
    startTransition(() => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        ancestors.forEach((p) => next.add(p));
        return next;
      });
    });
  }, [activeFilePath, workspaceDir]);

  // -------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------

  const handleOpenWorkspace = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") setWorkspaceDir(dir);
  };

  // -------------------------------------------------------------------------
  // Tree toggle / collapse all
  // -------------------------------------------------------------------------

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleCollapseAll = () => setExpandedPaths(new Set());

  // Task 3.4: Breadcrumb — expand given paths in the tree
  const handleExpandPaths = useCallback((paths: string[]) => {
    startTransition(() => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        paths.forEach((p) => next.add(p));
        return next;
      });
    });
  }, []);

  // -------------------------------------------------------------------------
  // Open file
  // -------------------------------------------------------------------------

  const handleOpenFile = useCallback(
    (filePath: string, name: string) => {
      const handler = fileHandlerRegistry.resolve(name);
      if (!handler) return;
      const title = handler.displayName ? handler.displayName(name) : name;
      addTab({
        routeId: handler.routeId,
        path: `/${handler.routeId}`,
        title,
        instanceId: filePath,
        metadata: { filePath },
      });
    },
    [addTab]
  );

  // -------------------------------------------------------------------------
  // Create new file / folder
  // -------------------------------------------------------------------------

  const handleNewFile = useCallback((parentPath: string) => {
    setExpandedPaths((prev) => new Set(prev).add(parentPath));
    setCreating({ parentPath, type: "file" });
  }, []);

  const handleNewFolder = useCallback((parentPath: string) => {
    setExpandedPaths((prev) => new Set(prev).add(parentPath));
    setCreating({ parentPath, type: "folder" });
  }, []);

  const handleCommitCreate = useCallback(
    async (parentPath: string, name: string, type: "file" | "folder") => {
      setCreating(null);
      if (type === "folder") {
        const folderPath = await join(parentPath, name);
        await mkdir(folderPath);
        await refresh();
      } else {
        if (name.includes(".") && !fileHandlerRegistry.resolve(name)) return;
        const handler = fileHandlerRegistry.getDefault();
        const finalName = name.includes(".") ? name : `${name}.${handler.defaultExtension}`;
        const filePath = await handler.create(parentPath, finalName);
        await refresh();
        const title = handler.displayName ? handler.displayName(finalName) : finalName;
        addTab({
          routeId: handler.routeId,
          path: `/${handler.routeId}`,
          title,
          instanceId: filePath,
          metadata: { filePath },
        });
      }
    },
    [refresh, addTab]
  );

  // -------------------------------------------------------------------------
  // Rename — uses explorer-tab-sync instead of inline tab iteration
  // -------------------------------------------------------------------------

  const handleCommitRename = useCallback(
    async (oldPath: string, newName: string) => {
      setRenamingPath(null);
      const dir = oldPath.substring(0, oldPath.lastIndexOf("/"));
      const oldExt = oldPath.split(".").pop() ?? "";
      const resolvedName = newName.includes(".") ? newName : `${newName}.${oldExt}`;
      const newPath = await join(dir, resolvedName);
      await rename(oldPath, newPath);
      updateTabsAfterRename(oldPath, newPath);
      await refresh();
    },
    [refresh]
  );

  // -------------------------------------------------------------------------
  // Delete — uses explorer-tab-sync instead of inline tab iteration
  // -------------------------------------------------------------------------

  const handleDelete = useCallback(
    async (filePath: string, isDir: boolean) => {
      const name = filePath.split("/").pop() ?? filePath;
      const ok = await confirm({
        title: isDir ? "Eliminar carpeta" : "Eliminar archivo",
        description: `¿Eliminar "${name}"? Esta acción no se puede deshacer.`,
        confirmLabel: "Eliminar",
        variant: "destructive",
      });
      if (!ok) return;
      await remove(filePath, { recursive: isDir });
      closeTabsForDeletedPath(filePath);
      notify(`"${name}" eliminado`, { type: "success" });
      await refresh();
    },
    [refresh]
  );

  // -------------------------------------------------------------------------
  // Task 1.5 — Batch delete
  // -------------------------------------------------------------------------

  const handleBatchDelete = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;

      const names = paths.map((p) => p.split("/").pop() ?? p);
      const listPreview = names
        .slice(0, 5)
        .map((n) => `• ${n}`)
        .join("\n");
      const extra = paths.length > 5 ? `\ny ${paths.length - 5} más...` : "";

      const ok = await confirm({
        title: `Eliminar ${paths.length} elementos`,
        description: `¿Eliminar los siguientes elementos? Esta acción no se puede deshacer.\n\n${listPreview}${extra}`,
        confirmLabel: "Eliminar todo",
        variant: "destructive",
      });
      if (!ok) return;

      for (const filePath of paths) {
        try {
          // Determine if it's a directory by checking the flat nodes
          const node = flatNodes.find((n) => n.path === filePath);
          const isDir = node?.isDir ?? false;
          await remove(filePath, { recursive: isDir });
          closeTabsForDeletedPath(filePath);
        } catch (err) {
          const name = filePath.split("/").pop() ?? filePath;
          const msg = err instanceof Error ? err.message : String(err);
          notify(`Error al eliminar "${name}": ${msg}`, { type: "error" });
        }
      }

      clearSelection();
      setFocusedPath(null);
      notify(`${paths.length} elementos eliminados`, { type: "success" });
      await refresh();
    },
    [flatNodes, refresh, clearSelection]
  );

  // -------------------------------------------------------------------------
  // Copy path
  // -------------------------------------------------------------------------

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
  }, []);

  const handleCopyRelativePath = useCallback((path: string, wsDir: string) => {
    const relative = path.replace(`${wsDir}/`, "");
    navigator.clipboard.writeText(relative);
  }, []);

  // -------------------------------------------------------------------------
  // Cancel any pending action
  // -------------------------------------------------------------------------

  const handleCancelAction = useCallback(() => {
    setRenamingPath(null);
    setCreating(null);
  }, []);

  // -------------------------------------------------------------------------
  // Clipboard — useFileClipboard hook
  // -------------------------------------------------------------------------

  const {
    clipboardState,
    cut: handleCut,
    copy: handleCopy,
    paste: handlePaste,
  } = useFileClipboard(refresh);

  // -------------------------------------------------------------------------
  // Phase 1 — Click handler (multi-select)
  // -------------------------------------------------------------------------

  const handleClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      handleNodeClick(e, path, flatNodes, focusedPath, setFocusedPath);
    },
    [handleNodeClick, flatNodes, focusedPath]
  );

  // -------------------------------------------------------------------------
  // Phase 1 — Keyboard nav hook
  // -------------------------------------------------------------------------

  useKeyboardNav(
    containerRef,
    {
      flatNodes,
      expandedPaths,
      onOpen: handleOpenFile,
      onStartRename: setRenamingPath,
      onDelete: handleDelete,
      onToggle: handleToggle,
      selectedPaths,
      setSelectedPaths,
    },
    focusedPath,
    setFocusedPath,
    renamingPath,
    creating !== null,
    handleCancelAction
  );

  // -------------------------------------------------------------------------
  // Phase 1 — Drag and drop hook
  // -------------------------------------------------------------------------

  const dnd = useDragAndDrop();

  const handleDragStart = (event: DragStartEvent) => {
    dnd.handleDragStart(event);
    // If the dragged item is not in the current selection, clear and select it
    const data = event.active.data.current as DragData | undefined;
    if (data && !selectedPaths.has(data.path)) {
      clearSelection();
      setFocusedPath(data.path);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = (event.over?.id as string | null) ?? null;
    dnd.handleDragOver(overId);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    await dnd.handleDragEnd(event, refresh);
  };

  // -------------------------------------------------------------------------
  // Escape key to cancel (global — existing behavior preserved)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancelAction();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCancelAction]);

  // -------------------------------------------------------------------------
  // Phase 2 — Ctrl+P: Quick Open (window-level, no portal needed)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        setQuickOpenOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // -------------------------------------------------------------------------
  // Phase 2 — Clipboard keyboard shortcuts (gated on explorer focus)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: KeyboardEvent) => {
      // Gate: only when explorer panel has focus
      if (!container.contains(document.activeElement)) return;
      // Skip if an inline input is active (rename / create)
      if (renamingPath !== null || creating !== null) return;

      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      switch (e.key.toLowerCase()) {
        case "c": {
          e.preventDefault();
          const paths =
            selectedPaths.size > 0 ? Array.from(selectedPaths) : focusedPath ? [focusedPath] : [];
          if (paths.length > 0) handleCopy(paths);
          break;
        }
        case "x": {
          e.preventDefault();
          const paths =
            selectedPaths.size > 0 ? Array.from(selectedPaths) : focusedPath ? [focusedPath] : [];
          if (paths.length > 0) handleCut(paths);
          break;
        }
        case "v": {
          e.preventDefault();
          if (!clipboardState) return;
          // Paste into: focused folder OR parent of focused file OR workspace root
          let targetDir = workspaceDir ?? "";
          if (focusedPath) {
            const node = flatNodes.find((n) => n.path === focusedPath);
            if (node?.isDir) {
              targetDir = focusedPath;
            } else if (node?.parentPath) {
              targetDir = node.parentPath;
            }
          } else if (selectedPaths.size === 1) {
            const [selPath] = Array.from(selectedPaths);
            const node = flatNodes.find((n) => n.path === selPath);
            if (node?.isDir) {
              targetDir = selPath;
            } else if (node?.parentPath) {
              targetDir = node.parentPath;
            }
          }
          void handlePaste(targetDir);
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    renamingPath,
    creating,
    selectedPaths,
    focusedPath,
    flatNodes,
    clipboardState,
    workspaceDir,
    handleCopy,
    handleCut,
    handlePaste,
  ]);

  // -------------------------------------------------------------------------
  // Render: no workspace
  // -------------------------------------------------------------------------

  if (!workspaceDir) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <FolderOpen className="size-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">Abrí una carpeta para ver tus diagramas</p>
        <Button size="sm" onClick={handleOpenWorkspace}>
          Abrir carpeta
        </Button>
      </div>
    );
  }

  const dirName = workspaceDir.split("/").pop() ?? workspaceDir;

  // When filter is active, merge filter-expanded paths so matched nodes are visible
  const effectiveExpandedPaths = filterExpandedPaths
    ? new Set([...expandedPaths, ...filterExpandedPaths])
    : expandedPaths;

  const isRootExpanded = effectiveExpandedPaths.has(workspaceDir);

  const sharedNodeProps = {
    expandedPaths: effectiveExpandedPaths,
    activeFilePath,
    renamingPath,
    creating,
    workspaceDir,
    selectedPaths,
    focusedPath,
    clipboardState,
    draggingPath: dnd.draggingPath,
    overFolderPath: dnd.overFolderPath,
    onToggle: handleToggle,
    onOpen: handleOpenFile,
    onDelete: handleDelete,
    onStartRename: setRenamingPath,
    onCommitRename: handleCommitRename,
    onCancelAction: handleCancelAction,
    onCopyPath: handleCopyPath,
    onCopyRelativePath: handleCopyRelativePath,
    onNewFile: handleNewFile,
    onNewFolder: handleNewFolder,
    onCommitCreate: handleCommitCreate,
    onCut: handleCut,
    onCopy: handleCopy,
    onPaste: handlePaste,
    onClick: handleClick,
    onBatchDelete: handleBatchDelete,
  };

  // -------------------------------------------------------------------------
  // Render: explorer
  // -------------------------------------------------------------------------

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={dnd.handleDragCancel}
    >
      <div
        ref={containerRef}
        className="flex flex-col h-full overflow-hidden"
        tabIndex={-1}
        onMouseDown={() => {
          // Clear selection when clicking empty space (panel background)
        }}
      >
        <ExplorerToolbar
          onNewFile={() => handleNewFile(workspaceDir)}
          onNewFolder={() => handleNewFolder(workspaceDir)}
          onRefresh={refresh}
          onCollapseAll={handleCollapseAll}
          filterQuery={filterQuery}
          onFilterChange={setFilterQuery}
          filterResultCount={filterResultCount}
        />

        <ExplorerBreadcrumb
          activeFilePath={activeFilePath}
          workspaceDir={workspaceDir}
          onExpandPaths={handleExpandPaths}
        />

        <ScrollArea className="flex-1">
          <div
            className="py-1"
            onClick={(e) => {
              // Clear selection when clicking empty space (not on a node button)
              if (e.target === e.currentTarget) {
                clearSelection();
                setFocusedPath(null);
              }
            }}
          >
            {/* Root workspace node */}
            <TooltipWrapper tooltip={workspaceDir} side="right">
              <button
                onClick={() => handleToggle(workspaceDir)}
                className="flex items-center gap-1 w-full text-left h-7 px-2 hover:bg-accent rounded text-foreground/90"
              >
                <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground/60">
                  {isRootExpanded ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                </span>
                <span className="truncate uppercase tracking-wide text-[10px] font-semibold">
                  {dirName}
                </span>
              </button>
            </TooltipWrapper>

            {/* Children of root */}
            {isRootExpanded && (
              <div>
                {creating?.parentPath === workspaceDir && (
                  <InlineInput
                    depth={1}
                    onCommit={(n) => handleCommitCreate(workspaceDir, n, creating.type)}
                    onCancel={handleCancelAction}
                  />
                )}
                {displayTree.length === 0 && !creating ? (
                  <p className={cn("text-xs text-muted-foreground text-center pt-4 px-4")}>
                    {filterQuery.trim()
                      ? `Sin resultados para "${filterQuery}"`
                      : "No hay archivos en esta carpeta"}
                  </p>
                ) : (
                  displayTree.map((entry) => (
                    <FileTreeNode key={entry.path} entry={entry} depth={1} {...sharedNodeProps} />
                  ))
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Phase 2: Quick Open Dialog */}
        <QuickOpenDialog
          open={quickOpenOpen}
          onClose={() => setQuickOpenOpen(false)}
          tree={tree}
          workspaceDir={workspaceDir}
          onOpenFile={handleOpenFile}
        />
      </div>
    </DndContext>
  );
};
