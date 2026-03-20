import { useState, useRef } from "react";
import {
  FolderOpen,
  FolderClosed,
  Plus,
  FolderPlus,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { stat } from "@tauri-apps/plugin-fs";
import { cn } from "@/shared/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { InlineInput } from "./InlineInput";
import { fileIconRegistry } from "./file-icon-registry";
import { fileHandlerRegistry } from "./file-handler-registry";
import { formatFileSize, formatDate } from "./explorer-utils";
import type { FileEntry, CreatingState, ClipboardState, DragData } from "./explorer-types";

// ---------------------------------------------------------------------------
// FileTreeNode — recursive component representing a single file or folder row
// DnD wrappers (useSortable) will be added in Phase 1, task 1.1.
// ---------------------------------------------------------------------------

export interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  expandedPaths: Set<string>;
  activeFilePath?: string;
  renamingPath: string | null;
  creating: CreatingState | null;
  workspaceDir: string;

  // New Phase 0 props — optional until wired in 0.8
  selectedPaths?: Set<string>;
  focusedPath?: string | null;
  clipboardState?: ClipboardState;
  nodeRefs?: Map<string, HTMLElement>;

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

  // Phase 1 callbacks — optional stubs until wired
  onCut?: (paths: string[]) => void;
  onCopy?: (paths: string[]) => void;
  onPaste?: (targetDir: string) => void;
  onClick?: (e: React.MouseEvent, path: string) => void;
  onBatchDelete?: (paths: string[]) => void;

  // DnD state from useDragAndDrop
  draggingPath?: string | null;
  overFolderPath?: string | null;
}

