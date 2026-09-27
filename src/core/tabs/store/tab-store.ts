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
  /**
   * Last activation time per tab id, for LRU eviction. Kept outside `tabs` so
   * switching tabs doesn't replace the array and re-render every `tabs`
   * subscriber (explorer, toolbars…). Falls back to `openedAt`.
   */
  lastActivatedAt: Record<string, number>;

  addTab: (params: {
    routeId: string;
    path: string;
    title: string;
    icon?: React.ComponentType<{ className?: string }>;
    instanceId?: string;
    metadata?: Record<string, any>;
    groupId?: EditorGroupId;
    /** Open as a preview tab, replacing the group's current preview tab. */
    preview?: boolean;
  }) => string;
  /** Turn a preview tab into a normal one. */
  keepTab: (tabId: string) => void;
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
        lastActivatedAt: {},

        addTab: ({ routeId, path, title, icon, instanceId, metadata, groupId, preview }) => {
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
            // Opening a previewed file "for real" (e.g. double-click) keeps it.
            if (!preview && existingTab.isPreview) get().keepTab(existingTab.id);
            if (groupId) get().moveTabToGroup(existingTab.id, groupId);
            else get().setActiveTab(existingTab.id);
            return existingTab.id;
          }

          let currentTabs = [...state.tabs];
          const targetGroup = groupId ?? state.activeGroupId;
          // A new preview takes the place of the group's clean preview tab.
          let insertBeforeId: string | undefined;
          if (preview) {
            const index = currentTabs.findIndex(
              (tab) =>
                tab.isPreview &&
                !tab.isPinned &&
                !tab.metadata?.isDirty &&
                tabGroup(tab) === targetGroup
            );
            if (index >= 0) {
              insertBeforeId = currentTabs[index + 1]?.id;
              currentTabs.splice(index, 1);
            }
          }

          // Enforce MAX_OPEN_TABS via LRU eviction
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
              .sort(
                (a, b) =>
                  (state.lastActivatedAt[a.id] ?? a.openedAt) -
                  (state.lastActivatedAt[b.id] ?? b.openedAt)
              );

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
            groupId: targetGroup,
            isPreview: preview || undefined,
          };

          const insertAt = insertBeforeId
            ? currentTabs.findIndex((tab) => tab.id === insertBeforeId)
            : -1;
          commit({
            tabs:
              insertAt >= 0
                ? [...currentTabs.slice(0, insertAt), newTab, ...currentTabs.slice(insertAt)]
                : [...currentTabs, newTab],
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
          if (state.activeTabId === tabId) return;
          const tab = state.tabs.find((t) => t.id === tabId);
          if (tab) {
            // LRU tracking without touching `tabs` (see lastActivatedAt).
            commit({
              activeTabId: tabId,
              lastActivatedAt: { ...state.lastActivatedAt, [tabId]: Date.now() },
            });
          }
        },

        updateTab: (tabId: string, updates: Partial<TabInstance>) => {
          set((state) => ({
            tabs: state.tabs.map((tab) => {
              if (tab.id !== tabId) return tab;
              const next = { ...tab, ...updates };
              // Editing a preview tab keeps it.
              if (next.isPreview && next.metadata?.isDirty) next.isPreview = undefined;
              return next;
            }),
          }));
        },
        keepTab: (tabId: string) => {
          if (!get().getTab(tabId)?.isPreview) return;
          set((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === tabId ? { ...tab, isPreview: undefined } : tab
            ),
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

            const tab = { ...tabs[tabIndex], isPinned: true, isPreview: undefined };
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
            newTabs.splice(toIndex, 0, { ...movedTab, isPreview: undefined });
            return { tabs: newTabs };
          });
        },
        setActiveGroup: (groupId) => {
          const state = get();
          if (groupId === EDITOR_GROUP.SECONDARY && !state.splitDirection) return;
          if (
            state.activeGroupId === groupId &&
            state.activeTabId === state.groupActiveTabIds[groupId]
          )
            return;
          commit({ activeGroupId: groupId, activeTabId: state.groupActiveTabIds[groupId] });
        },
        closeEmptyGroup: (groupId) => {
          const state = get();
          if (!state.splitDirection || state.tabs.some((tab) => tabGroup(tab) === groupId)) return;
          set(reconcileLayout(collapseEmptyGroups(state)));
        },
        setSplitDirection: (direction) => {
          if (get().splitDirection !== direction) commit({ splitDirection: direction });
        },
        setSplitRatio: (ratio) => {
          const next = Math.max(20, Math.min(80, ratio));
          if (Number.isFinite(next) && get().splitRatio !== next) set({ splitRatio: next });
        },
        moveTabToGroup: (tabId, groupId) => {
          const tab = get().getTab(tabId);
          if (!tab) return;
          if (tabGroup(tab) === groupId) {
            get().setActiveTab(tabId);
            return;
          }
          commit({
            tabs: get().tabs.map((tab) =>
              tab.id === tabId ? { ...tab, groupId, isPreview: undefined } : tab
            ),
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
          isPreview: tab.isPreview,
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
