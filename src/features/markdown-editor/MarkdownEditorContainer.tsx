import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { readFile, readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import "katex/dist/katex.min.css";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { registerTabCloseHandler } from "@/core/tabs/tab-lifecycle";
import { openFileReference, resolveFileReference } from "@/core/shell/services/file-navigation";
import { renderDiagramPreview } from "@/features/document-editor/diagram-preview";
import { useThemeStore } from "@/stores/themeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { notify } from "@/shared/lib/notify";
import { refreshEmbeds } from "./embeds";
import { markdownEditorRegistry } from "./editor-registry";
import { liveBuffers } from "@/core/shell/services/live-buffers";
import { attachEditorScrollSync } from "@/core/shell/services/scroll-sync";
import { findHeading } from "./headings";
import type { NoteContext } from "./note-context";
import { createEditorExtensions } from "./setup";

const AUTOSAVE_MS = 800;

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

/**
 * Markdown editor tab (CodeMirror 6). The file on disk is plain Markdown and
 * is written back exactly as typed — no conversion. Changes autosave after a
 * short pause, and on Ctrl+S, tab close and unmount.
 */
export default function MarkdownEditorContainer() {
  const { tabId, isActive } = useTabContext();
  const tab = useTabStore((s) => s.getTab(tabId));
  const filePath = (tab?.instanceId ?? tab?.metadata?.filePath ?? "") as string;
  const navigationAnchor = tab?.metadata?.navigationAnchor as
    | { text: string; id: string }
    | undefined;
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pathRef = useRef(filePath);
  const scrollSyncRef = useRef<(() => void) | null>(null);
  const savedRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);

  // A rename updates the tab's path; keep writing to the new file.
  useEffect(() => {
    pathRef.current = filePath;
  }, [filePath]);

  // Only touches refs and a state setter, so it is stable for the tab's lifetime.
  const save = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const view = viewRef.current;
    if (!view) return true;
    const content = view.state.doc.toString();
    if (content === savedRef.current) return true;
    try {
      await writeTextFile(pathRef.current, content);
      savedRef.current = content;
      setDirty(view.state.doc.toString() !== content);
      return true;
    } catch (error) {
      notify("No se pudo guardar la nota", { type: "error", description: String(error) });
      return false;
    }
  }, []);

  // Load the file and create the editor once per tab.
  useEffect(() => {
    if (!filePath || viewRef.current) return;
    let cancelled = false;
    readTextFile(filePath).then(
      (content) => {
        if (cancelled || !hostRef.current) return;
        savedRef.current = content;
        liveBuffers.publish(filePath, content);
        const context: NoteContext = {
          getFilePath: () => pathRef.current,
          getWorkspaceDir: () => useWorkspaceStore.getState().workspaceDir,
          isDark: () => useThemeStore.getState().resolvedTheme === "dark",
          resolve: async (href) =>
            (
              await resolveFileReference(
                href,
                pathRef.current,
                useWorkspaceStore.getState().workspaceDir
              )
            ).filePath,
          open: (href, options) => {
            if (href.startsWith("#")) {
              const view = viewRef.current;
              const pos = view ? findHeading(view.state.doc, href) : -1;
              if (view && pos >= 0) {
                view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
              }
              return;
            }
            if (/^https?:\/\//i.test(href)) {
              void openUrl(href);
              return;
            }
            openFileReference(href, pathRef.current, options).catch((error) =>
              notify(String(error), { type: "error" })
            );
          },
          readFile: (path) => readFile(path),
          modifiedAt: async (path) => (await stat(path)).mtime?.getTime() ?? null,
          renderDiagram: renderDiagramPreview,
        };
        const view = new EditorView({
          parent: hostRef.current,
          state: EditorState.create({
            doc: content,
            extensions: createEditorExtensions(context, {
              onChange: (next) => {
                liveBuffers.publish(pathRef.current, next);
                setDirty(next !== savedRef.current);
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = setTimeout(() => void save(), AUTOSAVE_MS);
              },
              onSave: () => void save(),
            }),
          }),
        });
        viewRef.current = view;
        scrollSyncRef.current = attachEditorScrollSync(view, () => pathRef.current);
        setLoad({ status: "ready" });
      },
      (error) => {
        if (!cancelled) setLoad({ status: "error", message: String(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [filePath, save]);

  // Save pending changes and destroy the editor when the tab goes away.
  useEffect(
    () => () => {
      void save().finally(() => {
        liveBuffers.release(pathRef.current);
        scrollSyncRef.current?.();
        viewRef.current?.destroy();
        viewRef.current = null;
      });
    },
    [save]
  );

  // Let workbench flows (automation save, wait-before-close) reach this buffer.
  useEffect(
    () =>
      filePath
        ? markdownEditorRegistry.register(filePath, {
            save: () => save(),
            isDirty: () =>
              viewRef.current ? viewRef.current.state.doc.toString() !== savedRef.current : false,
          })
        : undefined,
    [filePath, save]
  );

  // Closing the tab waits for the save; a failed save keeps it open.
  useEffect(() => registerTabCloseHandler(tabId, save), [tabId, save]);

  // Unsaved-changes dot on the tab.
  useEffect(() => {
    const store = useTabStore.getState();
    const current = store.getTab(tabId);
    if (current && Boolean(current.metadata?.isDirty) !== dirty) {
      store.updateTab(tabId, { metadata: { ...current.metadata, isDirty: dirty } });
    }
  }, [dirty, tabId]);

  // Coming back to the tab (a diagram may have been edited) or switching
  // light/dark: previews re-check their file's mtime and re-render only if needed.
  useEffect(() => {
    if (!isActive || load.status !== "ready") return;
    viewRef.current?.dispatch({ effects: refreshEmbeds.of(null) });
  }, [isActive, resolvedTheme, load.status]);

  useEffect(() => {
    if (isActive && load.status === "ready") viewRef.current?.focus();
  }, [isActive, load.status]);

  // Jump to a heading when opened from a link or the references panel.
  useEffect(() => {
    const view = viewRef.current;
    if (!navigationAnchor || !view || load.status !== "ready") return;
    const pos = findHeading(view.state.doc, navigationAnchor.text);
    if (pos >= 0) view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  }, [navigationAnchor, load.status]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-background" data-markdown-editor>
      {load.status === "loading" && (
        <p className="p-6 text-sm text-muted-foreground">Cargando nota…</p>
      )}
      {load.status === "error" && (
        <div className="p-6 text-sm">
          <p className="font-medium text-destructive">No se pudo abrir la nota</p>
          <p className="mt-1 text-muted-foreground break-words">{load.message}</p>
        </div>
      )}
      <div ref={hostRef} className="h-full" hidden={load.status !== "ready"} />
      <span className="pointer-events-none absolute right-3 top-2 rounded border border-border bg-card/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        Markdown · beta
      </span>
    </div>
  );
}
