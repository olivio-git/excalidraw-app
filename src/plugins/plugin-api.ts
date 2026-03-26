import {
  readDir,
  rename as fsRename,
  remove,
  mkdir,
  readTextFile,
  writeTextFile,
  stat,
} from "@tauri-apps/plugin-fs";
import { join, dirname } from "@tauri-apps/api/path";
import { RouteRegistry } from "@/core/routing/route-registry";
import { DiagramController } from "@/core/diagram/DiagramController";
import { useAuthStore } from "@/core/auth/store/auth-store";
import { fileIconRegistry } from "@/core/shell/panels/file-icon-registry";
import { fileHandlerRegistry } from "@/core/shell/panels/file-handler-registry";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { useDiagramStore } from "@/core/diagram/store/diagram-store";
import { notify } from "@/shared/lib/notify";
import { confirm } from "@/shared/lib/confirm";
import { prompt } from "@/shared/lib/prompt";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useThemeStore } from "@/stores/themeStore";
import { keybindingRegistry } from "@/core/keybindings/keybinding-registry";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { keyNormalizer } from "@/core/keybindings/key-normalizer";
import { KeybindingSource } from "@/core/keybindings/types";
import { getFileStat, copyPath } from "@/core/shell/services/file.service";
import {
  updateTabsAfterRename,
  updateTabsAfterMove,
  closeTabsForDeletedPath,
} from "@/core/shell/panels/explorer-tab-sync";
import { getDocumentController } from "@/features/document-editor/documentController.singleton";
import type {
  ActiveTabInfo,
  CommandHandler,
  DocumentAPI,
  FileStat,
  FileListEntry,
  TabInfo,
  PluginAPI,
  PluginEventHandler,
  SidebarSection,
  SidebarFooterAction,
} from "./types";
import type { KeybindingDeclaration, NormalizedKey } from "@/core/keybindings/types";
import type { RouteConfig } from "@/core/routing/types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Map a TabInstance to the public TabInfo shape. */
function toTabInfo(tab: ReturnType<typeof useTabStore.getState>["tabs"][number]): TabInfo {
  const isDirty = tab.instanceId
    ? (useDiagramStore.getState().getDiagram(tab.instanceId)?.isDirty ?? false)
    : false;
  return {
    id: tab.id,
    title: tab.title,
    filePath: tab.instanceId,
    isDirty,
    isPinned: tab.isPinned,
    routeId: tab.routeId,
  };
}

/**
 * Factory for the public PluginAPI.
 *
 * Callbacks wired by PluginManager:
 * - onRegisterEvent / emitEvent: plugin-level pub/sub event bus
 * - onRegisterKeybinding: tracks (firstKey, commandId) for cleanup on deactivation
 * - onExecuteCommand: delegates to PluginManager.executeCommand
 * - onRegisterTabChange: tracks the Zustand unsubscriber for cleanup on deactivation
 */
