import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateBlockNote } from "@blocknote/react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useDocumentStore } from "@/stores/documentStore";
import { useThemeStore } from "@/stores/themeStore";
import { notify } from "@/shared/lib/notify";
import { registerTabCloseHandler } from "@/core/tabs/tab-lifecycle";
import { tabGroup } from "@/core/tabs/store/editor-layout";
import {
  createFileReference,
  isLocalFileReference,
  openFileReference,
} from "@/core/shell/services/file-navigation";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DocumentEditor } from "./DocumentEditor";
import { DocumentEditorToolbar } from "./DocumentEditorToolbar";
import { useDocumentPersistence } from "./hooks/useDocumentPersistence";
import { getDocumentController } from "./documentController.singleton";
import { documentSchema } from "./documentSchema";
import { documentEditorRegistry } from "./documentEditorRegistry";
import { encodeDocument, isRichNote, projectDocument, type DocumentBlock } from "./note-format";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import { DocumentOutline } from "./DocumentOutline";
import { DocumentHostContext } from "./DocumentHostContext";
import { headingSlug } from "@/core/shell/services/workspace-references";

// ---------------------------------------------------------------------------
// DocumentEditorContainer — smart container
//
// Route: registered as "document-editor" with keepMounted: true
// filePath is stored in tab.instanceId (and tab.metadata.filePath)
// ---------------------------------------------------------------------------