export const FileTreeNode = ({
  entry,
  depth,
  expandedPaths,
  activeFilePath,
  renamingPath,
  creating,
  workspaceDir,
  selectedPaths,
  focusedPath,
  clipboardState,
  nodeRefs: _nodeRefs,
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
  onCut,
  onCopy,
  onPaste,
  onClick,
  onBatchDelete,
  draggingPath,
  overFolderPath,
}: FileTreeNodeProps) => {
  const pl = 8 + depth * 25;
  const isExpanded = expandedPaths.has(entry.path);
  const isActive = !entry.isDir && entry.path === activeFilePath;
  const isRenaming = renamingPath === entry.path;
  const showCreatingHere = entry.isDir && isExpanded && creating?.parentPath === entry.path;
  const isSelected = selectedPaths?.has(entry.path) ?? false;
  const isFocused = focusedPath === entry.path;
  const isCut = clipboardState?.op === "cut" && clipboardState.paths.includes(entry.path);
  const hasPasteableClipboard = clipboardState !== null;

  const { icon: FileIcon, colorClass } = fileIconRegistry.resolve(entry.name);
  const hasHandler = fileHandlerRegistry.resolve(entry.name) !== null;

  // Effective selectedPaths for multi-select operations
  const effectiveSelectedPaths =
    selectedPaths && selectedPaths.has(entry.path) && selectedPaths.size > 1
      ? Array.from(selectedPaths)
      : [entry.path];

  const multiSelectCount = selectedPaths?.size ?? 0;
  const isMultiSelected = isSelected && multiSelectCount > 1;

  // ---------------------------------------------------------------------------
  // DnD: draggable (all nodes) + droppable (folders only)
  // ---------------------------------------------------------------------------

  const dragData: DragData = {
    type: "explorer-node",
    path: entry.path,
    isDir: entry.isDir,
    selectedPaths: selectedPaths ? Array.from(selectedPaths) : [entry.path],
  };

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({
    id: entry.path,
    data: dragData,
  });

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: entry.path,
    disabled: !entry.isDir,
  });

  // isDragging from hook vs external draggingPath (for opacity on non-active draggable items)
  const isDraggedItem = draggingPath === entry.path || isDragging;
  // isDropTarget: folder is hovered by drag, or is tracked in overFolderPath
  const isDropTarget = entry.isDir && (isOver || overFolderPath === entry.path);

  const sharedChildProps: Omit<FileTreeNodeProps, "entry" | "depth"> = {
    expandedPaths,
    activeFilePath,
    renamingPath,
    creating,
    workspaceDir,
    selectedPaths,
    focusedPath,
    clipboardState,
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
    onCut,
    onCopy,
    onPaste,
    onClick,
    onBatchDelete,
    draggingPath,
    overFolderPath,
  };

  // The guide line x aligns with the center of THIS folder's chevron
  const guideX = pl + 7; // paddingLeft + half of size-3.5 (14px)

  // ---------------------------------------------------------------------------
  // Task 3.3 — File info tooltip: lazy stat fetch on hover, cached in ref
  // ---------------------------------------------------------------------------

  const statCache = useRef<{ size: number; mtime: number | null } | null>(null);
  const [tooltipContent, setTooltipContent] = useState<string | null>(null);

  const handleMouseEnter = async () => {
    if (tooltipContent !== null) return; // already fetched

    if (statCache.current !== null) {
      // Already cached but tooltip not built yet (race guard)
      const { size, mtime } = statCache.current;
      const sizePart = entry.isDir ? "Carpeta" : formatFileSize(size);
      const mtimePart = mtime !== null ? formatDate(mtime) : null;
      setTooltipContent(mtimePart ? `${sizePart} · ${mtimePart}` : sizePart);
      return;
    }

    try {
      const info = await stat(entry.path);
      const size = info.size ?? 0;
      // Tauri v2 plugin-fs stat returns mtime as Date | null
      const mtime =
        info.mtime instanceof Date
          ? info.mtime.getTime()
          : typeof info.mtime === "number"
            ? info.mtime
            : null;
      statCache.current = { size, mtime };
      const sizePart = entry.isDir ? "Carpeta" : formatFileSize(size);
      const mtimePart = mtime !== null ? formatDate(mtime) : null;
      setTooltipContent(mtimePart ? `${sizePart} · ${mtimePart}` : sizePart);
    } catch {
      // stat failed (e.g. permissions) — show name only, don't retry
      statCache.current = { size: 0, mtime: null };
      setTooltipContent(entry.name);
    }
  };

  const tooltipLabel = tooltipContent ? `${entry.name}\n${tooltipContent}` : entry.name;

  if (entry.isDir) {
    return (
      <div ref={setDroppableRef}>
        {/* Folder row */}
        <div className="relative group/row">
          <ContextMenu>
            <ContextMenuTrigger>
              <TooltipWrapper
                tooltip={<span className="whitespace-pre-line">{tooltipLabel}</span>}
                side="right"
                delayDuration={600}
              >
                <button
                  ref={setDraggableRef}
                  {...listeners}
                  {...attributes}
                  onMouseEnter={() => {
                    void handleMouseEnter();
                  }}
                  onClick={(e) => {
                    onClick?.(e, entry.path);
                    onToggle(entry.path);
                  }}
                  className={cn(
                    "flex items-center gap-1 w-full text-left h-7 pr-1 rounded text-foreground/80 text-xs",
                    "hover:bg-accent",
                    isSelected && "bg-accent",
                    isFocused && !isSelected && "ring-1 ring-border ring-inset",
                    isCut && "opacity-50",
                    isDraggedItem && "opacity-50",
                    isDropTarget && "ring-1 ring-border ring-inset bg-primary/10"
                  )}
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
              </TooltipWrapper>
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
              {onCut && (
                <ContextMenuItem onClick={() => onCut(effectiveSelectedPaths)}>
                  Cortar
                </ContextMenuItem>
              )}
              {onCopy && (
                <ContextMenuItem onClick={() => onCopy(effectiveSelectedPaths)}>
                  Copiar
                </ContextMenuItem>
              )}
              {onPaste && hasPasteableClipboard && (
                <ContextMenuItem onClick={() => onPaste(entry.path)}>Pegar aquí</ContextMenuItem>
              )}
              {(onCut || onCopy) && <ContextMenuSeparator />}
              <ContextMenuItem onClick={() => onCopyPath(entry.path)}>Copiar ruta</ContextMenuItem>
              <ContextMenuItem onClick={() => onCopyRelativePath(entry.path, workspaceDir)}>
                Copiar ruta relativa
              </ContextMenuItem>
              <ContextMenuSeparator />
              {isMultiSelected && onBatchDelete ? (
                <ContextMenuItem
                  onClick={() => onBatchDelete(effectiveSelectedPaths)}
                  className="text-destructive focus:text-destructive"
                >
                  Eliminar {multiSelectCount} elementos
                </ContextMenuItem>
              ) : (
                <ContextMenuItem
                  onClick={() => onDelete(entry.path, true)}
                  className="text-destructive focus:text-destructive"
                >
                  Eliminar carpeta
                </ContextMenuItem>
              )}
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
              <FileTreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                {...sharedChildProps}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // File node
  // ---------------------------------------------------------------------------
  return (
    <div className="relative" ref={setDraggableRef} {...listeners} {...attributes}>
      <ContextMenu>
        <ContextMenuTrigger>
          <TooltipWrapper
            tooltip={<span className="whitespace-pre-line">{tooltipLabel}</span>}
            side="right"
            delayDuration={600}
          >
            <button
              onMouseEnter={() => {
                void handleMouseEnter();
              }}
              onClick={(e) => {
                onClick?.(e, entry.path);
                if (!onClick) {
                  if (hasHandler) onOpen(entry.path, entry.name);
                } else {
                  // If onClick handled selection, only open on plain click (no modifiers)
                  if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    if (hasHandler) onOpen(entry.path, entry.name);
                  }
                }
              }}
              disabled={!hasHandler}
              title={!hasHandler ? "No hay visor registrado para este tipo de archivo" : undefined}
              className={cn(
                "flex items-center gap-1.5 w-full text-left h-7 pr-2 rounded text-xs",
                !hasHandler ? "opacity-40 cursor-default" : "hover:bg-accent",
                !hasHandler
                  ? ""
                  : isSelected
                    ? isActive
                      ? "text-primary font-medium"
                      : "text-primary"
                    : isActive
                      ? "text-primary font-medium"
                      : "text-foreground/70",
                isSelected && "bg-accent",
                isFocused && !isSelected && "ring-1 ring-border ring-inset",
                isCut && "opacity-50",
                isDraggedItem && "opacity-50"
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
          </TooltipWrapper>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onOpen(entry.path, entry.name)}>Abrir</ContextMenuItem>
          <ContextMenuItem onClick={() => onStartRename(entry.path)}>Renombrar</ContextMenuItem>
          <ContextMenuSeparator />
          {onCut && (
            <ContextMenuItem onClick={() => onCut(effectiveSelectedPaths)}>Cortar</ContextMenuItem>
          )}
          {onCopy && (
            <ContextMenuItem onClick={() => onCopy(effectiveSelectedPaths)}>Copiar</ContextMenuItem>
          )}
          {(onCut || onCopy) && <ContextMenuSeparator />}
          <ContextMenuItem onClick={() => onCopyPath(entry.path)}>Copiar ruta</ContextMenuItem>
          <ContextMenuItem onClick={() => onCopyRelativePath(entry.path, workspaceDir)}>
            Copiar ruta relativa
          </ContextMenuItem>
          <ContextMenuSeparator />
          {isMultiSelected && onBatchDelete ? (
            <ContextMenuItem
              onClick={() => onBatchDelete(effectiveSelectedPaths)}
              className="text-destructive focus:text-destructive"
            >
              Eliminar {multiSelectCount} elementos
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              onClick={() => onDelete(entry.path, false)}
              className="text-destructive focus:text-destructive"
            >
              Eliminar
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
};
