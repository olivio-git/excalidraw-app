// BlockNote API notes (verified 2026-03-25, v0.47.3):
// - Use editor.tryParseMarkdownToBlocks(markdown) — NOT standalone markdownToBlocks
// - Use editor.blocksToMarkdownLossy() — NOT standalone blocksToMarkdownLossy
// - keepMounted: true required — editor state is destroyed on unmount
//
// No Mantine in dependency tree — do NOT add it.

import { lazy } from "react";
import type { Plugin, PluginAPI } from "@/plugins/types";
import { writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { rename as fsRename } from "@tauri-apps/plugin-fs";
import { join, dirname } from "@tauri-apps/api/path";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "@/stores/documentStore";
import { requestCloseTab, prepareResourceMove } from "@/core/tabs/tab-lifecycle";
import { updateTabsAfterRename } from "@/core/shell/panels/explorer-tab-sync";
import { prompt } from "@/shared/lib/prompt";
import i18n from "@/core/i18n/i18n";
import { getDocumentController } from "./documentController.singleton";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { createEmptyNote } from "./note-format";
import { notify } from "@/shared/lib/notify";
import { isValidEntryName } from "@/core/shell/panels/explorer-file-operations";

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
      const fileName = /\.md$/i.test(name) ? name : `${name}.md`;
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
      const fileName = /\.note$/i.test(name) ? name : `${name}.note`;
      const filePath = await join(dir, fileName);
      await writeTextFile(filePath, createEmptyNote());
      return filePath;
    },
    displayName: (filename: string) => filename.replace(/\.note$/, ""),
  });

  // ── Commands ──────────────────────────────────────────────────────────────

  api.registerCommand("document.newNote", async () => {
    try {
      const chosen = await saveDialog({
        defaultPath: "Untitled.note",
        filters: [{ name: i18n.t("common:connected.richNote"), extensions: ["note"] }],
      });
      if (!chosen) return;
      const path = /\.note$/i.test(chosen) ? chosen : `${chosen}.note`;
      if (
        useTabStore.getState().tabs.some((tab) => tab.instanceId === path) ||
        useDocumentStore.getState().documents[path]?.isDirty
      )
        throw new Error(i18n.t("common:connected.targetOpen"));
      await writeTextFile(path, createEmptyNote());
      useDocumentStore.getState().closeDocument(path);
      api.openFile(path);
    } catch (error) {
      notify(String(error), { type: "error" });
    }
  });

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
    const state = useTabStore.getState();
    const activeTab = state.activeTabId ? state.getTab(state.activeTabId) : undefined;
    const activeDocumentId =
      activeTab?.routeId === "document-editor" ? activeTab.instanceId : undefined;
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

  // document.close — share the same save-before-close path as the tab bar.
  api.registerCommand("document.close", async () => {
    const state = useTabStore.getState();
    const tab = state.activeTabId ? state.getTab(state.activeTabId) : undefined;
    if (tab?.routeId === "document-editor") await requestCloseTab(tab.id);
  });

  // document.rename — renames the active document file and updates the store
  api.registerCommand("document.rename", async () => {
    const tabs = useTabStore.getState();
    const activeTab = tabs.activeTabId ? tabs.getTab(tabs.activeTabId) : undefined;
    const activeDocumentId =
      activeTab?.routeId === "document-editor" ? activeTab.instanceId : undefined;
    const { documents } = useDocumentStore.getState();
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
      if (!isValidEntryName(newName)) throw new Error(i18n.t("explorer:input.invalidName"));
      const extension = /\.note$/i.test(currentName) ? ".note" : ".md";
      const requestedExtension = newName.match(/\.(md|note)$/i)?.[0];
      if (requestedExtension && requestedExtension.toLowerCase() !== extension)
        throw new Error(i18n.t("common:connected.renameFormat"));
      const finalName = requestedExtension ? newName : `${newName}${extension}`;
      const parentDir = await dirname(activeDocumentId);
      const newPath = await join(parentDir, finalName);
      if (newPath === activeDocumentId) return;
      if (await exists(newPath))
        throw new Error(i18n.t("explorer:input.exists", { name: finalName }));

      // Rename file on disk
      await prepareResourceMove(activeDocumentId);
      await fsRename(activeDocumentId, newPath);
      updateTabsAfterRename(activeDocumentId, newPath);
    } catch (err) {
      notify(String(err), { type: "error" });
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
    allowInInput: true,
  });

  // Ctrl+Shift+S — save all dirty documents
  api.registerKeybinding({
    commandId: "document.saveAll",
    key: "ctrl+shift+s",
    when: "documentEditorActive",
    allowInInput: true,
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
      { id: "document.newNote", name: "Document: New rich note" },
      { id: "document.open", name: "Document: Open" },
      { id: "document.save", name: "Document: Save" },
      { id: "document.saveAll", name: "Document: Save All" },
      { id: "document.close", name: "Document: Close" },
      { id: "document.rename", name: "Document: Rename" },
    ],
  },
  activate,
};