export default function DocumentEditorContainer() {
  const { t } = useTranslation("common");
  const { tabId, isActive } = useTabContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<{ path: string; message: string } | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const tab = useTabStore((s) => s.getTab(tabId));

  // Editor instance lives here so export handlers can call editor APIs directly.
  // keepMounted: true in route config ensures this component stays alive.
  const editor = useCreateBlockNote({ schema: documentSchema });

  // filePath is the document identifier — stored as instanceId by the file handler
  const filePath = (tab?.instanceId ?? tab?.metadata?.filePath ?? "") as string;

  const document = useDocumentStore((s) => (filePath ? s.documents[filePath] : undefined));
  const updateEditorContent = useDocumentStore((s) => s.updateEditorContent);
  const setActive = useDocumentStore((s) => s.setActive);

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  // Auto-save side effects — return value not needed (toolbar no longer shows save status)
  const persistence = useDocumentPersistence(filePath);
  const pauseAutosave = persistence.pause;
  const { t: tTabs } = useTranslation("tabs");

  // ── Register editor instance for MCP bridge access ───────────────────────
  useEffect(() => {
    if (!filePath) return;
    documentEditorRegistry.register(filePath, editor);
    return () => {
      documentEditorRegistry.unregister(filePath);
    };
  }, [filePath, editor]);

  // Only the focused editor determines command/AI context, even with two visible panes.
  useEffect(() => {
    if (isActive && filePath) setActive(filePath);
  }, [isActive, filePath, setActive]);

  useEffect(
    () =>
      registerTabCloseHandler(
        tabId,
        async () => {
          const store = useDocumentStore.getState();
          if (store.documents[filePath]?.isDirty)
            await getDocumentController().saveDocument(filePath);
          await getDocumentController().waitForSaves(filePath);
          return !useDocumentStore.getState().documents[filePath]?.isDirty;
        },
        async () => {
          const resume = pauseAutosave();
          try {
            await getDocumentController().waitForSaves(filePath, true);
            return resume;
          } catch (error) {
            resume();
            throw error;
          }
        }
      ),
    [tabId, filePath, pauseAutosave]
  );

  // ── Mount: open document if not already in store ─────────────────────────
  useEffect(() => {
    if (!filePath) return;
    let current = true;

    // If not loaded yet, open it from disk
    const alreadyOpen = useDocumentStore.getState().documents[filePath];
    if (!alreadyOpen) {
      getDocumentController()
        .openDocument(filePath, false)
        .catch((err: unknown) => {
          if (current) setLoadError({ path: filePath, message: String(err) });
        });
    }
    return () => {
      current = false;
    };
  }, [filePath]);

  const navigationAnchor = tab?.metadata?.navigationAnchor as
    | { text: string; id: string }
    | undefined;
  useEffect(() => {
    if (!navigationAnchor || !document || !isActive) return;
    const frame = requestAnimationFrame(() => {
      const slug = (text: string) =>
        text
          .toLowerCase()
          .trim()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .replace(/\s+/g, "-");
      const target = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, [data-id]") ?? []
      ).find(
        (element) =>
          element.dataset.id === navigationAnchor.text ||
          (/^H[1-6]$/.test(element.tagName) &&
            slug(element.textContent ?? "") === slug(navigationAnchor.text))
      );
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
      const current = useTabStore.getState().getTab(tabId);
      if (current?.metadata?.navigationAnchor?.id === navigationAnchor.id) {
        useTabStore
          .getState()
          .updateTab(tabId, { metadata: { ...current.metadata, navigationAnchor: undefined } });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [navigationAnchor, document, isActive, tabId]);

  // ── Sync tab title from document store ───────────────────────────────────
  // Task 2.7: update tab title when document loads
  useEffect(() => {
    if (!document?.title || !tab) return;
    if (tab.title !== document.title) {
      useTabStore.getState().updateTab(tabId, { title: document.title });
    }
  }, [document?.title, tab, tabId]);

  // ── onChange: update store (persistence hook handles auto-save) ──────────
  const handleChange = (markdown: string, blocks: DocumentBlock[]) => {
    if (!filePath) return;
    updateEditorContent(filePath, markdown, blocks);
  };

  // ── Sync isDirty to tab metadata — drives the dirty dot on the tab chip ──
  useEffect(() => {
    if (!tab || document?.isDirty === undefined) return;
    const isDirty = document.isDirty;
    if (tab.metadata?.isDirty !== isDirty) {
      useTabStore.getState().updateTab(tabId, { metadata: { ...tab.metadata, isDirty } });
    }
  }, [document?.isDirty, tab, tabId]);

  // ── Export handlers ───────────────────────────────────────────────────────
  const handleExportHtml = async () => {
    if (!document) return;
    try {
      const html = await editor.blocksToFullHTML(editor.document);
      const path = await saveDialog({
        defaultPath: `${document.title}.html`,
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (!path) return;
      await writeTextFile(path, html);
      notify(t("documentEditor.exported"), { type: "success" });
    } catch (err) {
      console.error("[DocumentEditorContainer] Export HTML failed:", err);
    }
  };

  const handleExportMarkdown = async () => {
    if (!document) return;
    try {
      const path = await saveDialog({
        defaultPath: `${document.title}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeTextFile(path, document.content);
      notify(t("documentEditor.exported"), { type: "success" });
    } catch (err) {
      console.error("[DocumentEditorContainer] Export Markdown failed:", err);
    }
  };

  // Keep the window-level fallback in addition to the tab save-before-close handler.
  useEffect(() => {
    if (!document?.isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show a generic message; setting returnValue triggers the dialog
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [document?.isDirty]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t("documentEditor.noDocumentSelected")}
      </div>
    );
  }

  if (!document) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {loadError?.path === filePath ? (
          <p role="alert" className="max-w-full break-words p-4 text-destructive">
            {loadError.message}
          </p>
        ) : (
          t("documentEditor.loading")
        )}
      </div>
    );
  }

  const richNote = isRichNote(filePath);
  const copyBlockLink = async (id: string, heading?: string) => {
    try {
      if (richNote) await getDocumentController().saveDocument(filePath);
      const anchor = richNote ? id : headingSlug(heading ?? "");
      const href = `${createFileReference(filePath, useWorkspaceStore.getState().workspaceDir)}#${encodeURIComponent(anchor)}`;
      await navigator.clipboard.writeText(href);
      notify(t("connected.linkCopied"), { type: "success" });
    } catch (error) {
      notify(String(error), { type: "error" });
    }
  };
  return (
    <DocumentHostContext.Provider value={{ filePath, groupId: tab ? tabGroup(tab) : "primary" }}>
      <div
        ref={rootRef}
        className="flex flex-col h-full w-full"
        onClickCapture={(event) => {
          const anchor =
            event.target instanceof Element
              ? event.target.closest<HTMLAnchorElement>("a[href]")
              : null;
          const href = anchor?.getAttribute("href");
          if (!href) return;
          if (isLocalFileReference(href)) {
            event.preventDefault();
            event.stopPropagation();
            void openFileReference(href, filePath, {
              beside: event.ctrlKey || event.metaKey || event.shiftKey,
              groupId: tab ? tabGroup(tab) : undefined,
            }).catch((error: unknown) => notify(String(error), { type: "error" }));
          } else if (/^https?:\/\//i.test(href)) {
            event.preventDefault();
            event.stopPropagation();
            void openUrl(href).catch((error: unknown) => notify(String(error), { type: "error" }));
          }
        }}
      >
        <DocumentEditorToolbar
          richNote={richNote}
          outlineOpen={outlineOpen}
          onToggleOutline={() => setOutlineOpen((value) => !value)}
          onCopyBlockLink={() => void copyBlockLink(editor.getTextCursorPosition().block.id)}
          onSaveAsNote={async () => {
            try {
              const chosen = await saveDialog({
                defaultPath: filePath.replace(/\.[^./\\]+$/, ".note"),
                filters: [{ name: t("connected.richNote"), extensions: ["note"] }],
              });
              if (!chosen) return;
              const target = /\.note$/i.test(chosen) ? chosen : `${chosen}.note`;
              if (target === filePath) {
                await getDocumentController().saveDocument(filePath);
                return;
              }
              if (
                useTabStore.getState().tabs.some((item) => item.instanceId === target) ||
                useDocumentStore.getState().documents[target]?.isDirty
              )
                throw new Error(t("connected.targetOpen"));
              const raw = encodeDocument(target, {
                content: projectDocument(editor),
                blocks: editor.document,
                documentId: crypto.randomUUID(),
              });
              await writeTextFile(target, raw);
              useDocumentStore.getState().closeDocument(target);
              useDocumentStore.getState().openDocument(target, raw, false);
              openFileInWorkbench(target);
            } catch (error) {
              notify(String(error), { type: "error" });
            }
          }}
          onInsertDiagram={async () => {
            try {
              const workspaceDir = useWorkspaceStore.getState().workspaceDir;
              const path = await openDialog({
                multiple: false,
                defaultPath: workspaceDir ?? undefined,
                filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
              });
              if (typeof path !== "string") return;
              editor.insertBlocks(
                [
                  {
                    type: "diagramEmbed",
                    props: {
                      diagramPath: createFileReference(path, workspaceDir),
                      caption: path.split(/[\\/]/).pop() ?? "",
                    },
                  },
                ],
                editor.getTextCursorPosition().block,
                "after"
              );
            } catch (error) {
              notify(String(error), { type: "error" });
            }
          }}
          onInsertFileLink={async () => {
            try {
              const workspaceDir = useWorkspaceStore.getState().workspaceDir;
              const path = await openDialog({
                multiple: false,
                defaultPath: workspaceDir ?? undefined,
                filters: [
                  { name: "Documents and diagrams", extensions: ["md", "note", "excalidraw"] },
                ],
              });
              if (typeof path !== "string") return;
              editor.focus();
              editor.insertInlineContent([
                {
                  type: "link",
                  href: createFileReference(path, workspaceDir),
                  content: path.split(/[\\/]/).pop() ?? path,
                },
              ]);
            } catch (error) {
              notify(String(error), { type: "error" });
            }
          }}
          onExportHtml={handleExportHtml}
          onExportMarkdown={handleExportMarkdown}
        />
        <div className="flex-1 min-h-0 overflow-auto">
          <DocumentEditor
            editor={editor}
            filePath={filePath}
            content={document.content}
            blocks={document.blocks}
            externalVersion={document.externalVersion}
            onChange={handleChange}
            onInitialize={(markdown, blocks) =>
              updateEditorContent(
                filePath,
                isRichNote(filePath) ? markdown : document.content,
                blocks,
                true
              )
            }
            theme={resolvedTheme}
          />
        </div>
        {outlineOpen && (
          <DocumentOutline
            blocks={document.blocks ?? []}
            onClose={() => setOutlineOpen(false)}
            onCopy={(id, title) => void copyBlockLink(id, title)}
            onJump={(id) => {
              editor.setTextCursorPosition(id, "start");
              Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-id]") ?? [])
                .find((element) => element.dataset.id === id)
                ?.scrollIntoView({ block: "start", behavior: "smooth" });
              editor.focus();
            }}
          />
        )}
        <div
          role="status"
          className="flex h-6 shrink-0 items-center justify-end gap-2 border-t border-border/50 px-3 text-[10px] text-muted-foreground"
        >
          <span className="mr-auto">
            {t(richNote ? "connected.richNote" : "connected.markdown")}
          </span>
          {persistence.error && document.isDirty ? (
            <>
              <span className="truncate text-destructive">{tTabs("workbench.saveError")}</span>
              <button
                onClick={() => {
                  void getDocumentController()
                    .saveDocument(filePath)
                    .catch((error: unknown) => notify(String(error), { type: "error" }));
                }}
              >
                {tTabs("workbench.retry")}
              </button>
            </>
          ) : persistence.isSaving ? (
            tTabs("workbench.saving")
          ) : document.isDirty ? (
            tTabs("workbench.pendingSave")
          ) : (
            tTabs("workbench.saved")
          )}
        </div>
      </div>
    </DocumentHostContext.Provider>
  );
}
