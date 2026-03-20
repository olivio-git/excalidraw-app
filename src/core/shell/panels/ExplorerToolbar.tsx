import {
  Plus,
  RefreshCw,
  ChevronsUpDown,
  FolderPlus,
  ArrowUpAZ,
  ArrowDownAZ,
  Layers,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { TooltipWrapper } from "@/shared/common/TooltipWrapper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { useExplorerStore } from "@/stores/explorerStore";
import type { SortOrder } from "./explorer-types";

// ---------------------------------------------------------------------------
// ExplorerToolbar — toolbar for the file explorer panel
// ---------------------------------------------------------------------------

interface ExplorerToolbarProps {
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
}

const SORT_LABELS: Record<SortOrder, string> = {
  "type-first": "Tipo primero",
  "name-asc": "Nombre A→Z",
  "name-desc": "Nombre Z→A",
};

const SORT_ICONS: Record<SortOrder, React.ComponentType<{ className?: string }>> = {
  "type-first": Layers,
  "name-asc": ArrowUpAZ,
  "name-desc": ArrowDownAZ,
};

export const ExplorerToolbar = ({
  onNewFile,
  onNewFolder,
  onRefresh,
  onCollapseAll,
}: ExplorerToolbarProps) => {
  const sortOrder = useExplorerStore((s) => s.sortOrder);
  const setSortOrder = useExplorerStore((s) => s.setSortOrder);
  const showDotfiles = useExplorerStore((s) => s.showDotfiles);
  const setShowDotfiles = useExplorerStore((s) => s.setShowDotfiles);

  const SortIcon = SORT_ICONS[sortOrder];

  return (
    <div className="flex items-center justify-end px-2 py-1 border-b border-border/50 shrink-0 gap-0.5">
      <TooltipWrapper tooltip="Nuevo archivo" side="top">
        <Button
          variant="ghost"
          size="icon"
          onClick={onNewFile}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </Button>
      </TooltipWrapper>

      <TooltipWrapper tooltip="Nueva carpeta" side="top">
        <Button
          variant="ghost"
          size="icon"
          onClick={onNewFolder}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <FolderPlus className="size-3.5" />
        </Button>
      </TooltipWrapper>

      <TooltipWrapper tooltip="Refrescar" side="top">
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </TooltipWrapper>

      <TooltipWrapper tooltip="Colapsar todo" side="top">
        <Button
          variant="ghost"
          size="icon"
          onClick={onCollapseAll}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <ChevronsUpDown className="size-3.5" />
        </Button>
      </TooltipWrapper>

      {/* Sort order dropdown */}
      <DropdownMenu>
        <TooltipWrapper tooltip={`Ordenar: ${SORT_LABELS[sortOrder]}`} side="top">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <SortIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipWrapper>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => setSortOrder("type-first")}
            className={sortOrder === "type-first" ? "text-primary" : undefined}
          >
            <Layers className="size-3.5" />
            Tipo primero
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setSortOrder("name-asc")}
            className={sortOrder === "name-asc" ? "text-primary" : undefined}
          >
            <ArrowUpAZ className="size-3.5" />
            Nombre A→Z
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setSortOrder("name-desc")}
            className={sortOrder === "name-desc" ? "text-primary" : undefined}
          >
            <ArrowDownAZ className="size-3.5" />
            Nombre Z→A
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dotfiles toggle */}
      <TooltipWrapper tooltip={showDotfiles ? "Ocultar dotfiles" : "Mostrar dotfiles"} side="top">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowDotfiles(!showDotfiles)}
          className={cn(
            "size-6 hover:text-foreground",
            showDotfiles ? "text-primary" : "text-muted-foreground"
          )}
        >
          {showDotfiles ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </Button>
      </TooltipWrapper>
    </div>
  );
};
