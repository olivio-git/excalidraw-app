import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriTabStorage } from "@/core/storage/tauri-storage";
import { RouteRegistry } from "@/core/routing/route-registry";
import { TABS_CONFIG } from "../config";
import {
  EDITOR_GROUP,
  type TabInstance,
  type EditorLayoutState,
  type EditorGroupId,
  type SplitDirection,
} from "../types";
import {
  collapseEmptyGroups,
  initialEditorLayout,
  otherGroup,
  reconcileLayout,
  tabGroup,
} from "./editor-layout";
import { useTabsSettingsStore } from "@/stores/tabsSettingsStore";

interface TabState extends EditorLayoutState {
  tabs: TabInstance[];
  activeTabId: string | null;

  addTab: (params: {
    routeId: string;
    path: string;
    title: string;
    icon?: React.ComponentType<{ className?: string }>;
    instanceId?: string;
    metadata?: Record<string, any>;
    groupId?: EditorGroupId;
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
  setActiveGroup: (groupId: EditorGroupId) => void;
  closeEmptyGroup: (groupId: EditorGroupId) => void;
  setSplitDirection: (direction: SplitDirection | null) => void;
  setSplitRatio: (ratio: number) => void;
  moveTabToGroup: (tabId: string, groupId: EditorGroupId) => void;
  openToSide: (tabId: string, sourceGroup?: EditorGroupId) => void;
  navigateHistory: (delta: number) => void;
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => {
      const commit = (update: Partial<TabState>) =>
        set((state) => {
          const next = { ...state, ...update };
          // Keep intentionally empty splits; collapse only a group emptied by this removal.
          const emptiedGroup =
            next.tabs.length < state.tabs.length &&
            Object.values(EDITOR_GROUP).some(
              (group) =>
                state.tabs.some((tab) => tabGroup(tab) === group) &&
                !next.tabs.some((tab) => tabGroup(tab) === group)
            );
          return reconcileLayout(emptiedGroup ? collapseEmptyGroups(next) : next);
        });
      return {
        ...initialEditorLayout(),
        tabs: [],
        activeTabId: null,

        addTab: ({ routeId, path, title, icon, instanceId, metadata, groupId }) => {
          const state = get();

          // Check singleton constraint
          const routeConfig = RouteRegistry.getRoute(routeId);
          if (routeConfig?.tabConfig?.singleton) {
            const existingTab = state.tabs.find((t) => t.routeId === routeId);
            if (existingTab) {
              if (groupId) get().moveTabToGroup(existingTab.id, groupId);
              else get().setActiveTab(existingTab.id);
              return existingTab.id;
            }
          }

          // Check maxInstances constraint
          if (routeConfig?.tabConfig?.maxInstances) {
            const instanceCount = state.tabs.filter((t) => t.routeId === routeId).length;
            if (instanceCount >= routeConfig.tabConfig.maxInstances) {
              const existingTab = state.tabs.find((t) => t.routeId === routeId);
              if (existingTab) {
                if (groupId) get().moveTabToGroup(existingTab.id, groupId);
                else get().setActiveTab(existingTab.id);
                return existingTab.id;
              }
            }
          }

          // Check duplicate by path + instanceId
          const existingTab = state.tabs.find(
            (tab) => tab.path === path && tab.instanceId === instanceId
          );
          if (existingTab) {
            if (groupId) get().moveTabToGroup(existingTab.id, groupId);
            else get().setActiveTab(existingTab.id);
            return existingTab.id;
          }

          // Enforce MAX_OPEN_TABS via LRU eviction
          let currentTabs = [...state.tabs];
          if (currentTabs.length >= TABS_CONFIG.MAX_OPEN_TABS) {
            const unpinnedTabs = currentTabs
              .filter(
                (t) =>
                  !t.isPinned &&
                  t.isClosable &&
                  !t.metadata?.isDirty &&
                  t.id !== state.activeTabId &&
                  !Object.values(state.groupActiveTabIds).includes(t.id)
              )
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
            groupId: groupId ?? state.activeGroupId,
          };

          commit({
            tabs: [...currentTabs, newTab],
            activeTabId: newTab.id,
            splitDirection:
              groupId === EDITOR_GROUP.SECONDARY
                ? (state.splitDirection ?? "horizontal")
                : state.splitDirection,
          });

          return newTab.id;
        },

        removeTab: (tabId: string) => {
          const state = get();
          const tab = state.tabs.find((t) => t.id === tabId);
          if (!tab || tab.isPinned || !tab.isClosable) return;

          const { allowCloseLastTab } = useTabsSettingsStore.getState();
          if (state.tabs.length === 1 && !allowCloseLastTab) return;

          const newTabs = state.tabs.filter((t) => t.id !== tabId);

          let newActiveTabId = state.activeTabId;
          if (state.activeTabId === tabId) {
            const siblings = newTabs.filter((item) => tabGroup(item) === tabGroup(tab));
            const groupIndex = state.tabs
              .filter((item) => tabGroup(item) === tabGroup(tab))
              .findIndex((item) => item.id === tabId);
            newActiveTabId = siblings[Math.min(groupIndex, siblings.length - 1)]?.id ?? null;
          }

          commit({ tabs: newTabs, activeTabId: newActiveTabId });
        },

        setActiveTab: (tabId: string) => {
          const state = get();
          const tab = state.tabs.find((t) => t.id === tabId);
          if (tab) {
            // Update openedAt for LRU tracking
            commit({
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
            commit({ tabs: pinnedTabs, activeTabId: pinnedTabs[0].id });
          } else if (allowCloseLastTab) {
            commit({ tabs: [], activeTabId: null });
          } else {
            const keepTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
            if (keepTab) {
              commit({ tabs: [keepTab], activeTabId: keepTab.id });
            }
          }
        },

        closeOtherTabs: (tabId: string) => {
          const state = get();
          const keepTabs = state.tabs.filter((t) => t.id === tabId || t.isPinned);
          commit({ tabs: keepTabs, activeTabId: tabId });
        },

        closeTabsToRight: (tabId: string) => {
          const state = get();
          const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
          if (tabIndex === -1) return;

          const keepTabs = state.tabs.filter((t, i) => i <= tabIndex || t.isPinned);
          const newActiveId = keepTabs.find((t) => t.id === state.activeTabId)
            ? state.activeTabId
            : tabId;

          commit({ tabs: keepTabs, activeTabId: newActiveId });
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
        setActiveGroup: (groupId) => {
          if (groupId === EDITOR_GROUP.SECONDARY && !get().splitDirection) return;
          commit({ activeGroupId: groupId, activeTabId: get().groupActiveTabIds[groupId] });
        },
        closeEmptyGroup: (groupId) => {
          const state = get();
          if (!state.splitDirection || state.tabs.some((tab) => tabGroup(tab) === groupId)) return;
          set(reconcileLayout(collapseEmptyGroups(state)));
        },
        setSplitDirection: (direction) => commit({ splitDirection: direction }),
        setSplitRatio: (ratio) => set({ splitRatio: Math.max(20, Math.min(80, ratio)) }),
        moveTabToGroup: (tabId, groupId) => {
          const tab = get().getTab(tabId);
          if (!tab) return;
          if (tabGroup(tab) === groupId) {
            get().setActiveTab(tabId);
            return;
          }
          commit({
            tabs: get().tabs.map((tab) => (tab.id === tabId ? { ...tab, groupId } : tab)),
            splitDirection: get().splitDirection ?? "horizontal",
            activeTabId: tabId,
          });
        },
        openToSide: (tabId, sourceGroup) =>
          get().moveTabToGroup(tabId, otherGroup(sourceGroup ?? get().activeGroupId)),
        navigateHistory: (delta) => {
          const state = get();
          const group = state.activeGroupId;
          const history = state.navigation[group];
          const index = history.index + delta;
          const id = history.entries[index];
          if (!id || !state.getTab(id)) return;
          set(
            reconcileLayout(
              {
                ...state,
                activeTabId: id,
                navigation: { ...state.navigation, [group]: { ...history, index } },
              },
              false
            )
          );
        },
      };
    },
    {
      name: "tab-storage",
      storage: createJSONStorage(() => tauriTabStorage),
      version: 2,
      migrate: (persisted) => ({ ...initialEditorLayout(), ...(persisted as Partial<TabState>) }),
      merge: (persisted, current) => {
        const restored = { ...current, ...(persisted as Partial<TabState>) };
        const tabs = restored.tabs.map((tab) => {
          const route = RouteRegistry.getRoute(tab.routeId);
          return {
            ...tab,
            icon: route?.icon,
            isClosable: tab.isClosable ?? route?.tabConfig?.closable !== false,
          };
        });
        // Normalize before publishing the hydrated snapshot to React subscribers.
        return { ...restored, ...reconcileLayout({ ...restored, tabs }) };
      },
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
          groupId: tab.groupId,
          // Omit icon - React components can't be serialized
        })),
        activeTabId: state.activeTabId,
        activeGroupId: state.activeGroupId,
        groupActiveTabIds: state.groupActiveTabIds,
        navigation: state.navigation,
        splitDirection: state.splitDirection,
        splitRatio: state.splitRatio,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.error("Tab store rehydration error:", error);
          return;
        }
      },
    }
  )
);
