import { ArrowDownLeft, ArrowUpRight, RefreshCw, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { createFileReference, openFileReference } from "../services/file-navigation";
import { notify } from "@/shared/lib/notify";
import { referencePathKey } from "../services/workspace-references";
import { useWorkspaceReferences } from "../hooks/useWorkspaceReferences";

export function ReferencesPanel() {
  const { t } = useTranslation("common");
  const tabs = useTabStore((state) => state.tabs);
  const activeId = useTabStore((state) => state.activeTabId);
  const path = tabs.find((tab) => tab.id === activeId)?.metadata?.filePath as string | undefined;
  const { index, loading, error, workspace, refresh } = useWorkspaceReferences();
  const incoming =
    index?.references.filter(
      (ref) => path && referencePathKey(ref.targetPath) === referencePathKey(path)
    ) ?? [];
  const outgoing =
    index?.references.filter(
      (ref) => path && referencePathKey(ref.sourcePath) === referencePathKey(path)
    ) ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs font-medium">
        <Link2 className="size-4" />
        <span className="flex-1">{t("connected.references")}</span>
        <button onClick={refresh} aria-label={t("connected.refresh")}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 text-xs">
        {!workspace ? (
          <p>{t("connected.noWorkspace")}</p>
        ) : !path ? (
          <p>{t("connected.selectFile")}</p>
        ) : (
          <>
            <p className="mb-4 truncate text-muted-foreground" title={path}>
              {path.split(/[\\/]/).pop()}
            </p>
            {error && (
              <p role="alert" className="mb-3 break-words text-destructive">
                {error}
              </p>
            )}
            {loading && !index && <p role="status">{t("connected.indexing")}</p>}
            {[
              { label: t("connected.incoming"), refs: incoming, incoming: true },
              { label: t("connected.outgoing"), refs: outgoing, incoming: false },
            ].map((section) => (
              <section key={section.label} className="mb-5">
                <h3 className="mb-2 flex items-center justify-between font-medium">
                  <span>{section.label}</span>
                  <span className="text-muted-foreground">{section.refs.length}</span>
                </h3>
                {!section.refs.length && !loading && (
                  <p className="text-muted-foreground">{t("connected.noReferences")}</p>
                )}
                {section.refs.map((ref, index) => {
                  const file = section.incoming ? ref.sourcePath : ref.targetPath;
                  const anchor = section.incoming ? ref.sourceAnchor : ref.targetAnchor;
                  return (
                    <button
                      key={`${file}:${anchor}:${index}`}
                      title={file}
                      className="mb-1 flex w-full items-start gap-2 rounded px-2 py-2 text-left hover:bg-accent focus-visible:outline-primary"
                      onClick={(event) => {
                        const href =
                          createFileReference(file, workspace) +
                          (anchor ? `#${encodeURIComponent(anchor)}` : "");
                        void openFileReference(href, path ?? file, {
                          beside: event.ctrlKey || event.metaKey || event.shiftKey,
                        }).catch((error: unknown) => notify(String(error), { type: "error" }));
                      }}
                    >
                      {section.incoming ? (
                        <ArrowDownLeft className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      ) : (
                        <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate">{file.split(/[\\/]/).pop()}</span>
                        {ref.label && (
                          <span className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {ref.label}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </>
        )}
      </div>
      {index && (
        <div
          role="status"
          className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground"
        >
          {t("connected.indexedFiles", { count: index.files })}
          {index.truncated && (
            <span className="block text-amber-600">{t("connected.indexLimit")}</span>
          )}
          {index.failures > 0 && (
            <span className="block text-amber-600">
              {t("connected.partialIndex", { count: index.failures })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
