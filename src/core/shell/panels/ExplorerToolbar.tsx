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
  X,
  Search,
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
  /** Inline search filter query */
  filterQuery: string;
  onFilterChange: (query: string) => void;
  /** Number of visible nodes when filter is active (undefined = not filtering) */
  filterResultCount?: number;
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
  filterQuery,
  onFilterChange,
  filterResultCount,
}: ExplorerToolbarProps) => {
  const sortOrder = useExplorerStore((s) => s.sortOrder);
  const setSortOrder = useExplorerStore((s) => s.setSortOrder);
  const showDotfiles = useExplorerStore((s) => s.showDotfiles);
  const setShowDotfiles = useExplorerStore((s) => s.setShowDotfiles);

  const SortIcon = SORT_ICONS[sortOrder];
  const isFiltering = filterQuery.length > 0;

  return (
    <div className="flex flex-col border-b border-border/50 shrink-0">
      {/* Action buttons row */}
      <div className="flex items-center justify-end px-2 py-1 gap-0.5">
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

      {/* Inline search row */}
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <Search className="size-3 text-muted-foreground shrink-0" />
        <input
          value={filterQuery}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filtrar archivos..."
          className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
        />
        {isFiltering && (
          <>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {filterResultCount ?? 0}
            </span>
            <button
              onClick={() => onFilterChange("")}
              className="size-3.5 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
              title="Limpiar filtro"
            >
              <X className="size-2.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
