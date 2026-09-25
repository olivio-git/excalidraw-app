import { useState, useEffect, useMemo, startTransition, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { readDir, mkdir, remove, exists, lstat, writeTextFile } from "@tauri-apps/plugin-fs";
import { rename } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { join, dirname } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toRelativePath } from "@/shared/lib/path";
import { useHomeDir } from "@/shared/hooks/useHomeDir";
import { FolderOpen, FolderClosed, File, LoaderCircle, SearchX, AlertCircle } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useExplorerStore, useExplorerUiStore } from "@/stores/explorerStore";
import { useFileWatcher } from "@/core/shell/useFileWatcher";
import { fileHandlerRegistry } from "./file-handler-registry";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { ExplorerToolbar } from "./ExplorerToolbar";
import { ExplorerBreadcrumb } from "./ExplorerBreadcrumb";
import { ExplorerRoot } from "./ExplorerRoot";
import { FileTreeNode } from "./FileTreeNode";
import { InlineInput } from "./InlineInput";
import { QuickOpenDialog } from "./QuickOpenDialog";
import { PluginManager } from "@/plugins/plugin-manager";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { updateTabsAfterRename, closeTabsForDeletedPath } from "./explorer-tab-sync";
import {
  sortTree,
  flattenVisible,
  flattenAll,
  filterTree,
  getFilteredExpandedPaths,
} from "./explorer-utils";
import { isSameOrDescendant, topLevelPaths } from "./explorer-file-operations";
import { useDragAndDrop } from "@/core/shell/hooks/useDragAndDrop";
import { useMultiSelect } from "@/core/shell/hooks/useMultiSelect";
import { useExplorerSelectionStore } from "@/stores/explorerStore";
import { useKeyboardNav } from "@/core/shell/hooks/useKeyboardNav";
import { useFileClipboard } from "@/core/shell/hooks/useFileClipboard";
import type { FileEntry, CreatingState, DragData } from "./explorer-types";
import { openFileInWorkbench } from "../services/file-navigation";
import { prepareResourceMove } from "@/core/tabs/tab-lifecycle";

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

    if (entry.isDirectory && !entry.isSymlink) {
      try {
        const children = await buildTree(fullPath, showDotfiles);
        result.push({ name: entry.name, path: fullPath, isDir: true, children });
      } catch (error) {
        result.push({
          name: entry.name,
          path: fullPath,
          isDir: true,
          children: [],
          loadError: String(error),
        });
      }
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
  if (!isSameOrDescendant(filePath, workspaceDir)) return [];
  const relative = filePath.slice(workspaceDir.length);
  const separator = workspaceDir.includes("\\") ? "\\" : "/";
  const parts = relative.split(/[\\/]/).filter(Boolean);
  const ancestors: string[] = [];
  let current = workspaceDir;
  for (let i = 0; i < parts.length - 1; i++) {
    current = `${current}${current.endsWith(separator) ? "" : separator}${parts[i]}`;
    ancestors.push(current);
  }
  return ancestors;
};

// ---------------------------------------------------------------------------
// ExplorerPanel — container component
// All async Tauri calls live here. Presentational children receive callbacks.
// ---------------------------------------------------------------------------

export const ExplorerPanel = () => {
  const workspaceDir = useWorkspaceStore((s) => s.workspaceDir);
  return <ExplorerWorkspacePanel key={workspaceDir ?? "empty"} />;
};

