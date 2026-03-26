import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCreateBlockNote } from "@blocknote/react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useDocumentStore } from "@/stores/documentStore";
import { useThemeStore } from "@/stores/themeStore";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import { DocumentEditor } from "./DocumentEditor";
import { DocumentEditorToolbar } from "./DocumentEditorToolbar";
import { useDocumentPersistence } from "./hooks/useDocumentPersistence";
import { getDocumentController } from "./documentController.singleton";
import { documentSchema } from "./documentSchema";
import { documentEditorRegistry } from "./documentEditorRegistry";

// ---------------------------------------------------------------------------
// DocumentEditorContainer — smart container
//
// Route: registered as "document-editor" with keepMounted: true
// filePath is stored in tab.instanceId (and tab.metadata.filePath)
// ---------------------------------------------------------------------------

export default function DocumentEditorContainer() {
  const { t } = useTranslation("common");
  const { tabId } = useTabContext();
  const tab = useTabStore((s) => s.getTab(tabId));

  // Editor instance lives here so export handlers can call editor APIs directly.
  // keepMounted: true in route config ensures this component stays alive.
  const editor = useCreateBlockNote({ schema: documentSchema });

  // filePath is the document identifier — stored as instanceId by the file handler
  const filePath = (tab?.instanceId ?? tab?.metadata?.filePath ?? "") as string;

  const document = useDocumentStore((s) => (filePath ? s.documents[filePath] : undefined));
  const updateContent = useDocumentStore((s) => s.updateContent);
  const setActive = useDocumentStore((s) => s.setActive);

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  // Auto-save side effects — return value not needed (toolbar no longer shows save status)
  useDocumentPersistence(filePath);

  // ── Register editor instance for MCP bridge access ───────────────────────
  useEffect(() => {
    if (!filePath) return;
    documentEditorRegistry.register(filePath, editor);
    return () => {
      documentEditorRegistry.unregister(filePath);
    };
  }, [filePath, editor]);

  // ── Mount: open document if not already in store ─────────────────────────
  useEffect(() => {
    if (!filePath) return;

    // Activate this document in the store
    setActive(filePath);

    // If not loaded yet, open it from disk
    const alreadyOpen = useDocumentStore.getState().documents[filePath];
    if (!alreadyOpen) {
      getDocumentController()
        .openDocument(filePath)
        .catch((err: unknown) => {
          console.error("[DocumentEditorContainer] Failed to open document:", err);
        });
    }
  }, [filePath, setActive]);

  // ── Sync tab title from document store ───────────────────────────────────
  // Task 2.7: update tab title when document loads
  useEffect(() => {
    if (!document?.title || !tab) return;
    if (tab.title !== document.title) {
      useTabStore.getState().updateTab(tabId, { title: document.title });
    }
  }, [document?.title, tab, tabId]);

  // ── onChange: update store (persistence hook handles auto-save) ──────────
  const handleChange = (markdown: string) => {
    if (!filePath) return;
    updateContent(filePath, markdown);
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

  // ── Unsaved-changes guard ─────────────────────────────────────────────────
  // Task 2.8: Warn on tab close if dirty
  // NOTE: There is no useBeforeTabClose hook in the current tab system.
  // The tab store's removeTab fires without a pre-close hook.
  // Implementing a browser beforeunload guard as a fallback, plus a TODO.
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

  // TODO (Phase 3): Hook into tab close event to show confirm() dialog before close.
  // Currently the tab store's removeTab does not emit a pre-close event.
  // Proposed: add a `onBeforeRemove` callback to TabInstance that the tab system
  // invokes before removing. If it returns false, the remove is cancelled.
  // When that exists, implement:
  //
  // useBeforeTabClose(tabId, async () => {
  //   if (!useDocumentStore.getState().documents[filePath]?.isDirty) return true;
  //   return await confirm({
  //     title: t("document.unsavedChanges.title"),
  //     description: t("document.unsavedChanges.description"),
  //     confirmLabel: t("document.unsavedChanges.discard"),
  //     variant: "destructive",
  //   });
  // });

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No document selected
      </div>
    );
  }

  if (!document) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <DocumentEditorToolbar
        onExportHtml={handleExportHtml}
        onExportMarkdown={handleExportMarkdown}
      />
      <div className="flex-1 min-h-0">
        <DocumentEditor
          editor={editor}
          content={document.content}
          externalVersion={document.externalVersion}
          onChange={handleChange}
          theme={resolvedTheme}
        />
      </div>
    </div>
  );
}

// Suppress unused import warning — confirm is used in the TODO comment above
void confirm;