export function createPluginAPI(
  onRegisterSection: (section: SidebarSection) => void,
  onRegisterCommand: (commandId: string, handler: CommandHandler) => void,
  onRegisterRoute: (routeId: string) => void,
  onRegisterFooterAction: (action: SidebarFooterAction) => void,
  onRegisterEvent: (topic: string, handler: PluginEventHandler) => () => void,
  emitEvent: (topic: string, payload?: unknown) => void,
  pluginId: string,
  onRegisterKeybinding: (firstKey: NormalizedKey, commandId: string) => void,
  onExecuteCommand: (commandId: string) => Promise<void>,
  onRegisterTabChange: (unsub: () => void) => void
): PluginAPI {
  return {
    registerRoutes: (routes: RouteConfig[]) => {
      RouteRegistry.register(routes);
      for (const route of routes) {
        onRegisterRoute(route.id);
      }
    },

    registerSidebarSection: (section: SidebarSection) => {
      onRegisterSection(section);
    },

    registerCommand: (commandId: string, handler: CommandHandler) => {
      onRegisterCommand(commandId, handler);
    },

    notify: (message, options) => {
      notify(message, options);
    },

    confirm: (options) => confirm(options),

    prompt: (options) => prompt(options),

    getAuthState: () => {
      const state = useAuthStore.getState();
      return {
        isAuthenticated: state.isAuthenticated,
        user: state.user,
      };
    },

    getActiveTab: () => {
      const { tabs, activeTabId } = useTabStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return null;
      return {
        tabId: tab.id,
        routeId: tab.routeId,
        title: tab.title,
        path: tab.path,
        instanceId: tab.instanceId,
        metadata: tab.metadata as Record<string, unknown> | undefined,
      };
    },

    getWorkspaceDir: () => {
      return useWorkspaceStore.getState().workspaceDir;
    },

    registerFileIcon: (extension, icon) => {
      fileIconRegistry.register(extension, icon);
    },

    registerFileHandler: (extension, handler) => {
      fileHandlerRegistry.register(extension, handler);
    },

    registerSettingsAction: (action: SidebarFooterAction) => {
      onRegisterFooterAction(action);
    },

    registerSidebarFooterAction: (action: SidebarFooterAction) => {
      onRegisterFooterAction(action);
    },

    onEvent: (topic: string, handler: PluginEventHandler) => {
      return onRegisterEvent(topic, handler);
    },

    emitEvent: (topic: string, payload?: unknown) => {
      emitEvent(topic, payload);
    },

    registerKeybinding: (declaration: KeybindingDeclaration) => {
      const chord = keyNormalizer.normalizeChord(declaration.key);
      const firstKey = chord[0];
      keybindingRegistry.registerDefault({
        commandId: declaration.commandId,
        chord,
        when: declaration.when,
        source: KeybindingSource.Plugin,
      });
      onRegisterKeybinding(firstKey, declaration.commandId);
    },

    registerContext: (key: string, value: boolean | string | number) => {
      contextKeyService.set(key, value);
    },

    openFile: (filePath: string) => {
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      const handler = fileHandlerRegistry.resolveOrDefault(name);
      const title = handler.displayName ? handler.displayName(name) : name;
      useTabStore.getState().addTab({
        routeId: handler.routeId,
        path: `/${handler.routeId}`,
        title,
        instanceId: filePath,
        metadata: { filePath },
      });
    },

    executeCommand: (commandId: string) => {
      return onExecuteCommand(commandId);
    },

    onTabChange: (handler: (tab: ActiveTabInfo | null) => void) => {
      const toInfo = (state: ReturnType<typeof useTabStore.getState>): ActiveTabInfo | null => {
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (!tab) return null;
        return {
          tabId: tab.id,
          routeId: tab.routeId,
          title: tab.title,
          path: tab.path,
          instanceId: tab.instanceId,
          metadata: tab.metadata as Record<string, unknown> | undefined,
        };
      };

      // Call immediately with current state
      handler(toInfo(useTabStore.getState()));

      // Subscribe to future changes — only fire when activeTabId actually changes
      let prevActiveTabId = useTabStore.getState().activeTabId;
      const unsub = useTabStore.subscribe((state) => {
        if (state.activeTabId !== prevActiveTabId) {
          prevActiveTabId = state.activeTabId;
          handler(toInfo(state));
        }
      });

      onRegisterTabChange(unsub);
      return unsub;
    },

    getTheme: () => {
      return useThemeStore.getState().resolvedTheme;
    },

    diagram: {
      getElements() {
        const id = DiagramController.getActiveInstanceId();
        return id ? DiagramController.getElements(id) : [];
      },
      addElements(elements) {
        const id = DiagramController.getActiveInstanceId();
        if (id) DiagramController.addElements(id, elements);
      },
      setElements(elements) {
        const id = DiagramController.getActiveInstanceId();
        if (id) DiagramController.setElements(id, elements);
      },
      updateScene(sceneData) {
        const id = DiagramController.getActiveInstanceId();
        if (id) DiagramController.updateScene(id, sceneData);
      },
      scrollToContent() {
        const id = DiagramController.getActiveInstanceId();
        if (id) DiagramController.scrollToContent(id);
      },
      getApi(instanceId) {
        return DiagramController.getApi(instanceId);
      },
      waitForInstance(instanceId, timeoutMs) {
        return DiagramController.waitForInstance(instanceId, timeoutMs);
      },
    },

    // -------------------------------------------------------------------------
    // files sub-API
    // -------------------------------------------------------------------------
    files: {
      stat(path: string): Promise<FileStat> {
        return getFileStat(path);
      },

      async list(
        dirPath: string,
        options?: { recursive?: boolean; showDotfiles?: boolean }
      ): Promise<FileListEntry[]> {
        const recursive = options?.recursive ?? false;
        const showDotfiles = options?.showDotfiles ?? false;

        const listDir = async (dir: string): Promise<FileListEntry[]> => {
          const entries = await readDir(dir);
          const result: FileListEntry[] = [];
          for (const entry of entries) {
            if (!entry.name) continue;
            if (!showDotfiles && entry.name.startsWith(".")) continue;
            const entryPath = await join(dir, entry.name);
            let size: number | undefined;
            let mtime: number | null | undefined;
            try {
              const info = await stat(entryPath);
              size = info.size ?? 0;
              mtime =
                info.mtime instanceof Date
                  ? info.mtime.getTime()
                  : typeof info.mtime === "number"
                    ? info.mtime
                    : null;
            } catch {
              // stat failed — omit size/mtime
            }
            result.push({
              path: entryPath,
              name: entry.name,
              isDir: entry.isDirectory,
              size,
              mtime,
            });
            if (recursive && entry.isDirectory) {
              const children = await listDir(entryPath);
              result.push(...children);
            }
          }
          return result;
        };

        return listDir(dirPath);
      },

      async copy(
        srcPath: string,
        destPath: string,
        options?: { overwrite?: boolean }
      ): Promise<void> {
        await copyPath(srcPath, destPath, options?.overwrite ?? false);
      },

      async move(srcPath: string, destPath: string): Promise<void> {
        await fsRename(srcPath, destPath);
        updateTabsAfterMove(srcPath, destPath);
      },

      async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
        closeTabsForDeletedPath(path);
        await remove(path, { recursive: options?.recursive ?? false });
      },

      async rename(oldPath: string, newName: string): Promise<string> {
        const parentDir = await dirname(oldPath);
        const newPath = await join(parentDir, newName);
        await fsRename(oldPath, newPath);
        updateTabsAfterRename(oldPath, newPath);
        return newPath;
      },

      async createFolder(dirPath: string): Promise<void> {
        await mkdir(dirPath, { recursive: true });
      },

      async createFile(dirPath: string, name: string): Promise<string> {
        const handler = fileHandlerRegistry.resolveOrDefault(name);
        return handler.create(dirPath, name);
      },

      async readText(path: string): Promise<string> {
        return readTextFile(path);
      },

      async writeText(path: string, content: string): Promise<void> {
        await writeTextFile(path, content);
      },
    },

    // -------------------------------------------------------------------------
    // document sub-API
    // -------------------------------------------------------------------------
    get document(): DocumentAPI {
      return getDocumentController();
    },

    // -------------------------------------------------------------------------
    // tabs sub-API
    // -------------------------------------------------------------------------
    tabs: {
      getActive(): TabInfo | null {
        const { tabs, activeTabId } = useTabStore.getState();
        const tab = tabs.find((t) => t.id === activeTabId);
        return tab ? toTabInfo(tab) : null;
      },

      list(): TabInfo[] {
        return useTabStore.getState().tabs.map(toTabInfo);
      },

      open(filePath: string): void {
        const name = filePath.split(/[\\/]/).pop() ?? filePath;
        const handler = fileHandlerRegistry.resolveOrDefault(name);
        const title = handler.displayName ? handler.displayName(name) : name;
        useTabStore.getState().addTab({
          routeId: handler.routeId,
          path: `/${handler.routeId}`,
          title,
          instanceId: filePath,
          metadata: { filePath },
        });
      },

      close(tabId: string, options?: { force?: boolean }): boolean {
        const { tabs } = useTabStore.getState();
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab) return false;
        if (tab.isPinned && !options?.force) return false;
        if (!tab.isClosable && !options?.force) return false;
        if (tabs.length === 1) return false;
        useTabStore.getState().removeTab(tabId);
        return true;
      },

      activate(tabId: string): boolean {
        const tab = useTabStore.getState().getTab(tabId);
        if (!tab) return false;
        useTabStore.getState().setActiveTab(tabId);
        return true;
      },

      async save(tabId?: string): Promise<boolean> {
        const { tabs, activeTabId } = useTabStore.getState();
        const resolvedId = tabId ?? activeTabId;
        const tab = tabs.find((t) => t.id === resolvedId);
        if (!tab?.instanceId) return false;
        const api = DiagramController.getApi(tab.instanceId);
        if (!api) return false;
        try {
          await useDiagramStore
            .getState()
            .saveDiagram(tab.instanceId, api.getSceneElements(), api.getAppState(), api.getFiles());
          return true;
        } catch {
          return false;
        }
      },

      async saveAll(): Promise<{ saved: number; failed: number }> {
        const { tabs } = useTabStore.getState();
        const dirtyDiagramTabs = tabs.filter(
          (t) =>
            t.instanceId && useDiagramStore.getState().getDiagram(t.instanceId)?.isDirty === true
        );
        let saved = 0;
        let failed = 0;
        for (const tab of dirtyDiagramTabs) {
          const instanceId = tab.instanceId!;
          const api = DiagramController.getApi(instanceId);
          if (!api) {
            failed++;
            continue;
          }
          try {
            await useDiagramStore
              .getState()
              .saveDiagram(instanceId, api.getSceneElements(), api.getAppState(), api.getFiles());
            saved++;
          } catch {
            failed++;
          }
        }
        return { saved, failed };
      },

      onChange(handler: (tab: TabInfo | null) => void): () => void {
        const toInfo = (state: ReturnType<typeof useTabStore.getState>): TabInfo | null => {
          const tab = state.tabs.find((t) => t.id === state.activeTabId);
          return tab ? toTabInfo(tab) : null;
        };

        // Call immediately with current state
        handler(toInfo(useTabStore.getState()));

        // Subscribe to future changes — only fire when activeTabId changes
        let prevActiveTabId = useTabStore.getState().activeTabId;
        const unsub = useTabStore.subscribe((state) => {
          if (state.activeTabId !== prevActiveTabId) {
            prevActiveTabId = state.activeTabId;
            handler(toInfo(state));
          }
        });

        onRegisterTabChange(unsub);
        return unsub;
      },
    },
  };
}
