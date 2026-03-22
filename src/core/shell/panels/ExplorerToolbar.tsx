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
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
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
import { PanelSearch } from "@/shared/common/PanelSearch";
import type { SortOrder } from "./explorer-types";

// ---------------------------------------------------------------------------
// ExplorerToolbar — toolbar for the file explorer panel
// ---------------------------------------------------------------------------

interface ExplorerToolbarProps {
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
  filterQuery: string;
  onFilterChange: (query: string) => void;
  filterResultCount?: number;
  searchRef?: RefObject<HTMLInputElement | null>;
}

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
  searchRef,
}: ExplorerToolbarProps) => {
  const { t } = useTranslation("explorer");
  const sortOrder = useExplorerStore((s) => s.sortOrder);
  const setSortOrder = useExplorerStore((s) => s.setSortOrder);
  const showDotfiles = useExplorerStore((s) => s.showDotfiles);
  const setShowDotfiles = useExplorerStore((s) => s.setShowDotfiles);

  const sortLabels: Record<SortOrder, string> = {
    "type-first": t("sort.typeFirst"),
    "name-asc": t("sort.nameAsc"),
    "name-desc": t("sort.nameDesc"),
  };

  const SortIcon = SORT_ICONS[sortOrder];
  const isFiltering = filterQuery.length > 0;

  return (
    <div className="flex flex-col border-b border-border/50 shrink-0">
      {/* Action buttons row */}
      <div className="flex items-center justify-end px-2 py-1 gap-0.5">
        <TooltipWrapper tooltip={t("toolbar.newFile")} side="top">
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewFile}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        </TooltipWrapper>

        <TooltipWrapper tooltip={t("toolbar.newFolder")} side="top">
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewFolder}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <FolderPlus className="size-3.5" />
          </Button>
        </TooltipWrapper>

        <TooltipWrapper tooltip={t("toolbar.refresh")} side="top">
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </TooltipWrapper>

        <TooltipWrapper tooltip={t("toolbar.collapseAll")} side="top">
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
          <TooltipWrapper tooltip={`${t("toolbar.sortPrefix")}${sortLabels[sortOrder]}`} side="top">
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
              {t("sort.typeFirst")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setSortOrder("name-asc")}
              className={sortOrder === "name-asc" ? "text-primary" : undefined}
            >
              <ArrowUpAZ className="size-3.5" />
              {t("sort.nameAsc")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setSortOrder("name-desc")}
              className={sortOrder === "name-desc" ? "text-primary" : undefined}
            >
              <ArrowDownAZ className="size-3.5" />
              {t("sort.nameDesc")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Dotfiles toggle */}
        <TooltipWrapper
          tooltip={showDotfiles ? t("toolbar.hideDotfiles") : t("toolbar.showDotfiles")}
          side="top"
        >
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
      <div className="px-2 pb-1.5">
        <PanelSearch
          ref={searchRef}
          value={filterQuery}
          onChange={onFilterChange}
          placeholder={t("toolbar.filterPlaceholder")}
          resultCount={filterResultCount}
        />
      </div>
    </div>
  );
};
