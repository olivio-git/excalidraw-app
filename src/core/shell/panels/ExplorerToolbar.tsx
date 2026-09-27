import {
  FilePlus2,
  RefreshCw,
  FoldVertical,
  FolderPlus,
  ArrowUpAZ,
  ArrowDownAZ,
  Layers,
  Eye,
  MoreHorizontal,
  LocateFixed,
  FolderOpen,
  Search,
  Check,
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

interface ExplorerToolbarProps {
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
  onRevealActive: () => void;
  onOpenWorkspace: () => void;
  onQuickOpen: () => void;
  canRevealActive: boolean;
  loading: boolean;
  filterQuery: string;
  onFilterChange: (query: string) => void;
  filterResultCount?: number;
  searchRef?: RefObject<HTMLInputElement | null>;
}

export const ExplorerToolbar = ({ searchRef, ...props }: ExplorerToolbarProps) => {
  const { t } = useTranslation("explorer");
  const sortOrder = useExplorerStore((s) => s.sortOrder);
  const setSortOrder = useExplorerStore((s) => s.setSortOrder);
  const showDotfiles = useExplorerStore((s) => s.showDotfiles);
  const setShowDotfiles = useExplorerStore((s) => s.setShowDotfiles);
  const sortOptions = [
    { value: "type-first", label: t("sort.typeFirst"), icon: Layers },
    { value: "name-asc", label: t("sort.nameAsc"), icon: ArrowUpAZ },
    { value: "name-desc", label: t("sort.nameDesc"), icon: ArrowDownAZ },
  ] satisfies { value: SortOrder; label: string; icon: typeof Layers }[];
  const actions = [
    { label: t("toolbar.newFile"), icon: FilePlus2, run: props.onNewFile },
    { label: t("toolbar.newFolder"), icon: FolderPlus, run: props.onNewFolder },
    {
      label: t("toolbar.refresh"),
      icon: RefreshCw,
      run: props.onRefresh,
      disabled: props.loading,
      spin: props.loading,
    },
    { label: t("toolbar.collapseAll"), icon: FoldVertical, run: props.onCollapseAll },
    {
      label: t("toolbar.revealActive"),
      icon: LocateFixed,
      run: props.onRevealActive,
      disabled: !props.canRevealActive,
    },
  ];
  return (
    <div className="shrink-0 border-b border-border/60 pb-2">
      <div className="flex min-h-10 items-center justify-between gap-1 px-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("toolbar.files")}
        </span>
        <div className="flex shrink-0 items-center">
          {actions.map(({ label, icon: Icon, run, disabled, spin }) => (
            <TooltipWrapper key={label} tooltip={label} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                aria-label={label}
                disabled={disabled}
                onClick={run}
                className="size-6 rounded-sm text-muted-foreground hover:text-foreground"
              >
                <Icon className={cn("size-3.5", spin && "animate-spin")} />
              </Button>
            </TooltipWrapper>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground"
                aria-label={t("toolbar.more")}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={props.onQuickOpen}>
                <Search />
                {t("quickOpen.dialogTitle")}
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+P</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={props.onOpenWorkspace}>
                <FolderOpen />
                {t("panel.openFolder")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {sortOptions.map(({ value, label, icon: Icon }) => (
                <DropdownMenuItem key={value} onClick={() => setSortOrder(value)}>
                  <Icon />
                  {label}
                  {sortOrder === value && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowDotfiles(!showDotfiles)}>
                <Eye />
                {t("toolbar.showDotfiles")}
                {showDotfiles && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="px-2">
        <PanelSearch
          ref={searchRef}
          value={props.filterQuery}
          onChange={props.onFilterChange}
          placeholder={t("toolbar.filterPlaceholder")}
          resultCount={props.filterResultCount}
        />
      </div>
    </div>
  );
};
