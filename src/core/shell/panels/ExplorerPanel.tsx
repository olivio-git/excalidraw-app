import { useState, useCallback, useEffect, useMemo, startTransition } from "react";
import { readDir, mkdir } from "@tauri-apps/plugin-fs";
import { rename, remove } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { FolderOpen } from "lucide-react";
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
import { FileTreeNode } from "./FileTreeNode";
import { InlineInput } from "./InlineInput";
import { updateTabsAfterRename, closeTabsForDeletedPath } from "./explorer-tab-sync";
import { sortTree } from "./explorer-utils";
import type { FileEntry, CreatingState, ClipboardState } from "./explorer-types";
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

  // --- Phase 0: new local state (wired in Phase 1) ---
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [clipboardState, setClipboardState] = useState<ClipboardState>(null);
  const [searchQuery] = useState<string>("");

  // --- Derived: sorted + filtered display tree ---
  const displayTree = useMemo(() => {
    return sortTree(tree, sortOrder);
  }, [tree, sortOrder]);

  // Suppress searchQuery unused warning — will be used in Phase 2
  void searchQuery;

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
  // Keyboard: Escape to cancel
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancelAction();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCancelAction]);

  // -------------------------------------------------------------------------
  // Placeholder handlers for Phase 1 (wired in task 1.4)
  // These allow FileTreeNode to render clipboard menu items when provided
  // -------------------------------------------------------------------------

  const handleCut = useCallback((paths: string[]) => {
    setClipboardState({ op: "cut", paths });
  }, []);

  const handleCopy = useCallback((paths: string[]) => {
    setClipboardState({ op: "copy", paths });
  }, []);

  // Suppress setFocusedPath + setSelectedPaths unused warning — used in Phase 1
  void setFocusedPath;
  void setSelectedPaths;
  void handleCut;
  void handleCopy;
  void clipboardState;

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
  const isRootExpanded = expandedPaths.has(workspaceDir);

  const sharedNodeProps = {
    expandedPaths,
    activeFilePath,
    renamingPath,
    creating,
    workspaceDir,
    selectedPaths,
    focusedPath,
    clipboardState,
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
  };

  // -------------------------------------------------------------------------
  // Render: explorer
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ExplorerToolbar
        onNewFile={() => handleNewFile(workspaceDir)}
        onNewFolder={() => handleNewFolder(workspaceDir)}
        onRefresh={refresh}
        onCollapseAll={handleCollapseAll}
      />

      <ScrollArea className="flex-1">
        <div className="py-1">
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
                  No hay archivos en esta carpeta
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
    </div>
  );
};
