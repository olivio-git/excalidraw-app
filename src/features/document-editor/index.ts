// BlockNote API notes (verified 2026-03-25, v0.47.3):
// - Use editor.tryParseMarkdownToBlocks(markdown) — NOT standalone markdownToBlocks
// - Use editor.blocksToMarkdownLossy() — NOT standalone blocksToMarkdownLossy
// - keepMounted: true required — editor state is destroyed on unmount
//
// No Mantine in dependency tree — do NOT add it.

import { lazy } from "react";
import type { Plugin, PluginAPI } from "@/plugins/types";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { rename as fsRename } from "@tauri-apps/plugin-fs";
import { join, dirname } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "@/stores/documentStore";
import { confirm } from "@/shared/lib/confirm";
import { prompt } from "@/shared/lib/prompt";
import i18n from "@/core/i18n/i18n";
import { getDocumentController } from "./documentController.singleton";

// Lazy-loaded container — keepMounted: true in route config preserves editor state
const DocumentEditorContainer = lazy(() => import("./DocumentEditorContainer"));

function activate(api: PluginAPI): void {
  api.registerRoutes([
    {
      id: "document-editor",
      path: "/document-editor",
      name: "Document Editor",
      type: "protected",
      component: DocumentEditorContainer,
      security: { requiresAuth: false },
      tabConfig: {
        singleton: false,
        closable: true,
        // keepMounted: true is REQUIRED — BlockNote editor state is destroyed on unmount
        keepMounted: true,
      },
      showSidebar: false,
      showInCommandPalette: false,
    },
  ]);

  // Register .md file handler
  api.registerFileHandler("md", {
    routeId: "document-editor",
    defaultExtension: "md",
    create: async (dir: string, name: string): Promise<string> => {
      const fileName = name.endsWith(".md") ? name : `${name}.md`;
      const filePath = await join(dir, fileName);
      await writeTextFile(filePath, "");
      return filePath;
    },
    displayName: (filename: string) => filename.replace(/\.md$/, ""),
  });

  // Register .note file handler
  api.registerFileHandler("note", {
    routeId: "document-editor",
    defaultExtension: "note",
    create: async (dir: string, name: string): Promise<string> => {
      const fileName = name.endsWith(".note") ? name : `${name}.note`;
      const filePath = await join(dir, fileName);
      await writeTextFile(filePath, "");
      return filePath;
    },
    displayName: (filename: string) => filename.replace(/\.note$/, ""),
  });

  // ── Commands ──────────────────────────────────────────────────────────────

  // document.new — creates a new untitled markdown document
  api.registerCommand("document.new", async () => {
    try {
      await getDocumentController().createDocument("Untitled");
    } catch (err) {
      console.error("[document.new] Create failed:", err);
    }
  });

  // document.open — opens a file picker filtered to *.md, then loads the document
  api.registerCommand("document.open", async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!selected) return;
      const filePath = typeof selected === "string" ? selected : selected;
      await getDocumentController().openDocument(filePath);
    } catch (err) {
      console.error("[document.open] Open failed:", err);
    }
  });

  // document.save — saves the active document
  api.registerCommand("document.save", async () => {
    const activeDocumentId = useDocumentStore.getState().activeDocumentId;
    if (!activeDocumentId) return;

    try {
      await getDocumentController().saveDocument(activeDocumentId);
    } catch (err) {
      console.error("[document.save] Save failed:", err);
    }
  });

  // document.saveAll — saves all dirty documents
  api.registerCommand("document.saveAll", async () => {
    const { documents } = useDocumentStore.getState();
    const dirtyPaths = Object.values(documents)
      .filter((doc) => doc.isDirty)
      .map((doc) => doc.filePath);

    for (const filePath of dirtyPaths) {
      try {
        await getDocumentController().saveDocument(filePath);
      } catch (err) {
        console.error(`[document.saveAll] Save failed for ${filePath}:`, err);
      }
    }
  });

  // document.close — closes the active document (with dirty-state guard)
  api.registerCommand("document.close", async () => {
    const { activeDocumentId, documents } = useDocumentStore.getState();
    if (!activeDocumentId) return;

    const doc = documents[activeDocumentId];
    if (!doc) return;

    if (doc.isDirty) {
      const confirmed = await confirm({
        title: i18n.t("commands:document.unsavedChanges.title"),
        description: i18n.t("commands:document.unsavedChanges.body"),
        confirmLabel: i18n.t("commands:document.unsavedChanges.confirm"),
        cancelLabel: i18n.t("commands:document.unsavedChanges.cancel"),
        variant: "destructive",
      });
      if (!confirmed) return;
    }

    useDocumentStore.getState().closeDocument(activeDocumentId);
  });

  // document.rename — renames the active document file and updates the store
  api.registerCommand("document.rename", async () => {
    const { activeDocumentId, documents } = useDocumentStore.getState();
    if (!activeDocumentId) return;

    const doc = documents[activeDocumentId];
    if (!doc) return;

    const currentName = doc.filePath.split(/[\\/]/).pop() ?? "";

    const result = await prompt({
      title: i18n.t("commands:document.rename"),
      fields: [
        {
          id: "name",
          label: i18n.t("commands:document.rename"),
          placeholder: currentName,
          defaultValue: currentName,
          required: true,
        },
      ],
    });

    if (!result) return;

    const newName = result.name.trim();
    if (!newName || newName === currentName) return;

    try {
      const parentDir = await dirname(activeDocumentId);
      const newPath = await join(parentDir, newName);

      // Rename file on disk
      await fsRename(activeDocumentId, newPath);

      // Transfer content to new path in store: open new, close old
      const content = doc.content;
      useDocumentStore.getState().closeDocument(activeDocumentId);
      useDocumentStore.getState().openDocument(newPath, content);
    } catch (err) {
      console.error("[document.rename] Rename failed:", err);
    }
  });

  // ── Keybindings ───────────────────────────────────────────────────────────

  // Ctrl+S when document editor is active saves the document
  // Note: the global Ctrl+S is already bound to diagram.action.save.
  // We register with the same key but a `when` condition so it only fires
  // when a document editor tab is active.
  api.registerKeybinding({
    commandId: "document.save",
    key: "ctrl+s",
    when: "documentEditorActive",
  });

  // Ctrl+Shift+S — save all dirty documents
  api.registerKeybinding({
    commandId: "document.saveAll",
    key: "ctrl+shift+s",
    when: "documentEditorActive",
  });
}

export const documentEditorPlugin: Plugin = {
  manifest: {
    id: "document-editor",
    name: "Document Editor",
    version: "0.1.0",
    description: "Rich text markdown editor powered by BlockNote",
    author: "excalidraw-app",
    commands: [
      { id: "document.new", name: "Document: New" },
      { id: "document.open", name: "Document: Open" },
      { id: "document.save", name: "Document: Save" },
      { id: "document.saveAll", name: "Document: Save All" },
      { id: "document.close", name: "Document: Close" },
      { id: "document.rename", name: "Document: Rename" },
    ],
  },
  activate,
};
