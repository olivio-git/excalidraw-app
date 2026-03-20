import React, { useState, useCallback, useEffect, useRef, useMemo, startTransition } from "react";
import { readDir, rename, remove, mkdir } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import {
  FolderOpen,
  FolderClosed,
  Plus,
  RefreshCw,
  ChevronsUpDown,
  FolderPlus,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useFileWatcher } from "@/core/shell/useFileWatcher";
import { fileIconRegistry } from "./file-icon-registry";
import { fileHandlerRegistry } from "./file-handler-registry";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
}

interface CreatingState {
  parentPath: string;
  type: "file" | "folder";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildTree = async (dir: string): Promise<FileEntry[]> => {
  const entries = await readDir(dir);
  const result: FileEntry[] = [];

  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith(".")) continue;
    const fullPath = await join(dir, entry.name);

    if (entry.isDirectory) {
      const children = await buildTree(fullPath);
      result.push({ name: entry.name, path: fullPath, isDir: true, children });
    } else {
      result.push({ name: entry.name, path: fullPath, isDir: false });
    }
  }

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
// InlineInput — used for both create and rename
// ---------------------------------------------------------------------------

const InlineInput = ({
  defaultValue = "",
  depth,
  onCommit,
  onCancel,
}: {
  defaultValue?: string;
  depth: number;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const dot = defaultValue.lastIndexOf(".");
    if (dot > 0) {
      ref.current?.setSelectionRange(0, dot);
    } else {
      ref.current?.select();
    }
  }, [defaultValue]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed) onCommit(trimmed);
    else onCancel();
  };

  return (
    <div className="py-0.5 pr-2" style={{ paddingLeft: 8 + depth * 12 }}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={commit}
        className="w-full h-6 px-1.5 text-xs bg-background border border-ring rounded outline-none"
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// FileNode
// ---------------------------------------------------------------------------

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  expandedPaths: Set<string>;
  activeFilePath?: string;
  renamingPath: string | null;
  creating: CreatingState | null;
  workspaceDir: string;
  onToggle: (path: string) => void;
  onOpen: (path: string, name: string) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, newName: string) => void;
  onCancelAction: () => void;
  onCopyPath: (path: string) => void;
  onCopyRelativePath: (path: string, workspaceDir: string) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onCommitCreate: (parentPath: string, name: string, type: "file" | "folder") => void;
}

