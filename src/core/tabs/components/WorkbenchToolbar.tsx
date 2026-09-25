import { ArrowLeft, ArrowRight, Columns2, Rows2, PanelLeftClose } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { useTabStore } from "../store/tab-store";
import type { SplitDirection } from "../types";

export function WorkbenchToolbar() {
  const { t } = useTranslation("tabs");
  const tabs = useTabStore((state) => state.tabs);
  const activeId = useTabStore((state) => state.activeTabId);
  const group = useTabStore((state) => state.activeGroupId);
  const navigation = useTabStore((state) => state.navigation);
  const direction = useTabStore((state) => state.splitDirection);
  const history = navigation[group];
  const split = (next: SplitDirection) => {
    const state = useTabStore.getState();
    state.setSplitDirection(next);
    if (!direction && activeId && tabs.length > 1) state.openToSide(activeId);
  };
  return (
    <div className="flex h-9 min-w-0 items-center gap-1" data-tauri-drag-region>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={t("workbench.back")}
        aria-label={t("workbench.back")}
        disabled={history.index <= 0}
        onClick={() => useTabStore.getState().navigateHistory(-1)}
      >
        <ArrowLeft className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={t("workbench.forward")}
        aria-label={t("workbench.forward")}
        disabled={history.index >= history.entries.length - 1}
        onClick={() => useTabStore.getState().navigateHistory(1)}
      >
        <ArrowRight className="size-4" />
      </Button>
      <span
        className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground"
        data-tauri-drag-region
      >
        {tabs.find((tab) => tab.id === activeId)?.title ?? t("workbench.workspace")}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={t("workbench.splitRight")}
        aria-label={t("workbench.splitRight")}
        aria-pressed={direction === "horizontal"}
        onClick={() => split("horizontal")}
      >
        <Columns2 className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={t("workbench.splitDown")}
        aria-label={t("workbench.splitDown")}
        aria-pressed={direction === "vertical"}
        onClick={() => split("vertical")}
      >
        <Rows2 className="size-4" />
      </Button>
      {direction && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={t("workbench.merge")}
          aria-label={t("workbench.merge")}
          onClick={() => useTabStore.getState().setSplitDirection(null)}
        >
          <PanelLeftClose className="size-4" />
        </Button>
      )}
    </div>
  );
}
