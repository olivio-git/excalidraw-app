import { useState, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  FolderClosed,
  FilePlus2,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Scissors,
  Copy,
  ClipboardPaste,
  Pencil,
  Trash2,
  FolderSearch,
  Link,
  CornerDownRight,
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
  ContextMenuShortcut,
} from "@/shared/components/ui/context-menu";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import { tildify } from "@/shared/lib/path";
import { InlineInput } from "./InlineInput";
import { fileIconRegistry } from "./file-icon-registry";
import { fileHandlerRegistry } from "./file-handler-registry";
import { formatFileSize, formatDate } from "./explorer-utils";
import type { FileEntry, CreatingState, ClipboardState, DragData } from "./explorer-types";

export interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  expandedPaths: Set<string>;
  activeFilePath?: string;
  renamingPath: string | null;
  creating: CreatingState | null;
  workspaceDir: string;
  homeDir?: string;
  selectedPaths: Set<string>;
  focusedPath: string | null;
  clipboardState: ClipboardState;
  onToggle: (path: string) => void;
  onOpen: (path: string, name: string, beside?: boolean) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, newName: string) => Promise<void>;
  onCancelAction: () => void;
  onCopyPath: (path: string) => void;
  onCopyRelativePath: (path: string, workspaceDir: string) => void;
  onReveal: (path: string) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onCommitCreate: (parentPath: string, name: string, type: CreatingState["type"]) => Promise<void>;
  onCut: (paths: string[]) => void;
  onCopy: (paths: string[]) => void;
  onPaste: (targetDir: string) => void;
  onClick: (event: MouseEvent, path: string) => void;
  onContextSelect: (path: string) => void;
  onBatchDelete: (paths: string[]) => void;
  draggingPath: string | null;
  overFolderPath: string | null;
}