const FileNode = ({
  entry,
  depth,
  expandedPaths,
  activeFilePath,
  renamingPath,
  creating,
  workspaceDir,
  onToggle,
  onOpen,
  onDelete,
  onStartRename,
  onCommitRename,
  onCancelAction,
  onCopyPath,
  onCopyRelativePath,
  onNewFile,
  onNewFolder,
  onCommitCreate,
}: FileNodeProps) => {
  const pl = 8 + depth * 12;
  const isExpanded = expandedPaths.has(entry.path);
  const isActive = !entry.isDir && entry.path === activeFilePath;
  const isRenaming = renamingPath === entry.path;
  const showCreatingHere = entry.isDir && isExpanded && creating?.parentPath === entry.path;

  const { icon: FileIcon, colorClass } = fileIconRegistry.resolve(entry.name);
  const hasHandler = fileHandlerRegistry.resolve(entry.name) !== null;

  const sharedChildProps = {
    expandedPaths,
    activeFilePath,
    renamingPath,
    creating,
    workspaceDir,
    onToggle,
    onOpen,
    onDelete,
    onStartRename,
    onCommitRename,
    onCancelAction,
    onCopyPath,
    onCopyRelativePath,
    onNewFile,
    onNewFolder,
    onCommitCreate,
  };

  // The guide line x for the children of THIS folder:
  // aligns with the center of THIS folder's chevron
  const guideX = pl + 7; // paddingLeft + half of size-3.5 (14px)

  if (entry.isDir) {
    return (
      <div>
        {/* Folder row */}
        <div className="relative group/row">
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button
                onClick={() => onToggle(entry.path)}
                className="flex items-center gap-1 w-full text-left h-7 pr-1 rounded hover:bg-accent text-foreground/80 text-xs"
                style={{ paddingLeft: pl }}
              >
                <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground/60">
                  {isExpanded ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                </span>
                {isExpanded ? (
                  <FolderOpen className="size-3.5 shrink-0 text-amber-400/90" />
                ) : (
                  <FolderClosed className="size-3.5 shrink-0 text-amber-500/80" />
                )}
                {isRenaming ? (
                  <InlineInput
                    defaultValue={entry.name}
                    depth={0}
                    onCommit={(n) => onCommitRename(entry.path, n)}
                    onCancel={onCancelAction}
                  />
                ) : (
                  <span className="truncate flex-1 min-w-0">{entry.name}</span>
                )}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onNewFile(entry.path)}>
                Nuevo archivo aquí
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onNewFolder(entry.path)}>
                Nueva carpeta aquí
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onStartRename(entry.path)}>Renombrar</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onCopyPath(entry.path)}>Copiar ruta</ContextMenuItem>
              <ContextMenuItem onClick={() => onCopyRelativePath(entry.path, workspaceDir)}>
                Copiar ruta relativa
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => onDelete(entry.path, true)}
                className="text-destructive focus:text-destructive"
              >
                Eliminar carpeta
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          {/* Hover action buttons */}
          {!isRenaming && (
            <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover/row:flex items-center gap-px bg-accent rounded px-0.5 z-10">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNewFile(entry.path);
                }}
                className="size-4 flex items-center justify-center rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                title="Nuevo archivo"
              >
                <Plus className="size-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNewFolder(entry.path);
                }}
                className="size-4 flex items-center justify-center rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                title="Nueva carpeta"
              >
                <FolderPlus className="size-3" />
              </button>
            </div>
          )}
        </div>

        {/* Expanded children — single continuous guide line */}
        {isExpanded && (
          <div className="relative">
            <div
              style={{
                position: "absolute",
                left: guideX,
                top: 0,
                bottom: 0,
                width: 1,
                backgroundColor: "rgba(128,128,128,0.35)",
                pointerEvents: "none",
              }}
            />
            {showCreatingHere && (
              <InlineInput
                depth={depth + 1}
                onCommit={(n) => onCommitCreate(entry.path, n, creating!.type)}
                onCancel={onCancelAction}
              />
            )}
            {entry.children?.map((child) => (
              <FileNode key={child.path} entry={child} depth={depth + 1} {...sharedChildProps} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  return (
    <div className="relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => hasHandler && onOpen(entry.path, entry.name)}
            disabled={!hasHandler}
            title={!hasHandler ? "No hay visor registrado para este tipo de archivo" : undefined}
            className={cn(
              "flex items-center gap-1.5 w-full text-left h-7 pr-2 rounded text-xs",
              !hasHandler
                ? "opacity-40 cursor-default"
                : isActive
                  ? "text-primary font-medium hover:bg-accent/50"
                  : "hover:bg-accent/50 text-foreground/90"
            )}
            style={{ paddingLeft: pl }}
            data-active={isActive}
          >
            <FileIcon className={cn("size-3.5 shrink-0", colorClass)} />
            {isRenaming ? (
              <InlineInput
                defaultValue={entry.name}
                depth={0}
                onCommit={(n) => onCommitRename(entry.path, n)}
                onCancel={onCancelAction}
              />
            ) : (
              <span className="truncate">
                {fileHandlerRegistry.resolveOrDefault(entry.name).displayName?.(entry.name) ??
                  entry.name}
              </span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onOpen(entry.path, entry.name)}>Abrir</ContextMenuItem>
          <ContextMenuItem onClick={() => onStartRename(entry.path)}>Renombrar</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onCopyPath(entry.path)}>Copiar ruta</ContextMenuItem>
          <ContextMenuItem onClick={() => onCopyRelativePath(entry.path, workspaceDir)}>
            Copiar ruta relativa
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => onDelete(entry.path, false)}
            className="text-destructive focus:text-destructive"
          >
            Eliminar
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ExplorerPanel
// ---------------------------------------------------------------------------

export const ExplorerPanel = () => {
  const workspaceDir = useWorkspaceStore((s) => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore((s) => s.setWorkspaceDir);
  const addTab = useTabStore((s) => s.addTab);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const updateTab = useTabStore((s) => s.updateTab);

  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(workspaceDir ? [workspaceDir] : [])
  );
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingState | null>(null);

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
    const entries = await buildTree(workspaceDir);
    setTree(entries);
  }, [workspaceDir]);

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
  // Rename
  // -------------------------------------------------------------------------

  const handleCommitRename = useCallback(
    async (oldPath: string, newName: string) => {
      setRenamingPath(null);
      const dir = oldPath.substring(0, oldPath.lastIndexOf("/"));
      const oldExt = oldPath.split(".").pop() ?? "";
      const resolvedName = newName.includes(".") ? newName : `${newName}.${oldExt}`;
      const newPath = await join(dir, resolvedName);
      await rename(oldPath, newPath);

      tabs.forEach((tab) => {
        if (tab.metadata?.filePath === oldPath) {
          const handler = fileHandlerRegistry.resolveOrDefault(resolvedName);
          const title = handler.displayName ? handler.displayName(resolvedName) : resolvedName;
          updateTab(tab.id, {
            title,
            instanceId: newPath,
            metadata: { ...tab.metadata, filePath: newPath },
          });
        }
      });

      await refresh();
    },
    [tabs, updateTab, refresh]
  );

  // -------------------------------------------------------------------------
  // Delete
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

  // -------------------------------------------------------------------------
  // Render: explorer
  // -------------------------------------------------------------------------

  const sharedNodeProps = {
    expandedPaths,
    activeFilePath,
    renamingPath,
    creating,
    workspaceDir,
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-end px-2 py-1 border-b border-border/50 shrink-0 gap-0.5">
        <TooltipWrapper tooltip="Nuevo archivo" side="top">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleNewFile(workspaceDir)}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        </TooltipWrapper>
        <TooltipWrapper tooltip="Nueva carpeta" side="top">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleNewFolder(workspaceDir)}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <FolderPlus className="size-3.5" />
          </Button>
        </TooltipWrapper>
        <TooltipWrapper tooltip="Refrescar" side="top">
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </TooltipWrapper>
        <TooltipWrapper tooltip="Colapsar todo" side="top">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCollapseAll}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <ChevronsUpDown className="size-3.5" />
          </Button>
        </TooltipWrapper>
      </div>

      {/* File tree */}
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
              {tree.length === 0 && !creating ? (
                <p className="text-xs text-muted-foreground text-center pt-4 px-4">
                  No hay archivos en esta carpeta
                </p>
              ) : (
                tree.map((entry) => (
                  <FileNode key={entry.path} entry={entry} depth={1} {...sharedNodeProps} />
                ))
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
