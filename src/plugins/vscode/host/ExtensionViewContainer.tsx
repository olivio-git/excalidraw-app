import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { extensionHost } from "./extension-host-service";
import { useExtensionHostStore } from "./host-store";
import { useTreeStore, useWebviewStore } from "./view-stores";
import { ExtensionTreeView } from "./ExtensionTreeView";
import { ViewTitleActions } from "./ViewActions";
import { WebviewFrame } from "./WebviewFrame";
import { useViewModel, type ViewContainerInfo } from "./view-containers";

/** A webview view (`registerWebviewViewProvider`) resolved on first show. */
export function ExtensionWebviewView({ viewId }: { viewId: string }) {
  const handle = useWebviewStore((s) => s.viewHandles[viewId]);
  const hasProvider = useWebviewStore((s) => !!s.providers[viewId]);
  const hostStatus = useExtensionHostStore((s) => s.status);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void extensionHost.activateByEvent(`onView:${viewId}`);
  }, [viewId, hostStatus]);

  useEffect(() => {
    if (handle || !hasProvider) return;
    extensionHost
      .request("webviewView.resolve", { viewId })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [viewId, handle, hasProvider]);

  if (error) return <p className="px-4 py-2 text-xs text-destructive">{error}</p>;
  if (!handle) return <p className="px-4 py-2 text-xs text-muted-foreground">Cargando…</p>;
  return (
    <div className="h-72">
      <WebviewFrame handle={handle} />
    </div>
  );
}

/** Sidebar panel for an extension view container: one collapsible section per view. */
export function ExtensionViewContainer({ container }: { container: ViewContainerInfo }) {
  const { menus } = useViewModel();
  const treeViews = useTreeStore((s) => s.views);
  const webviewProviders = useWebviewStore((s) => s.providers);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {container.title}
      </div>
      <ScrollArea className="flex-1 min-h-0">
        {container.views.map((view) => {
          const isOpen = !collapsed.has(view.id);
          const isWebview = view.type === "webview" || !!webviewProviders[view.id];
          const title = treeViews[view.id]?.title ?? view.name;
          const description = treeViews[view.id]?.description;
          return (
            <section
              key={view.id}
              aria-label={title}
              className="border-t border-border/40 first:border-t-0"
            >
              <div className="group flex h-6 items-center pr-1">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(view.id)}
                  className="flex h-full min-w-0 flex-1 items-center gap-1 px-1 text-left text-[11px] font-semibold uppercase tracking-wide outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <ChevronRight
                    className={cn("size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")}
                  />
                  <span className="truncate">{title}</span>
                  {description && (
                    <span className="truncate text-[10px] font-normal normal-case text-muted-foreground">
                      {description}
                    </span>
                  )}
                </button>
                <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  {isOpen && !isWebview && <ViewTitleActions viewId={view.id} menus={menus} />}
                </span>
              </div>
              {isOpen &&
                (isWebview ? (
                  <ExtensionWebviewView viewId={view.id} />
                ) : (
                  <ExtensionTreeView viewId={view.id} menus={menus} />
                ))}
            </section>
          );
        })}
      </ScrollArea>
    </div>
  );
}
