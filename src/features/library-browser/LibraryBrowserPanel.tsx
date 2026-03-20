import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { fetch } from "@tauri-apps/plugin-http";
import { loadLibraryFromBlob } from "@excalidraw/excalidraw";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/shared/components/ui/button";
import { PanelSearch } from "@/shared/common/PanelSearch";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { DiagramController } from "@/core/diagram/DiagramController";
import { fetchLibraries } from "./library-browser.service";
import { LibraryCard } from "./LibraryCard";
import type { ExcalidrawLibraryEntry, InstallStatus } from "./types";
import { INSTALL_STATUS } from "./types";

// ─── Virtual row types ────────────────────────────────────────────────────────

type VirtualRow =
  | { type: "header"; title: string }
  | { type: "items"; libs: ExcalidrawLibraryEntry[] }
  | { type: "empty" };

// Row height constants (must match card CSS):
//   h-24(96) + content(p-2×2 + name + gap-2 + button h-8)(71) + border(2) = 169
//   Row gap is handled by pb-2 on the grid div = 8px → total 177
const CARD_ROW_HEIGHT = 177;
const HEADER_HEIGHT = 28;
const EMPTY_HEIGHT = 56;
const H_PADDING = 12; // px-3 → 12px each side

// ─── Panel ────────────────────────────────────────────────────────────────────

export const LibraryBrowserPanel = memo(function LibraryBrowserPanel() {
  const [libraries, setLibraries] = useState<ExcalidrawLibraryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<Record<string, InstallStatus>>({});
  const [columns, setColumns] = useState(1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const addTab = useTabStore((s) => s.addTab);
  const setActiveTab = useTabStore((s) => s.setActiveTab);

  const activeInstanceId = (() => {
    if (!activeTabId) return undefined;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.routeId !== "diagram") return undefined;
    return tab.instanceId;
  })();

  const hasDiagramActive = !!activeInstanceId && !!DiagramController.getApi(activeInstanceId);

  // ── ResizeObserver → columns ──────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      // subtract px-3 padding (H_PADDING × 2) to get inner grid width
      const innerWidth = entry.contentRect.width - H_PADDING * 2;
      setColumns(innerWidth >= 220 ? 2 : 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Catalog ───────────────────────────────────────────────────────────────
  async function loadCatalog() {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const data = await fetchLibraries();
      setLibraries(data);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Failed to load libraries");
    } finally {
      setLoadingCatalog(false);
    }
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  const handleInstall = useCallback(
    async function handleInstall(library: ExcalidrawLibraryEntry) {
      setInstallStatus((prev) => ({ ...prev, [library.source]: INSTALL_STATUS.LOADING }));
      try {
        const res = await fetch(library.source);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const items = await loadLibraryFromBlob(blob);
        const api = activeInstanceId ? DiagramController.getApi(activeInstanceId) : undefined;
        if (!api) throw new Error("No active diagram");
        await api.updateLibrary({ libraryItems: items, merge: true, openLibraryMenu: true });
        setInstallStatus((prev) => ({ ...prev, [library.source]: INSTALL_STATUS.INSTALLED }));
      } catch (err) {
        console.error("[LibraryBrowser] Install failed:", err);
        setInstallStatus((prev) => ({ ...prev, [library.source]: INSTALL_STATUS.ERROR }));
      }
    },
    [activeInstanceId]
  );

  const handleViewMore = useCallback(
    (library: ExcalidrawLibraryEntry) => {
      const existing = tabs.find(
        (t) => t.routeId === "library-detail" && t.instanceId === library.source
      );
      if (existing) {
        setActiveTab(existing.id);
        return;
      }
      addTab({
        routeId: "library-detail",
        path: "/library-detail",
        title: library.name,
        instanceId: library.source,
        metadata: { library },
      });
    },
    [tabs, addTab, setActiveTab]
  );

  // ── Build virtual rows ────────────────────────────────────────────────────
  const rows = useMemo<VirtualRow[]>(() => {
    const lowerQuery = query.toLowerCase();
    const filtered = libraries.filter(
      (lib) => !lowerQuery || lib.name.toLowerCase().includes(lowerQuery)
    );

    const installed = filtered.filter(
      (lib) => installStatus[lib.source] === INSTALL_STATUS.INSTALLED
    );
    const browse = filtered.filter((lib) => installStatus[lib.source] !== INSTALL_STATUS.INSTALLED);

    const result: VirtualRow[] = [];

    if (installed.length > 0) {
      result.push({ type: "header", title: "Installed" });
      for (let i = 0; i < installed.length; i += columns) {
        result.push({ type: "items", libs: installed.slice(i, i + columns) });
      }
      result.push({ type: "header", title: "Browse" });
    }

    if (browse.length === 0) {
      result.push({ type: "empty" });
    } else {
      for (let i = 0; i < browse.length; i += columns) {
        result.push({ type: "items", libs: browse.slice(i, i + columns) });
      }
    }

    return result;
  }, [libraries, query, installStatus, columns]);

  // ── Virtualizer ───────────────────────────────────────────────────────────
  // paddingStart/End handle the py-2 spacing without causing overflow —
  // absolute-positioned items offset from padding-edge, so manual py on
  // the container div would make getTotalSize() undercount by that padding.
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const row = rows[i];
      if (!row || row.type === "header") return HEADER_HEIGHT;
      if (row.type === "empty") return EMPTY_HEIGHT;
      return CARD_ROW_HEIGHT;
    },
    paddingStart: 8,
    paddingEnd: 8,
    overscan: 4,
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center px-3 py-2 border-b border-border shrink-0">
        <span className="text-sm font-medium">Libraries</span>
      </div>

      {!hasDiagramActive && !loadingCatalog && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border shrink-0">
          Open a diagram to add libraries
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2 shrink-0">
        <PanelSearch
          ref={searchRef}
          value={query}
          onChange={setQuery}
          placeholder="Search libraries…"
        />
      </div>

      {/* Scroll container — also observed for width to derive columns */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {/* Loading skeletons */}
        {loadingCatalog && (
          <div className={`px-3 py-2 grid gap-2 ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col rounded-lg border border-border bg-card overflow-hidden"
              >
                <Skeleton className="h-24 w-full rounded-none" />
                <div className="flex flex-col gap-2 p-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-7 w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {catalogError && (
          <div className="flex flex-col items-center gap-3 py-8 px-3 text-center">
            <AlertCircle className="size-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{catalogError}</p>
            <Button size="sm" variant="outline" onClick={loadCatalog} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        )}

        {/* Virtualized list */}
        {!loadingCatalog && !catalogError && (
          // No padding on this div — handled by paddingStart/paddingEnd in the virtualizer.
          // px-3 is applied per-item so absolute children have correct horizontal inset.
          <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                    width: "100%",
                    paddingLeft: `${H_PADDING}px`,
                    paddingRight: `${H_PADDING}px`,
                  }}
                >
                  {row.type === "header" && (
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide pb-2">
                      {row.title}
                    </h3>
                  )}

                  {row.type === "items" && (
                    <div
                      className={`grid pb-2 gap-2 ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}
                    >
                      {row.libs.map((lib) => (
                        <LibraryCard
                          key={lib.source}
                          library={lib}
                          status={installStatus[lib.source] ?? INSTALL_STATUS.IDLE}
                          onInstall={handleInstall}
                          onViewMore={handleViewMore}
                        />
                      ))}
                    </div>
                  )}

                  {row.type === "empty" && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      No libraries match your search.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