const ExplorerWorkspacePanel = () => {
  const { t } = useTranslation("explorer");
  // --- Store subscriptions ---
  const workspaceDir = useWorkspaceStore((s) => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore((s) => s.setWorkspaceDir);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const sortOrder = useExplorerStore((s) => s.sortOrder);
  const showDotfiles = useExplorerStore((s) => s.showDotfiles);

  // --- Tree state ---
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(workspaceDir ? [workspaceDir] : [])
  );
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const homeDirPath = useHomeDir();

  // --- Phase 1: selection + focus ---
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  // --- Phase 2: inline filter ---
  const [filterQuery, setFilterQuery] = useState("");

  // --- Phase 2: quick open ---
  const quickOpenOpen = useExplorerUiStore((state) => state.quickOpenOpen);
  const setQuickOpenOpen = useExplorerUiStore((state) => state.setQuickOpenOpen);

  // --- Ref for keyboard nav focus detection ---
  const containerRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

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
    const paths = getFilteredExpandedPaths(sortedTree, filterQuery);
    if (workspaceDir) paths.add(workspaceDir);
    return paths;
  }, [sortedTree, filterQuery, workspaceDir]);

  // --- Flat nodes for keyboard nav + multi-select range ---
  const flatNodes = useMemo(() => {
    // When filtering, use filter-expanded paths so all matching nodes are visible
    const effectiveExpanded = filterExpandedPaths
      ? new Set([...expandedPaths, ...filterExpandedPaths])
      : expandedPaths;
    if (!workspaceDir || !effectiveExpanded.has(workspaceDir)) return [];
    return flattenVisible(displayTree, effectiveExpanded, 1, workspaceDir);
  }, [displayTree, expandedPaths, filterExpandedPaths, workspaceDir]);

  const activeFilePath = useMemo(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    return tab?.metadata?.filePath as string | undefined;
  }, [tabs, activeTabId]);

  // -------------------------------------------------------------------------
  // Tree loading
  // -------------------------------------------------------------------------

  const refresh = useCallback(async () => {
    if (!workspaceDir) return;
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const entries = await buildTree(workspaceDir, showDotfiles);
      if (version !== loadVersion.current) return;
      setTree(entries);
      setLoadError(null);
      const paths = new Set(flattenAll(entries).map((entry) => entry.path));
      setSelectedPaths((previous) => new Set([...previous].filter((path) => paths.has(path))));
      setFocusedPath((previous) => (previous && paths.has(previous) ? previous : null));
    } catch (error) {
      if (version === loadVersion.current) setLoadError(String(error));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [workspaceDir, showDotfiles, setSelectedPaths]);

  useEffect(() => {
    const version = loadVersion;
    startTransition(() => {
      void refresh();
    });
    return () => {
      version.current++;
    };
  }, [refresh]);
  useFileWatcher(workspaceDir, refresh);

  // -------------------------------------------------------------------------
  // Auto-expand folders to reveal the active file
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!activeFilePath || !workspaceDir) return;
    const ancestors = getAncestorPaths(activeFilePath, workspaceDir);
    if (!isSameOrDescendant(activeFilePath, workspaceDir)) return;
    startTransition(() => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add(workspaceDir);
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
  // Resolve best target folder for toolbar create buttons
  // Prefers: focused folder > focused file's parent > single selected folder >
  //          single selected file's parent > workspace root
  // -------------------------------------------------------------------------

  const getCreateTarget = useCallback(() => {
    if (focusedPath) {
      const node = flatNodes.find((n) => n.path === focusedPath);
      if (node?.isDir) return focusedPath;
      return node?.parentPath ?? workspaceDir ?? "";
    }
    if (selectedPaths.size === 1) {
      const [p] = Array.from(selectedPaths);
      const node = flatNodes.find((n) => n.path === p);
      if (node?.isDir) return p;
      return node?.parentPath ?? workspaceDir ?? "";
    }
    return workspaceDir ?? "";
  }, [focusedPath, selectedPaths, flatNodes, workspaceDir]);

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

  const handleCollapseAll = () => {
    setFilterQuery("");
    setExpandedPaths(new Set(workspaceDir ? [workspaceDir] : []));
    clearSelection();
    setFocusedPath(null);
    treeRef.current?.focus();
  };

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

  const handleOpenFile = useCallback((filePath: string, _name: string, beside = false) => {
    openFileInWorkbench(filePath, { beside });
  }, []);

  // -------------------------------------------------------------------------
  // Create new file / folder
  // -------------------------------------------------------------------------

  const handleNewFile = useCallback(
    (parentPath: string) => {
      if (!parentPath || !workspaceDir) return;
      setFilterQuery("");
      setRenamingPath(null);
      setExpandedPaths(
        (prev) =>
          new Set([
            ...prev,
            workspaceDir,
            ...getAncestorPaths(parentPath, workspaceDir),
            parentPath,
          ])
      );
      setCreating({ parentPath, type: "file" });
    },
    [workspaceDir]
  );

  const handleNewFolder = useCallback(
    (parentPath: string) => {
      if (!parentPath || !workspaceDir) return;
      setFilterQuery("");
      setRenamingPath(null);
      setExpandedPaths(
        (prev) =>
          new Set([
            ...prev,
            workspaceDir,
            ...getAncestorPaths(parentPath, workspaceDir),
            parentPath,
          ])
      );
      setCreating({ parentPath, type: "folder" });
    },
    [workspaceDir]
  );

  const handleCommitCreate = useCallback(
    async (parentPath: string, name: string, type: "file" | "folder") => {
      const handler = name.includes(".")
        ? fileHandlerRegistry.resolve(name)
        : fileHandlerRegistry.getDefault();
      const finalName =
        type === "file" && !name.includes(".") ? `${name}.${handler!.defaultExtension}` : name;
      let targetPath = await join(parentPath, finalName);
      if (await exists(targetPath)) throw new Error(t("input.exists", { name: finalName }));
      if (type === "folder") {
        await mkdir(targetPath);
      } else {
        if (handler) targetPath = await handler.create(parentPath, finalName);
        else await writeTextFile(targetPath, "", { createNew: true });
      }
      setCreating(null);
      if (type === "file" && handler) handleOpenFile(targetPath, finalName);
      await refresh();
      setSelectedPaths(new Set([targetPath]));
      setFocusedPath(targetPath);
      treeRef.current?.focus();
    },
    [refresh, handleOpenFile, t, setSelectedPaths]
  );

  // -------------------------------------------------------------------------
  // Rename — uses explorer-tab-sync instead of inline tab iteration
  // -------------------------------------------------------------------------

  const handleCommitRename = useCallback(
    async (oldPath: string, newName: string) => {
      const dir = await dirname(oldPath);
      const newPath = await join(dir, newName);
      if (newPath === oldPath) {
        setRenamingPath(null);
        return;
      }
      if (await exists(newPath)) throw new Error(t("input.exists", { name: newName }));
      await prepareResourceMove(oldPath);
      await rename(oldPath, newPath);
      updateTabsAfterRename(oldPath, newPath);
      setRenamingPath(null);
      setExpandedPaths(
        (previous) =>
          new Set(
            [...previous].map((path) =>
              isSameOrDescendant(path, oldPath) ? newPath + path.slice(oldPath.length) : path
            )
          )
      );
      await refresh();
      setSelectedPaths(new Set([newPath]));
      setFocusedPath(newPath);
      treeRef.current?.focus();
    },
    [refresh, t, setSelectedPaths]
  );

  // -------------------------------------------------------------------------
  // Delete — uses explorer-tab-sync instead of inline tab iteration
  // -------------------------------------------------------------------------

  const handleDelete = useCallback(
    async (filePath: string, isDir: boolean) => {
      const name = filePath.split("/").pop() ?? filePath;
      const ok = await confirm({
        title: isDir ? t("panel.deleteFolderTitle") : t("panel.deleteFileTitle"),
        description: t("panel.deleteDescription", { name }),
        confirmLabel: t("panel.deleteLabel"),
        variant: "destructive",
      });
      if (!ok) return;
      try {
        await remove(filePath, { recursive: isDir });
        closeTabsForDeletedPath(filePath);
        clearSelection();
        setFocusedPath(null);
        notify(t("panel.deletedSuccess", { name }), { type: "success" });
      } catch (error) {
        notify(t("panel.errorDeleting", { name, message: String(error) }), { type: "error" });
      }
      await refresh();
    },
    [refresh, t, clearSelection]
  );

  // -------------------------------------------------------------------------
  // Task 1.5 — Batch delete
  // -------------------------------------------------------------------------

  const handleBatchDelete = useCallback(
    async (paths: string[]) => {
      paths = topLevelPaths(paths);
      if (paths.length === 0) return;

      const names = paths.map((p) => p.split("/").pop() ?? p);
      const listPreview = names
        .slice(0, 5)
        .map((n) => `• ${n}`)
        .join("\n");
      const extra = paths.length > 5 ? t("panel.batchDeleteMore", { count: paths.length - 5 }) : "";

      const ok = await confirm({
        title: t("panel.batchDeleteTitle", { count: paths.length }),
        description: t("panel.batchDeleteDescription", { preview: `${listPreview}${extra}` }),
        confirmLabel: t("panel.batchDeleteLabel"),
        variant: "destructive",
      });
      if (!ok) return;

      let deleted = 0;
      for (const filePath of paths) {
        try {
          // Read the native type even if the selected entry is currently collapsed.
          const info = await lstat(filePath);
          await remove(filePath, { recursive: info.isDirectory && !info.isSymlink });
          closeTabsForDeletedPath(filePath);
          deleted++;
        } catch (err) {
          const name = filePath.split("/").pop() ?? filePath;
          const msg = err instanceof Error ? err.message : String(err);
          notify(t("panel.errorDeleting", { name, message: msg }), { type: "error" });
        }
      }

      clearSelection();
      setFocusedPath(null);
      if (deleted) notify(t("panel.batchDeletedSuccess", { count: deleted }), { type: "success" });
      await refresh();
    },
    [refresh, clearSelection, t]
  );

  // -------------------------------------------------------------------------
  // Copy path
  // -------------------------------------------------------------------------

  const handleCopyPath = useCallback(
    (path: string) => {
      void navigator.clipboard
        .writeText(path)
        .catch((error: unknown) =>
          notify(t("panel.operationError", { message: String(error) }), { type: "error" })
        );
    },
    [t]
  );

  const handleCopyRelativePath = useCallback(
    (path: string, wsDir: string) => {
      handleCopyPath(toRelativePath(path, wsDir));
    },
    [handleCopyPath]
  );

  // -------------------------------------------------------------------------
  // Cancel any pending action
  // -------------------------------------------------------------------------

  const handleCancelAction = useCallback(() => {
    setRenamingPath(null);
    setCreating(null);
    treeRef.current?.focus();
  }, []);

  // -------------------------------------------------------------------------
  // Clipboard — useFileClipboard hook
  // -------------------------------------------------------------------------

  const {
    clipboardState,
    cut: handleCut,
    copy: handleCopy,
    paste: handlePaste,
    clear: clearClipboard,
  } = useFileClipboard(refresh);

  // -------------------------------------------------------------------------
  // Phase 1 — Click handler (multi-select)
  // -------------------------------------------------------------------------

  const handleClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      treeRef.current?.focus();
      handleNodeClick(e, path, flatNodes, focusedPath, setFocusedPath);
    },
    [handleNodeClick, flatNodes, focusedPath]
  );

  // -------------------------------------------------------------------------
  // Phase 1 — Keyboard nav hook
  // -------------------------------------------------------------------------

  useKeyboardNav(
    treeRef,
    {
      flatNodes,
      expandedPaths: filterExpandedPaths
        ? new Set([...expandedPaths, ...filterExpandedPaths])
        : expandedPaths,
      onOpen: handleOpenFile,
      onStartRename: setRenamingPath,
      onDelete: handleDelete,
      onBatchDelete: handleBatchDelete,
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

  useEffect(() => {
    if (!dnd.overFolderPath) return;
    const path = dnd.overFolderPath;
    const timer = setTimeout(
      () => setExpandedPaths((previous) => new Set(previous).add(path)),
      650
    );
    return () => clearTimeout(timer);
  }, [dnd.overFolderPath]);

  useEffect(() => {
    if (!focusedPath) return;
    const node = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>("[data-explorer-path]") ?? []
    ).find((item) => item.dataset.explorerPath === focusedPath);
    node?.scrollIntoView?.({ block: "nearest" });
  }, [focusedPath, flatNodes]);

  const handleDragStart = (event: DragStartEvent) => {
    dnd.handleDragStart(event);
    // If the dragged item is not in the current selection, clear and select it
    const data = event.active.data.current as DragData | undefined;
    if (data && !selectedPaths.has(data.path)) {
      setSelectedPaths(new Set([data.path]));
      setFocusedPath(data.path);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = (event.over?.id as string | null) ?? null;
    dnd.handleDragOver(overId);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    await dnd.handleDragEnd(event, refresh);
    clearSelection();
    setFocusedPath(null);
  };

  // -------------------------------------------------------------------------
  // Escape key to cancel (global — existing behavior preserved)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        containerRef.current?.contains(document.activeElement) &&
        !(e.target instanceof HTMLInputElement)
      ) {
        handleCancelAction();
        clearClipboard();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCancelAction, clearClipboard]);

  // -------------------------------------------------------------------------
  // explorerFocus context key — drives the ctrl+n keybinding split
  // -------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onFocusIn = () => contextKeyService.set("explorerFocus", true);
    const onFocusOut = (e: FocusEvent) => {
      if (!container.contains(e.relatedTarget as Node | null)) {
        contextKeyService.set("explorerFocus", false);
      }
    };

    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    return () => {
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      contextKeyService.set("explorerFocus", false);
    };
  }, []);

  // -------------------------------------------------------------------------
  // explorer.action.newFile — ctrl+n when explorerFocus
  // -------------------------------------------------------------------------

  const getCreateTargetRef = useRef(getCreateTarget);
  useEffect(() => {
    getCreateTargetRef.current = getCreateTarget;
  }, [getCreateTarget]);

  const handleNewFileRef = useRef(handleNewFile);
  useEffect(() => {
    handleNewFileRef.current = handleNewFile;
  }, [handleNewFile]);

  useEffect(() => {
    PluginManager.registerCommandHandler("explorer.action.newFile", () => {
      handleNewFileRef.current(getCreateTargetRef.current());
    });
    return () => {
      PluginManager.unregisterCommandHandler("explorer.action.newFile");
    };
  }, []);

  // -------------------------------------------------------------------------
  // MCP bridge — toggle_folder event
  // Receives explorer:toggle-folder { folderPath, expand? } and delegates to
  // handleToggle (or explicit expand/collapse).
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: Event) => {
      const { folderPath, expand } = (e as CustomEvent<{ folderPath: string; expand?: boolean }>)
        .detail;
      if (expand === undefined) {
        handleToggle(folderPath);
      } else {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          if (expand) next.add(folderPath);
          else next.delete(folderPath);
          return next;
        });
      }
    };
    window.addEventListener("explorer:toggle-folder", handler);
    return () => window.removeEventListener("explorer:toggle-folder", handler);
  }, [handleToggle]);

  // -------------------------------------------------------------------------
  // MCP bridge — set_selected_files event
  // Receives explorer:set-selection { paths } and syncs local Set state +
  // external store.
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: Event) => {
      const { paths } = (e as CustomEvent<{ paths: string[] }>).detail;
      const next = new Set<string>(paths);
      setSelectedPaths(next);
      // Also sync focused path to first item for keyboard nav coherence
      if (paths.length > 0) setFocusedPath(paths[0]);
      else setFocusedPath(null);
      // Keep external store in sync (setSelectedPaths already calls syncToStore
      // via the wrapped setter in useMultiSelect, but store may also be set
      // directly by the MCP handler — this ensures the local state matches)
      useExplorerSelectionStore.getState().setSelectedPaths(paths);
    };
    window.addEventListener("explorer:set-selection", handler);
    return () => window.removeEventListener("explorer:set-selection", handler);
  }, [setSelectedPaths]);

  // -------------------------------------------------------------------------
  // Phase 2 — Clipboard keyboard shortcuts (gated on explorer focus)
  // -------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: KeyboardEvent) => {
      // Gate: only when explorer panel has focus
      if (!container.contains(document.activeElement)) return;
      if (e.defaultPrevented) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, [contenteditable='true']")
      )
        return;
      // Skip if an inline input is active (rename / create)
      if (renamingPath !== null || creating !== null) return;

      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

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
        <p className="text-sm font-medium">{t("panel.emptyTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("panel.emptyDescription")}</p>
        <Button size="sm" onClick={handleOpenWorkspace}>
          {t("panel.openFolder")}
        </Button>
      </div>
    );
  }

  // When filter is active, merge filter-expanded paths so matched nodes are visible
  const effectiveExpandedPaths = filterExpandedPaths
    ? new Set([...expandedPaths, ...filterExpandedPaths])
    : expandedPaths;

  const isRootExpanded = effectiveExpandedPaths.has(workspaceDir);
  const handleReveal = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (error) {
      notify(t("panel.operationError", { message: String(error) }), { type: "error" });
    }
  };
  const handleRevealActive = () => {
    if (!activeFilePath) return;
    if (
      activeFilePath
        .slice(workspaceDir.length)
        .split(/[\\/]/)
        .some((part) => part.startsWith("."))
    ) {
      useExplorerStore.getState().setShowDotfiles(true);
    }
    setFilterQuery("");
    handleExpandPaths([workspaceDir, ...getAncestorPaths(activeFilePath, workspaceDir)]);
    setSelectedPaths(new Set([activeFilePath]));
    setFocusedPath(activeFilePath);
    treeRef.current?.focus();
  };

  const sharedNodeProps = {
    expandedPaths: effectiveExpandedPaths,
    activeFilePath,
    renamingPath,
    creating,
    workspaceDir,
    homeDir: homeDirPath,
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
    onReveal: handleReveal,
    onContextSelect: (path: string) => {
      if (!selectedPaths.has(path)) setSelectedPaths(new Set([path]));
      setFocusedPath(path);
    },
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
      collisionDetection={(args) =>
        args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args)
      }
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={dnd.handleDragCancel}
    >
      <div
        ref={containerRef}
        className="flex flex-col h-full overflow-hidden focus:outline-none"
        tabIndex={-1}
      >
        <ExplorerToolbar
          onNewFile={() => handleNewFile(getCreateTarget())}
          onNewFolder={() => handleNewFolder(getCreateTarget())}
          onRefresh={refresh}
          onCollapseAll={handleCollapseAll}
          onRevealActive={handleRevealActive}
          onOpenWorkspace={handleOpenWorkspace}
          onQuickOpen={() => setQuickOpenOpen(true)}
          canRevealActive={!!activeFilePath && isSameOrDescendant(activeFilePath, workspaceDir)}
          loading={loading}
          filterQuery={filterQuery}
          onFilterChange={(query) => {
            setFilterQuery(query);
            clearSelection();
            setFocusedPath(null);
          }}
          filterResultCount={filterResultCount}
          searchRef={searchRef}
        />

        <ExplorerBreadcrumb
          activeFilePath={activeFilePath}
          workspaceDir={workspaceDir}
          onExpandPaths={handleExpandPaths}
        />

        <ScrollArea className="min-h-0 flex-1">
          <ExplorerRoot
            path={workspaceDir}
            expanded={isRootExpanded}
            canPaste={!!clipboardState}
            onToggle={() => {
              handleToggle(workspaceDir);
              clearSelection();
              setFocusedPath(null);
            }}
            onNewFile={() => handleNewFile(workspaceDir)}
            onNewFolder={() => handleNewFolder(workspaceDir)}
            onPaste={() => void handlePaste(workspaceDir)}
            onRefresh={refresh}
            onReveal={() => void handleReveal(workspaceDir)}
          >
            <div
              ref={treeRef}
              role="tree"
              aria-label={t("toolbar.files")}
              aria-multiselectable="true"
              aria-busy={loading}
              aria-activedescendant={
                focusedPath && flatNodes.some((node) => node.path === focusedPath)
                  ? `explorer-${encodeURIComponent(focusedPath)}`
                  : undefined
              }
              tabIndex={0}
              className="min-h-24 outline-none"
              onClick={(event) => {
                if (
                  !(event.target instanceof HTMLElement) ||
                  event.target.closest("[data-explorer-path], input, button")
                )
                  return;
                clearSelection();
                setFocusedPath(null);
                treeRef.current?.focus();
              }}
            >
              {isRootExpanded && (
                <div>
                  {creating?.parentPath === workspaceDir && (
                    <InlineInput
                      depth={1}
                      onCommit={(n) => handleCommitCreate(workspaceDir, n, creating.type)}
                      onCancel={handleCancelAction}
                    />
                  )}
                  {loadError ? (
                    <div
                      role="alert"
                      className="flex flex-col items-center gap-2 px-4 py-6 text-center text-xs"
                    >
                      <AlertCircle className="size-5 text-destructive" />
                      <p>{t("panel.loadFailed")}</p>
                      <p className="max-w-full break-words text-muted-foreground">{loadError}</p>
                      <Button size="sm" variant="outline" onClick={refresh}>
                        {t("toolbar.refresh")}
                      </Button>
                    </div>
                  ) : loading && tree.length === 0 ? (
                    <div
                      role="status"
                      className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground"
                    >
                      <LoaderCircle className="size-4 animate-spin" />
                      {t("panel.loading")}
                    </div>
                  ) : displayTree.length === 0 && !creating ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground">
                      {filterQuery.trim() ? (
                        <SearchX className="size-6 opacity-50" />
                      ) : (
                        <FolderOpen className="size-6 opacity-50" />
                      )}
                      <p>
                        {filterQuery.trim()
                          ? t("panel.noFilterResults", { query: filterQuery })
                          : t("panel.noFilesInFolder")}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          filterQuery.trim() ? setFilterQuery("") : handleNewFile(workspaceDir)
                        }
                      >
                        {filterQuery.trim() ? t("panel.clearFilter") : t("toolbar.newFile")}
                      </Button>
                    </div>
                  ) : (
                    displayTree.map((entry) => (
                      <FileTreeNode key={entry.path} entry={entry} depth={1} {...sharedNodeProps} />
                    ))
                  )}
                </div>
              )}
            </div>
          </ExplorerRoot>
        </ScrollArea>
        <div
          role="status"
          className="flex h-7 shrink-0 items-center justify-between border-t border-border/50 px-3 text-[10px] text-muted-foreground"
        >
          <span>
            {selectedPaths.size
              ? t("panel.selectedCount", { count: selectedPaths.size })
              : t("panel.fileCount", {
                  count: flattenAll(tree).filter((node) => !node.isDir).length,
                })}
          </span>
          <button
            className="hover:text-foreground"
            onClick={() => setQuickOpenOpen(true)}
            title={t("quickOpen.dialogTitle")}
          >
            Ctrl+P
          </button>
        </div>

        {/* Phase 2: Quick Open Dialog */}
        <QuickOpenDialog
          open={quickOpenOpen}
          onClose={() => setQuickOpenOpen(false)}
          tree={tree}
          workspaceDir={workspaceDir}
          onOpenFile={handleOpenFile}
        />
      </div>

      {/* DragOverlay: file/folder name pill that follows the cursor while dragging */}
      <DragOverlay dropAnimation={null}>
        {dnd.draggingPath
          ? (() => {
              const draggingEntry = flatNodes.find((n) => n.path === dnd.draggingPath);
              const dragCount =
                selectedPaths.size > 1 && dnd.draggingPath && selectedPaths.has(dnd.draggingPath)
                  ? selectedPaths.size
                  : 1;
              return (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-background border border-border rounded-md shadow-lg text-xs pointer-events-none select-none opacity-95">
                  {draggingEntry?.isDir ? (
                    <FolderClosed className="size-3.5 shrink-0 text-amber-500/80" />
                  ) : (
                    <File className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="max-w-[200px] truncate text-foreground/90">
                    {dragCount > 1
                      ? t("panel.itemCount", { count: dragCount })
                      : (draggingEntry?.name ?? dnd.draggingPath?.split("/").pop() ?? "")}
                  </span>
                </div>
              );
            })()
          : null}
      </DragOverlay>
    </DndContext>
  );
};
