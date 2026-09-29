import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaseSensitive, ChevronRight, Regex, Search, WholeWord } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { notify } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/utils";
import { createFileReference, openFileReference } from "../services/file-navigation";
import {
  buildMatcher,
  searchWorkspace,
  type SearchOptions,
  type SearchSummary,
} from "../services/workspace-search";

function Toggle({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground",
        pressed && "bg-primary/15 text-primary"
      )}
    >
      {children}
    </button>
  );
}

const relative = (path: string, root: string | null) => {
  const clean = path.replaceAll("\\", "/");
  const base = root?.replaceAll("\\", "/").replace(/\/$/, "");
  return base && clean.startsWith(`${base}/`) ? clean.slice(base.length + 1) : clean;
};

/** Find in files: every note, Markdown, diagram, flow and code file of the workspace. */
export function SearchPanel() {
  const { t } = useTranslation("common");
  const workspace = useWorkspaceStore((s) => s.workspaceDir);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>({});
  // Results are tagged with the search they answer: stale ones are simply not shown.
  const [answer, setAnswer] = useState<{ key: string; summary: SearchSummary | null } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const invalid = query !== "" && buildMatcher(query, options) === null;
  const active = Boolean(workspace && query && !invalid);
  const key = JSON.stringify([workspace, query, options]);
  const result = active && answer?.key === key ? answer.summary : null;
  const loading = active && answer?.key !== key;

  useEffect(() => {
    if (!active || !workspace) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchWorkspace(
        workspace,
        query,
        controller.signal,
        useDocumentStore.getState().documents,
        options
      )
        .then((summary) => {
          if (!controller.signal.aborted) setAnswer({ key, summary });
        })
        .catch(() => {
          if (!controller.signal.aborted) setAnswer({ key, summary: null });
        });
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, workspace, query, options, key]);

  // Ctrl+Shift+F focuses the box (the command dispatches this event).
  useEffect(() => {
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("workbench:focus-search", focus);
    return () => window.removeEventListener("workbench:focus-search", focus);
  }, []);

  const toggle = (key: keyof SearchOptions) =>
    setOptions((current) => ({ ...current, [key]: !current[key] }));

  const open = (path: string, anchor: string, beside: boolean) => {
    const href =
      createFileReference(path, workspace) + (anchor ? `#${encodeURIComponent(anchor)}` : "");
    const state = useTabStore.getState();
    const source = state.tabs.find((tab) => tab.id === state.activeTabId)?.metadata?.filePath as
      | string
      | undefined;
    void openFileReference(href, source ?? path, { beside }).catch((error: unknown) =>
      notify(String(error), { type: "error" })
    );
  };

  const files = result?.files ?? [];
  const allCollapsed = files.length > 0 && files.every((file) => collapsed.has(file.path));
  const summary = useMemo(
    () => (result ? t("search.summary", { count: result.total, files: result.files.length }) : ""),
    [result, t]
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-search-panel>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs font-medium">
        <Search className="size-4" />
        <span className="flex-1">{t("search.title")}</span>
        {files.length > 0 && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() =>
              setCollapsed(allCollapsed ? new Set() : new Set(files.map((file) => file.path)))
            }
          >
            {allCollapsed ? t("search.expandAll") : t("search.collapseAll")}
          </button>
        )}
      </div>
      <div className="shrink-0 p-2">
        <div
          className={cn(
            "flex items-center gap-1 rounded-md border border-input bg-transparent px-2 focus-within:border-ring",
            invalid && "border-destructive"
          )}
        >
          <input
            ref={input}
            data-panel-search
            aria-label={t("search.placeholder")}
            placeholder={t("search.placeholder")}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
          />
          <Toggle
            label={t("search.caseSensitive")}
            pressed={!!options.caseSensitive}
            onClick={() => toggle("caseSensitive")}
          >
            <CaseSensitive className="size-3.5" />
          </Toggle>
          <Toggle
            label={t("search.wholeWord")}
            pressed={!!options.wholeWord}
            onClick={() => toggle("wholeWord")}
          >
            <WholeWord className="size-3.5" />
          </Toggle>
          <Toggle
            label={t("search.regex")}
            pressed={!!options.regex}
            onClick={() => toggle("regex")}
          >
            <Regex className="size-3.5" />
          </Toggle>
        </div>
        <p role="status" className="mt-1.5 min-h-4 text-[11px] text-muted-foreground">
          {!workspace
            ? t("search.noWorkspace")
            : invalid
              ? t("search.invalidRegex")
              : !query
                ? t("search.typeToSearch")
                : loading && !result
                  ? t("search.searching")
                  : result && result.total === 0
                    ? t("search.noResults")
                    : summary}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2 text-xs">
        {files.map((file) => {
          const isCollapsed = collapsed.has(file.path);
          const name = file.path.split(/[\\/]/).pop() ?? file.path;
          return (
            <section key={file.path} data-search-file={name}>
              <button
                type="button"
                title={file.path}
                className="flex w-full items-center gap-1 rounded px-1 py-1 text-left hover:bg-accent"
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(file.path)) next.delete(file.path);
                    else next.add(file.path);
                    return next;
                  })
                }
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 transition-transform",
                    !isCollapsed && "rotate-90"
                  )}
                />
                <span className="truncate font-medium">{name}</span>
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                  {relative(file.path, workspace).replace(/[^/]*$/, "")}
                </span>
                <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                  {file.matches.length}
                </span>
              </button>
              {!isCollapsed &&
                file.matches.map((match, index) => (
                  <button
                    key={index}
                    type="button"
                    data-search-match
                    className="block w-full rounded py-0.5 pr-1 pl-6 text-left hover:bg-accent"
                    title={match.context}
                    onClick={(event) =>
                      open(
                        file.path,
                        match.anchor,
                        event.ctrlKey || event.metaKey || event.shiftKey
                      )
                    }
                  >
                    <span className="line-clamp-2 break-all text-muted-foreground">
                      {match.text.slice(0, match.start)}
                      <mark className="rounded-sm bg-amber-300/60 px-px text-foreground dark:bg-amber-400/40">
                        {match.text.slice(match.start, match.end)}
                      </mark>
                      {match.text.slice(match.end)}
                    </span>
                    {(match.context || match.line) && (
                      <span className="block truncate text-[10px] text-muted-foreground/70">
                        {match.context}
                        {match.context && match.line ? " · " : ""}
                        {match.line ? t("search.line", { line: match.line }) : ""}
                      </span>
                    )}
                  </button>
                ))}
            </section>
          );
        })}
        {result?.truncated && (
          <p className="px-2 py-2 text-[11px] text-amber-600">{t("search.truncated")}</p>
        )}
      </div>
    </div>
  );
}