export const FileTreeNode = (props: FileTreeNodeProps) => {
  const {
    entry,
    depth,
    expandedPaths,
    activeFilePath,
    renamingPath,
    creating,
    workspaceDir,
    homeDir,
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
    onReveal,
    onNewFile,
    onNewFolder,
    onCommitCreate,
    onCut,
    onCopy,
    onPaste,
    onClick,
    onContextSelect,
    onBatchDelete,
    draggingPath,
    overFolderPath,
  } = props;
  const { t } = useTranslation("explorer");
  const expanded = expandedPaths.has(entry.path);
  const active = entry.path === activeFilePath;
  const renaming = entry.path === renamingPath;
  const selected = selectedPaths.has(entry.path);
  const focused = focusedPath === entry.path;
  const cut = clipboardState?.op === "cut" && clipboardState.paths.includes(entry.path);
  const paths = selected && selectedPaths.size > 1 ? [...selectedPaths] : [entry.path];
  const { icon: Icon, colorClass } = fileIconRegistry.resolve(entry.name);
  const hasHandler = !!fileHandlerRegistry.resolve(entry.name);
  const dragData: DragData = {
    type: "explorer-node",
    path: entry.path,
    isDir: entry.isDir,
    selectedPaths: paths,
  };
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: entry.path, data: dragData, disabled: renaming });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: entry.path,
    disabled: !entry.isDir,
  });
  const dropTarget = entry.isDir && (isOver || overFolderPath === entry.path);
  const padding = 8 + (depth - 1) * 16;
  const [details, setDetails] = useState("");
  const fetched = useRef(false);
  const loadDetails = async () => {
    if (fetched.current) return;
    fetched.current = true;
    try {
      const info = await stat(entry.path);
      setDetails(
        [
          entry.isDir ? t("tooltip.folder") : formatFileSize(info.size),
          info.mtime ? formatDate(info.mtime.getTime()) : "",
        ]
          .filter(Boolean)
          .join(" · ")
      );
    } catch {
      /* The path is still available when metadata cannot be read. */
    }
  };
  const label = `${homeDir ? tildify(entry.path, homeDir) : entry.path}${details ? `\n${details}` : ""}`;

  return (
    <div
      id={`explorer-${encodeURIComponent(entry.path)}`}
      role="treeitem"
      aria-label={entry.name}
      aria-level={depth}
      aria-expanded={entry.isDir ? expanded : undefined}
      aria-selected={selected}
      data-explorer-path={entry.path}
      data-focused={focused || undefined}
      tabIndex={-1}
      className="outline-none"
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={(node) => {
              setDragRef(node);
              setDropRef(node);
            }}
            {...attributes}
            {...listeners}
            role="presentation"
            tabIndex={-1}
            onContextMenu={() => onContextSelect(entry.path)}
            onMouseEnter={() => void loadDetails()}
            onMouseDown={(event) => {
              if (!renaming && event.button === 0) event.preventDefault();
            }}
            onClick={(event) => {
              if (renaming) return;
              onClick(event, entry.path);
              if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
                if (entry.isDir) onToggle(entry.path);
                else if (hasHandler) onOpen(entry.path, entry.name);
              }
            }}
            className={cn(
              "group/row relative flex min-h-7 w-full cursor-default items-center gap-1.5 border-l-2 border-transparent pr-2 text-[13px] select-none hover:bg-accent/70",
              selected && "bg-primary/10 text-foreground",
              active && "border-l-primary",
              focused && "outline-1 -outline-offset-1 outline-primary/50",
              !selected && !active && "text-foreground/80",
              (cut || isDragging || draggingPath === entry.path) && "opacity-45",
              dropTarget && "bg-primary/15 outline-1 -outline-offset-1 outline-primary"
            )}
            style={{ paddingLeft: padding }}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
              {entry.isDir &&
                (expanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                ))}
            </span>
            {entry.isDir ? (
              expanded ? (
                <FolderOpen className="size-4 shrink-0 text-amber-500" />
              ) : (
                <FolderClosed className="size-4 shrink-0 text-amber-500/80" />
              )
            ) : (
              <Icon className={cn("size-4 shrink-0", colorClass)} />
            )}
            {renaming ? (
              <InlineInput
                defaultValue={entry.name}
                depth={0}
                autoSelectBasename={!entry.isDir}
                onCommit={(name) => onCommitRename(entry.path, name)}
                onCancel={onCancelAction}
              />
            ) : (
              <TooltipWrapper
                tooltip={<span className="whitespace-pre-line">{label}</span>}
                side="right"
                delayDuration={700}
              >
                <span className={cn("min-w-0 flex-1 truncate", active && "font-medium")}>
                  {entry.name}
                </span>
              </TooltipWrapper>
            )}
            {entry.isDir && !renaming && (
              <span className="hidden shrink-0 items-center group-hover/row:flex group-focus-within/row:flex">
                <button
                  tabIndex={-1}
                  aria-label={t("nodeButton.newFile")}
                  title={t("nodeButton.newFile")}
                  className="rounded p-0.5 hover:bg-foreground/10"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewFile(entry.path);
                  }}
                >
                  <FilePlus2 className="size-3.5" />
                </button>
                <button
                  tabIndex={-1}
                  aria-label={t("nodeButton.newFolder")}
                  title={t("nodeButton.newFolder")}
                  className="rounded p-0.5 hover:bg-foreground/10"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewFolder(entry.path);
                  }}
                >
                  <FolderPlus className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-56">
          {entry.isDir ? (
            <>
              <ContextMenuItem onClick={() => onNewFile(entry.path)}>
                <FilePlus2 />
                {t("contextMenu.newFileHere")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onNewFolder(entry.path)}>
                <FolderPlus />
                {t("contextMenu.newFolderHere")}
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem disabled={!hasHandler} onClick={() => onOpen(entry.path, entry.name)}>
              <CornerDownRight />
              {t("contextMenu.open")}
              <ContextMenuShortcut>Enter</ContextMenuShortcut>
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => onReveal(entry.path)}>
            <FolderSearch />
            {t("contextMenu.reveal")}
          </ContextMenuItem>
          {!entry.isDir && (
            <ContextMenuItem
              disabled={!hasHandler}
              onClick={() => onOpen(entry.path, entry.name, true)}
            >
              <CornerDownRight />
              {t("contextMenu.openToSide")}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onCut(paths)}>
            <Scissors />
            {t("contextMenu.cut")}
            <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCopy(paths)}>
            <Copy />
            {t("contextMenu.copy")}
            <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
          </ContextMenuItem>
          {entry.isDir && (
            <ContextMenuItem disabled={!clipboardState} onClick={() => onPaste(entry.path)}>
              <ClipboardPaste />
              {t("contextMenu.paste")}
              <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onCopyPath(entry.path)}>
            <Link />
            {t("contextMenu.copyPath")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCopyRelativePath(entry.path, workspaceDir)}>
            <Link />
            {t("contextMenu.copyRelativePath")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={paths.length > 1} onClick={() => onStartRename(entry.path)}>
            <Pencil />
            {t("contextMenu.rename")}
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() =>
              paths.length > 1 ? onBatchDelete(paths) : onDelete(entry.path, entry.isDir)
            }
          >
            <Trash2 />
            {paths.length > 1
              ? t("contextMenu.deleteMultiple", { count: paths.length })
              : t("contextMenu.delete")}
            <ContextMenuShortcut>Del</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {entry.isDir && expanded && (
        <div role="group" className="relative">
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-border/60"
            style={{ left: padding + 9 }}
          />
          {creating?.parentPath === entry.path && (
            <InlineInput
              depth={depth + 1}
              onCommit={(name) => onCommitCreate(entry.path, name, creating.type)}
              onCancel={onCancelAction}
            />
          )}
          {entry.loadError && (
            <p
              role="status"
              className="py-1 pr-2 text-xs text-destructive"
              style={{ paddingLeft: padding + 24 }}
            >
              {t("panel.unreadableFolder")}
            </p>
          )}
          {entry.children?.map((child) => (
            <FileTreeNode key={child.path} {...props} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};
