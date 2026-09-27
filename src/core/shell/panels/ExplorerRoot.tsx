import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FilePlus2,
  FolderPlus,
  ClipboardPaste,
  RefreshCw,
  FolderSearch,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { cn } from "@/shared/lib/utils";

interface ExplorerRootProps {
  path: string;
  expanded: boolean;
  canPaste: boolean;
  onToggle: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onPaste: () => void;
  onRefresh: () => void;
  onReveal: () => void;
  children: ReactNode;
}

export const ExplorerRoot = (props: ExplorerRootProps) => {
  const { t } = useTranslation("explorer");
  const { setNodeRef, isOver } = useDroppable({ id: props.path });
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="min-h-full pb-8">
          <button
            ref={setNodeRef}
            onClick={props.onToggle}
            aria-expanded={props.expanded}
            title={props.path}
            className={cn(
              "sticky top-0 z-10 flex h-8 w-full items-center gap-1.5 border-y border-border/30 bg-background px-2 text-left hover:bg-accent",
              isOver && "bg-primary/15 ring-1 ring-inset ring-primary"
            )}
          >
            {props.expanded ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )}
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide">
              {props.path.split(/[\\/]/).filter(Boolean).pop() ?? props.path}
            </span>
          </button>
          {props.children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        <ContextMenuItem onClick={props.onNewFile}>
          <FilePlus2 />
          {t("contextMenu.newFileHere")}
        </ContextMenuItem>
        <ContextMenuItem onClick={props.onNewFolder}>
          <FolderPlus />
          {t("contextMenu.newFolderHere")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!props.canPaste} onClick={props.onPaste}>
          <ClipboardPaste />
          {t("contextMenu.paste")}
        </ContextMenuItem>
        <ContextMenuItem onClick={props.onRefresh}>
          <RefreshCw />
          {t("toolbar.refresh")}
        </ContextMenuItem>
        <ContextMenuItem onClick={props.onReveal}>
          <FolderSearch />
          {t("contextMenu.reveal")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
