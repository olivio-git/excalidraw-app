import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriTabStorage } from "@/core/storage/tauri-storage";
import { RouteRegistry } from "@/core/routing/route-registry";
import { TABS_CONFIG } from "../config";
import type { TabInstance } from "../types";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";

interface TabState {
  tabs: TabInstance[];
  activeTabId: string | null;

  addTab: (params: {
    routeId: string;
    path: string;
    title: string;
    icon?: React.ComponentType<{ className?: string }>;
    instanceId?: string;
    metadata?: Record<string, any>;
  }) => string;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<TabInstance>) => void;
  closeAllTabs: () => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  pinTab: (tabId: string) => void;
  unpinTab: (tabId: string) => void;
  getTab: (tabId: string) => TabInstance | undefined;
  findTabByPath: (path: string, instanceId?: string) => TabInstance | undefined;
  findTabByRouteId: (routeId: string) => TabInstance | undefined;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      addTab: ({ routeId, path, title, icon, instanceId, metadata }) => {
        const state = get();

        // Check singleton constraint
        const routeConfig = RouteRegistry.getRoute(routeId);
        if (routeConfig?.tabConfig?.singleton) {
          const existingTab = state.tabs.find((t) => t.routeId === routeId);
          if (existingTab) {
            set({ activeTabId: existingTab.id });
            return existingTab.id;
          }
        }

        // Check maxInstances constraint
        if (routeConfig?.tabConfig?.maxInstances) {
          const instanceCount = state.tabs.filter((t) => t.routeId === routeId).length;
          if (instanceCount >= routeConfig.tabConfig.maxInstances) {
            const existingTab = state.tabs.find((t) => t.routeId === routeId);
            if (existingTab) {
              set({ activeTabId: existingTab.id });
              return existingTab.id;
            }
          }
        }

        // Check duplicate by path + instanceId
        const existingTab = state.tabs.find(
          (tab) => tab.path === path && tab.instanceId === instanceId
        );
        if (existingTab) {
          set({ activeTabId: existingTab.id });
          return existingTab.id;
        }

        // Enforce MAX_OPEN_TABS via LRU eviction
        let currentTabs = [...state.tabs];
        if (currentTabs.length >= TABS_CONFIG.MAX_OPEN_TABS) {
          const unpinnedTabs = currentTabs
            .filter((t) => !t.isPinned && t.id !== state.activeTabId)
            .sort((a, b) => a.openedAt - b.openedAt);

          if (unpinnedTabs.length > 0) {
            const toRemove = unpinnedTabs[0];
            currentTabs = currentTabs.filter((t) => t.id !== toRemove.id);
          }
        }

        const isClosable = routeConfig?.tabConfig?.closable !== false;

        const newTab: TabInstance = {
          id: `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          routeId,
          path,
          title,
          icon,
          isPinned: false,
          isClosable,
          scrollPosition: 0,
          metadata: metadata || {},
          instanceId,
          openedAt: Date.now(),
        };

        set({
          tabs: [...currentTabs, newTab],
          activeTabId: newTab.id,
        });

        return newTab.id;
      },

      removeTab: (tabId: string) => {
        const state = get();
        const tab = state.tabs.find((t) => t.id === tabId);
        if (!tab || tab.isPinned || !tab.isClosable) return;

        const { allowCloseLastTab } = useTabsSettingsStore.getState();
        if (state.tabs.length === 1 && !allowCloseLastTab) return;

        const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
        const newTabs = state.tabs.filter((t) => t.id !== tabId);

        let newActiveTabId = state.activeTabId;
        if (state.activeTabId === tabId) {
          const newIndex = tabIndex < newTabs.length ? tabIndex : tabIndex - 1;
          newActiveTabId = newTabs[newIndex]?.id ?? null;
        }

        set({ tabs: newTabs, activeTabId: newActiveTabId });
      },

      setActiveTab: (tabId: string) => {
        const state = get();
        const tab = state.tabs.find((t) => t.id === tabId);
        if (tab) {
          // Update openedAt for LRU tracking
          set({
            activeTabId: tabId,
            tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, openedAt: Date.now() } : t)),
          });
        }
      },

      updateTab: (tabId: string, updates: Partial<TabInstance>) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...updates } : tab)),
        }));
      },

      closeAllTabs: () => {
        const state = get();
        const pinnedTabs = state.tabs.filter((t) => t.isPinned);
        const { allowCloseLastTab } = useTabsSettingsStore.getState();

        if (pinnedTabs.length > 0) {
          set({ tabs: pinnedTabs, activeTabId: pinnedTabs[0].id });
        } else if (allowCloseLastTab) {
          set({ tabs: [], activeTabId: null });
        } else {
          const keepTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
          if (keepTab) {
            set({ tabs: [keepTab], activeTabId: keepTab.id });
          }
        }
      },

      closeOtherTabs: (tabId: string) => {
        const state = get();
        const keepTabs = state.tabs.filter((t) => t.id === tabId || t.isPinned);
        set({ tabs: keepTabs, activeTabId: tabId });
      },

      closeTabsToRight: (tabId: string) => {
        const state = get();
        const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
        if (tabIndex === -1) return;

        const keepTabs = state.tabs.filter((t, i) => i <= tabIndex || t.isPinned);
        const newActiveId = keepTabs.find((t) => t.id === state.activeTabId)
          ? state.activeTabId
          : tabId;

        set({ tabs: keepTabs, activeTabId: newActiveId });
      },

      pinTab: (tabId: string) => {
        set((state) => {
          const tabs = [...state.tabs];
          const tabIndex = tabs.findIndex((t) => t.id === tabId);
          if (tabIndex === -1) return state;

          const tab = { ...tabs[tabIndex], isPinned: true };
          tabs.splice(tabIndex, 1);

          // Insert after last pinned tab
          const lastPinnedIndex = tabs.findLastIndex((t) => t.isPinned);
          tabs.splice(lastPinnedIndex + 1, 0, tab);

          return { tabs };
        });
      },

      unpinTab: (tabId: string) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, isPinned: false } : tab)),
        }));
      },

      getTab: (tabId: string) => {
        return get().tabs.find((tab) => tab.id === tabId);
      },

      findTabByPath: (path: string, instanceId?: string) => {
        return get().tabs.find((tab) => tab.path === path && tab.instanceId === instanceId);
      },

      findTabByRouteId: (routeId: string) => {
        return get().tabs.find((tab) => tab.routeId === routeId);
      },

      reorderTabs: (fromIndex: number, toIndex: number) => {
        set((state) => {
          const newTabs = [...state.tabs];
          const [movedTab] = newTabs.splice(fromIndex, 1);
          newTabs.splice(toIndex, 0, movedTab);
          return { tabs: newTabs };
        });
      },
    }),
    {
      name: "tab-storage",
      storage: createJSONStorage(() => tauriTabStorage),
      version: 1,
      partialize: (state) => ({
        tabs: state.tabs.map((tab) => ({
          id: tab.id,
          routeId: tab.routeId,
          path: tab.path,
          title: tab.title,
          isPinned: tab.isPinned,
          isClosable: tab.isClosable,
          scrollPosition: tab.scrollPosition,
          metadata: tab.metadata,
          instanceId: tab.instanceId,
          openedAt: tab.openedAt,
          // Omit icon - React components can't be serialized
        })),
        activeTabId: state.activeTabId,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("Tab store rehydration error:", error);
          return;
        }
        if (state) {
          // Resolve icons from RouteRegistry after rehydration
          const resolvedTabs = state.tabs.map((tab) => {
            const route = RouteRegistry.getRoute(tab.routeId);
            return {
              ...tab,
              icon: route?.icon,
              isClosable: tab.isClosable ?? route?.tabConfig?.closable !== false,
            };
          });
          state.tabs = resolvedTabs;
        }
      },
    }
  )
);
