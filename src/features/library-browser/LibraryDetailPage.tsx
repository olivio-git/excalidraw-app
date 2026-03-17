import { useState, useCallback } from "react";
import { BookOpen } from "lucide-react";
import { fetch } from "@tauri-apps/plugin-http";
import { loadLibraryFromBlob } from "@excalidraw/excalidraw";
import { Badge } from "@/shared/components/ui/badge";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { DiagramController } from "@/core/diagram/DiagramController";
import { AddButton } from "./LibraryCard";
import type { ExcalidrawLibraryEntry, InstallStatus } from "./types";
import { INSTALL_STATUS } from "./types";

export default function LibraryDetailPage() {
  const { tabId } = useTabContext();
  const tab = useTabStore((s) => s.getTab(tabId));
  const library = tab?.metadata?.library as ExcalidrawLibraryEntry | undefined;

  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  const [status, setStatus] = useState<InstallStatus>(INSTALL_STATUS.IDLE);
  const [imgError, setImgError] = useState(false);

  const activeInstanceId = (() => {
    if (!activeTabId) return undefined;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab || activeTab.routeId !== "diagram") return undefined;
    return activeTab.instanceId;
  })();

  const handleInstall = useCallback(async () => {
    if (!library) return;
    setStatus(INSTALL_STATUS.LOADING);
    try {
      const res = await fetch(library.source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const items = await loadLibraryFromBlob(blob);
      const api = activeInstanceId ? DiagramController.getApi(activeInstanceId) : undefined;
      if (!api) throw new Error("No active diagram");
      await api.updateLibrary({ libraryItems: items, merge: true, openLibraryMenu: true });
      setStatus(INSTALL_STATUS.INSTALLED);
    } catch (err) {
      console.error("[LibraryDetail] Install failed:", err);
      setStatus(INSTALL_STATUS.ERROR);
    }
  }, [library, activeInstanceId]);

  if (!library) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Library not found.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="max-w-xl mx-auto px-6 py-8 flex flex-col gap-6">
        {/* Preview image */}
        <div className="w-full aspect-video rounded-xl border border-border bg-muted overflow-hidden flex items-center justify-center">
          {imgError || !library.preview ? (
            <BookOpen className="size-12 text-muted-foreground" />
          ) : (
            <img
              src={library.preview}
              alt={library.name}
              className="size-full object-cover"
              onError={() => setImgError(true)}
            />
          )}
        </div>

        {/* Title + install */}
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold leading-tight">{library.name}</h1>
          <AddButton status={status} onInstall={handleInstall} />
        </div>

        {/* Description */}
        {library.description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{library.description}</p>
        )}

        {/* Authors */}
        {library.authors.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Authors
            </span>
            <div className="flex flex-wrap gap-1.5">
              {library.authors.map((author) =>
                author.url ? (
                  <a key={author.name} href={author.url} target="_blank" rel="noreferrer">
                    <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/60">
                      {author.name}
                    </Badge>
                  </a>
                ) : (
                  <Badge key={author.name} variant="secondary">
                    {author.name}
                  </Badge>
                )
              )}
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="flex gap-4 text-xs text-muted-foreground border-t border-border pt-4">
          {library.created && <span>Added {new Date(library.created).toLocaleDateString()}</span>}
          {library.updated && <span>Updated {new Date(library.updated).toLocaleDateString()}</span>}
        </div>
      </div>
    </ScrollArea>
  );
}
