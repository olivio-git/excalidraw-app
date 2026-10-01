import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { CompletionSource } from "@codemirror/autocomplete";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { liveBuffers } from "@/core/shell/services/live-buffers";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { registerTabCloseHandler } from "@/core/tabs/tab-lifecycle";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { useThemeStore } from "@/stores/themeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { notify } from "@/shared/lib/notify";
import { getLanguageRegistry } from "./language-registry";
import { getExtensionSnippets } from "./extension-languages";
import { snippetCompletionSource, snippetsForLanguage, type Snippet } from "./snippets";
import { editorContributions, type CodeDocument } from "./editor-contributions";
import {
  completionExtension,
  createCodeEditorExtensions,
  createCompartments,
  loadLanguageSupport,
} from "./setup";
import { codeHighlightStyle } from "./theme";
import { codeEditorRegistry } from "./code-editor-registry";
import { toOffset } from "./setup";
import type { RevealRequest } from "./reveal";

const AUTOSAVE_MS = 1000;

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

function setEditorContext(doc: CodeDocument | null, focused: boolean): void {
  contextKeyService.set("editorTextFocus", focused);
  contextKeyService.set("editorFocus", focused);
  if (!doc) return;
  const name = doc.filePath.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  contextKeyService.set("editorLangId", doc.languageId);
  contextKeyService.set("resourceLangId", doc.languageId);
  contextKeyService.set("resourceFilename", name);
  contextKeyService.set("resourceExtname", dot > 0 ? name.slice(dot) : "");
}

/**
 * Generic code editor tab (CodeMirror 6) for any text file: syntax
 * highlighting from TextMate grammars or CodeMirror's parsers, snippets from
 * extensions, and hooks for language features (see editor-contributions).
 * Changes autosave after a short pause, on Ctrl+S and when the tab closes.
 */
const PROSE_LANGUAGES = new Set(["markdown", "plaintext"]);

