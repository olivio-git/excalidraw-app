import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { watch, type UnwatchFn } from "@tauri-apps/plugin-fs";
import {
  ArrowDownWideNarrow,
  CircleCheck,
  CircleDot,
  CircleOff,
  CirclePause,
  NotebookText,
  Pin,
  Search,
} from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useConfigStore } from "@/core/config/config-store";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import { indexNotes, sortNotes, type NoteStatus, type NoteSummary } from "./notes-index";

const ALL = "__all__";

const STATUS_ICON: Record<NoteStatus, { icon: typeof CircleDot; className: string }> = {
  active: { icon: CircleDot, className: "text-amber-500" },
  onhold: { icon: CirclePause, className: "text-orange-500" },
  completed: { icon: CircleCheck, className: "text-emerald-500" },
  dropped: { icon: CircleOff, className: "text-red-500" },
};

function useRelativeTime() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.RelativeTimeFormat(i18n.language || "en", { numeric: "auto" });
    return (time: number) => {
      if (!time) return "";
      const seconds = (time - Date.now()) / 1000;
      const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ["year", 31536000],
        ["month", 2592000],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
      ];
      for (const [unit, size] of units)
        if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
      return format.format(0, "second");
    };
  }, [i18n.language]);
}

/** Notes view: every note of the workspace by date, like Inkdrop's note list. */
export function NotesPanel() {
  const { t } = useTranslation("common");
  const relative = useRelativeTime();
  const workspace = useWorkspaceStore((s) => s.workspaceDir);
  const settings = useConfigStore((s) => s.config.notes);
  const activePath = useTabStore((s) => {
    const tab = s.tabs.find((item) => item.id === s.activeTabId);
    return tab?.metadata?.filePath as string | undefined;
  });
  const [state, setState] = useState<{ root: string | null; notes: NoteSummary[] | null }>({
    root: null,
    notes: null,
  });
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [notebook, setNotebook] = useState(ALL);
  const [sort, setSort] = useState<"updated" | "title" | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    let stop: UnwatchFn | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    indexNotes(workspace, controller.signal)
      .then((notes) => {
        if (!controller.signal.aborted) setState({ root: workspace, notes });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ root: workspace, notes: [] });
      });
    void watch(
      workspace,
      (event) => {
        if (typeof event.type === "object" && "access" in event.type) return;
        if (!event.paths.some((p) => /\.(md|markdown|note)$/i.test(p))) return;
        clearTimeout(timer);
        timer = setTimeout(() => setRevision((n) => n + 1), 500);
      },
      { recursive: true }
    )
      .then((unwatch) => {
        stop = unwatch;
        if (controller.signal.aborted) unwatch();
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      clearTimeout(timer);
      stop?.();
    };
  }, [workspace, revision]);

  const notes = useMemo(() => (state.root === workspace ? state.notes : null), [state, workspace]);
  const notebooks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes ?? []) counts.set(note.notebook, (counts.get(note.notebook) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [notes]);
  const effectiveSort = sort ?? settings.sort;
  const visible = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const filtered = (notes ?? []).filter(
      (note) =>
        (notebook === ALL || note.notebook === notebook) &&
        (!wanted ||
          note.title.toLowerCase().includes(wanted) ||
          note.snippet.toLowerCase().includes(wanted) ||
          note.tags.some((tag) => tag.toLowerCase().includes(wanted)))
    );
    return sortNotes(filtered, effectiveSort, settings.pinned);
  }, [notes, query, notebook, effectiveSort, settings.pinned]);
  const pinnedPaths = useMemo(
    () =>
      new Set(
        visible
          .filter((note) =>
            settings.pinned.some((p) =>
              note.path.replaceAll("\\", "/").endsWith(`/${p.replace(/^\.?\//, "")}`)
            )
          )
          .map((note) => note.path)
      ),
    [visible, settings.pinned]
  );

  const notebookItems = [
    { value: ALL, label: `${t("notesList.allNotes")} · ${notes?.length ?? 0}` },
    ...notebooks.map(([name, count]) => ({
      value: name,
      label: `${name || t("notesList.root")} · ${count}`,
    })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" data-notes-panel>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs font-medium">
        <NotebookText className="size-4" />
        <span className="flex-1">{t("notesList.title")}</span>
        <button
          type="button"
          title={
            effectiveSort === "updated" ? t("notesList.sortUpdated") : t("notesList.sortTitle")
          }
          aria-label={
            effectiveSort === "updated" ? t("notesList.sortUpdated") : t("notesList.sortTitle")
          }
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
          onClick={() => setSort(effectiveSort === "updated" ? "title" : "updated")}
        >
          <ArrowDownWideNarrow className="size-3.5" />
          {effectiveSort === "updated" ? t("notesList.sortUpdated") : t("notesList.sortTitle")}
        </button>
      </div>
      {!settings.enabled ? (
        <p className="p-3 text-xs text-muted-foreground">{t("notesList.disabled")}</p>
      ) : !workspace ? (
        <p className="p-3 text-xs text-muted-foreground">{t("notesList.noWorkspace")}</p>
      ) : (
        <>
          <div className="shrink-0 space-y-1.5 p-2">
            <div className="flex items-center gap-1.5 rounded-md border border-input px-2">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                data-panel-search
                aria-label={t("notesList.search")}
                placeholder={t("notesList.search")}
                className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {notebooks.length > 1 && (
              <Select
                items={notebookItems}
                value={notebook}
                onValueChange={(value) => setNotebook(value as string)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t("notesList.allNotes")}
                  className="h-7 w-full text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {notebookItems.map((item) => (
                    <SelectItem key={item.value} value={item.value} className="text-xs">
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {notes === null && (
              <p className="px-3 text-xs text-muted-foreground">{t("notesList.loading")}</p>
            )}
            {notes?.length === 0 && (
              <p className="px-3 text-xs text-muted-foreground">{t("notesList.empty")}</p>
            )}
            {notes && notes.length > 0 && visible.length === 0 && (
              <p className="px-3 text-xs text-muted-foreground">{t("notesList.noResults")}</p>
            )}
            <ul>
              {visible.map((note) => {
                const status = note.status ? STATUS_ICON[note.status] : null;
                const StatusIcon = status?.icon;
                const active =
                  activePath?.replaceAll("\\", "/") === note.path.replaceAll("\\", "/");
                return (
                  <li key={note.path}>
                    <button
                      type="button"
                      data-note={note.path.split(/[\\/]/).pop()}
                      title={note.path}
                      onClick={() => openFileInWorkbench(note.path, { preview: true })}
                      onDoubleClick={() => openFileInWorkbench(note.path)}
                      className={cn(
                        "block w-full border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-accent/60",
                        active && "bg-primary/10 hover:bg-primary/15"
                      )}
                    >
                      <span className="flex items-start gap-1.5">
                        {pinnedPaths.has(note.path) && (
                          <Pin
                            className="mt-0.5 size-3.5 shrink-0 rotate-45 text-primary"
                            aria-label={t("notesList.pinned")}
                          />
                        )}
                        {StatusIcon && (
                          <StatusIcon
                            className={cn("mt-0.5 size-3.5 shrink-0", status.className)}
                            aria-label={t(`notesList.status.${note.status}`)}
                          />
                        )}
                        <span
                          data-note-title
                          className="line-clamp-2 text-[13px] font-semibold leading-snug"
                        >
                          {note.title}
                        </span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{relative(note.updated)}</span>
                        {note.notebook && notebook === ALL && (
                          <span className="rounded bg-muted px-1 text-[10px]">{note.notebook}</span>
                        )}
                        {note.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-primary/10 px-1.5 text-[10px] text-primary"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                      {note.snippet && (
                        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                          {note.snippet}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