export default function CodeEditorContainer() {
  const { tabId, isActive } = useTabContext();
  const tab = useTabStore((s) => s.getTab(tabId));
  const filePath = (tab?.instanceId ?? tab?.metadata?.filePath ?? "") as string;
  const languageOverride = tab?.metadata?.languageId as string | undefined;
  const reveal = tab?.metadata?.reveal as RevealRequest | undefined;
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pathRef = useRef(filePath);
  const savedRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef<CodeDocument | null>(null);
  const compartments = useRef(createCompartments()).current;
  const snippetsRef = useRef<Snippet[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);
  const [language, setLanguage] = useState<{ id: string | null; name: string }>({
    id: null,
    name: "",
  });

  useEffect(() => {
    pathRef.current = filePath;
  }, [filePath]);

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
      if (docRef.current) editorContributions.didSave(docRef.current);
      return true;
    } catch (error) {
      notify("No se pudo guardar el archivo", { type: "error", description: String(error) });
      return false;
    }
  }, []);

  /** Completion sources: extension snippets plus language features. */
  const completionSources = useCallback((): CompletionSource[] => {
    const doc = docRef.current;
    const sources: CompletionSource[] = [
      snippetCompletionSource(
        () => snippetsRef.current,
        () => ({
          filePath: pathRef.current,
          workspaceName: useWorkspaceStore.getState().workspaceDir?.split(/[\\/]/).pop(),
        })
      ),
    ];
    if (doc) {
      for (const contribution of editorContributions.getAll()) {
        sources.push(...(contribution.completionSources?.(doc) ?? []));
      }
    }
    return sources;
  }, []);

  const applyContributions = useCallback(() => {
    const view = viewRef.current;
    const doc = docRef.current;
    if (!view || !doc) return;
    view.dispatch({
      effects: [
        compartments.contributions.reconfigure(
          editorContributions.getAll().flatMap((c) => c.extensions?.(doc) ?? [])
        ),
        compartments.completion.reconfigure(completionExtension(completionSources())),
      ],
    });
  }, [compartments, completionSources]);

  // Load the file and create the editor once per tab.
  useEffect(() => {
    if (!filePath || viewRef.current) return;
    let cancelled = false;
    readTextFile(filePath).then(
      async (content) => {
        if (cancelled || !hostRef.current) return;
        savedRef.current = content;
        liveBuffers.publish(filePath, content);
        const registry = getLanguageRegistry();
        const languageId =
          languageOverride ?? registry.resolve(filePath, content.split("\n", 1)[0]) ?? "plaintext";
        setLanguage({ id: languageId, name: registry.get(languageId)?.name ?? languageId });

        let version = 1;
        const doc: CodeDocument = {
          filePath,
          languageId,
          get version() {
            return version;
          },
          getText: () => viewRef.current?.state.doc.toString() ?? content,
        };
        docRef.current = doc;

        const view = new EditorView({
          parent: hostRef.current,
          state: EditorState.create({
            doc: content,
            extensions: [
              // Prose wraps like in VS Code (Markdown/plain text); code scrolls sideways.
              PROSE_LANGUAGES.has(languageId) ? EditorView.lineWrapping : [],
              createCodeEditorExtensions(
                compartments,
                {
                  onChange: (next, changes) => {
                    version++;
                    liveBuffers.publish(doc.filePath, next);
                    setDirty(next !== savedRef.current);
                    editorContributions.didChange(doc, changes);
                    if (timerRef.current) clearTimeout(timerRef.current);
                    timerRef.current = setTimeout(() => void save(), AUTOSAVE_MS);
                  },
                  onSave: () => void save(),
                  onSelectionChange: (selections) =>
                    editorContributions.didChangeSelection(doc, selections),
                  onFocusChange: (focused) => {
                    setEditorContext(doc, focused);
                    if (focused) editorContributions.didFocus(doc);
                  },
                },
                useThemeStore.getState().resolvedTheme === "dark",
                []
              ),
            ],
          }),
        });
        viewRef.current = view;
        setLoad({ status: "ready" });
        editorContributions.didOpen(doc);
        applyContributions();

        const [support, snippets] = await Promise.all([
          loadLanguageSupport(languageId),
          getExtensionSnippets().catch(() => []),
        ]);
        if (cancelled || viewRef.current !== view) return;
        snippetsRef.current = snippetsForLanguage(snippets, languageId);
        view.dispatch({ effects: compartments.language.reconfigure(support.extension) });
      },
      (error) => {
        if (!cancelled) setLoad({ status: "error", message: String(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [filePath, languageOverride, save, compartments, applyContributions]);

  // Language features registered later (e.g. the extension host starting).
  useEffect(() => editorContributions.subscribe(applyContributions), [applyContributions]);

  // Save pending changes and destroy the editor when the tab goes away.
  useEffect(
    () => () => {
      void save().finally(() => {
        if (docRef.current) {
          editorContributions.didClose(docRef.current);
          liveBuffers.release(docRef.current.filePath);
        }
        viewRef.current?.destroy();
        viewRef.current = null;
      });
    },
    [save]
  );

  useEffect(
    () =>
      filePath
        ? codeEditorRegistry.register(filePath, {
            save: () => save(),
            isDirty: () =>
              viewRef.current ? viewRef.current.state.doc.toString() !== savedRef.current : false,
            getView: () => viewRef.current,
          })
        : undefined,
    [filePath, save]
  );

  useEffect(() => registerTabCloseHandler(tabId, save), [tabId, save]);

  useEffect(() => {
    const store = useTabStore.getState();
    const current = store.getTab(tabId);
    if (current && Boolean(current.metadata?.isDirty) !== dirty) {
      store.updateTab(tabId, { metadata: { ...current.metadata, isDirty: dirty } });
    }
  }, [dirty, tabId]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.highlight.reconfigure(codeHighlightStyle(resolvedTheme === "dark")),
    });
  }, [resolvedTheme, compartments]);

  useEffect(() => {
    if (isActive && load.status === "ready") {
      viewRef.current?.focus();
      editorContributions.didFocus(docRef.current);
    }
  }, [isActive, load.status]);

  // Jump to a position (go to definition, extensions' showTextDocument).
  useEffect(() => {
    const view = viewRef.current;
    if (!reveal || !view || load.status !== "ready") return;
    const doc = view.state.doc;
    const anchor = toOffset(doc, reveal.start);
    const head = reveal.end ? toOffset(doc, reveal.end) : anchor;
    view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
    view.focus();
  }, [reveal, load.status]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-background" data-code-editor>
      {load.status === "loading" && (
        <p className="p-6 text-sm text-muted-foreground">Cargando archivo…</p>
      )}
      {load.status === "error" && (
        <div className="p-6 text-sm">
          <p className="font-medium text-destructive">No se pudo abrir el archivo</p>
          <p className="mt-1 text-muted-foreground break-words">{load.message}</p>
        </div>
      )}
      <div ref={hostRef} className="h-full" hidden={load.status !== "ready"} />
      {/\.(md|markdown)$/i.test(filePath) && load.status === "ready" && (
        <button
          type="button"
          data-open-preview
          title="Vista previa al lado (Ctrl+K V)"
          onClick={() =>
            void import("@/features/markdown-preview").then(({ openMarkdownPreview }) =>
              openMarkdownPreview(filePath)
            )
          }
          className="absolute top-2 right-4 z-10 rounded border border-border bg-card/80 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Vista previa
        </button>
      )}
      {language.name && (
        <span
          data-language-badge
          className="pointer-events-none absolute right-3 bottom-2 rounded border border-border bg-card/80 px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {language.name}
        </span>
      )}
    </div>
  );
}
