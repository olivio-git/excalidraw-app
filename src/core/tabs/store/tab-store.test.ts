import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { useTabStore } from "./tab-store";
import { RouteRegistry } from "@/core/routing/route-registry";
import type { RouteConfig } from "@/core/routing/types";
import { TABS_CONFIG } from "../config";
import { initialEditorLayout } from "./editor-layout";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRoute = (
  overrides: Partial<RouteConfig> & { id: string; name: string }
): RouteConfig => ({
  type: "public",
  security: { requiresAuth: false },
  ...overrides,
});

const addTabParams = (overrides: {
  routeId?: string;
  path?: string;
  title?: string;
  instanceId?: string;
}) => ({
  routeId: overrides.routeId ?? "route-default",
  path: overrides.path ?? "/default",
  title: overrides.title ?? "Default",
  instanceId: overrides.instanceId,
});

// ---------------------------------------------------------------------------
// State reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  RouteRegistry.clear();
  // Reset the editor layout too, so a test that moves tabs between groups
  // doesn't leak its active group into the next one.
  useTabStore.setState({
    ...initialEditorLayout(),
    tabs: [],
    activeTabId: null,
    lastActivatedAt: {},
  });
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("TabStore", () => {
  // -------------------------------------------------------------------------
  // addTab — basic
  // -------------------------------------------------------------------------
  describe("addTab - basic", () => {
    it("adds a new tab and returns its id", () => {
      const id = useTabStore.getState().addTab({
        routeId: "home",
        path: "/home",
        title: "Home",
      });

      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      const { tabs } = useTabStore.getState();
      expect(tabs).toHaveLength(1);
    });

    it("added tab becomes the active tab", () => {
      const id = useTabStore.getState().addTab({
        routeId: "home",
        path: "/home",
        title: "Home",
      });

      expect(useTabStore.getState().activeTabId).toBe(id);
    });

    it("adds tab with correct fields (routeId, path, title, isPinned=false, isClosable=true)", () => {
      useTabStore.getState().addTab({
        routeId: "home",
        path: "/home",
        title: "Home",
      });

      const { tabs } = useTabStore.getState();
      const tab = tabs[0];
      expect(tab.routeId).toBe("home");
      expect(tab.path).toBe("/home");
      expect(tab.title).toBe("Home");
      expect(tab.isPinned).toBe(false);
      expect(tab.isClosable).toBe(true);
    });

    it("multiple tabs can be added", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });
      useTabStore.getState().addTab({ routeId: "r3", path: "/c", title: "C" });

      expect(useTabStore.getState().tabs).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // addTab — singleton constraint
  // -------------------------------------------------------------------------
  describe("addTab - singleton constraint", () => {
    it("when route has tabConfig.singleton=true and tab exists, activates existing tab (no duplicate)", () => {
      RouteRegistry.register([
        makeRoute({
          id: "settings",
          name: "Settings",
          path: "/settings",
          tabConfig: { singleton: true },
        }),
      ]);

      useTabStore.getState().addTab({ routeId: "settings", path: "/settings", title: "Settings" });
      useTabStore.getState().addTab({ routeId: "settings", path: "/settings", title: "Settings" });

      expect(useTabStore.getState().tabs).toHaveLength(1);
    });

    it("singleton: returned id is the existing tab id", () => {
      RouteRegistry.register([
        makeRoute({
          id: "settings",
          name: "Settings",
          path: "/settings",
          tabConfig: { singleton: true },
        }),
      ]);

      const firstId = useTabStore.getState().addTab({
        routeId: "settings",
        path: "/settings",
        title: "Settings",
      });
      const secondId = useTabStore.getState().addTab({
        routeId: "settings",
        path: "/settings",
        title: "Settings",
      });

      expect(secondId).toBe(firstId);
    });
  });

  // -------------------------------------------------------------------------
  // addTab — maxInstances constraint
  // -------------------------------------------------------------------------
  describe("addTab - maxInstances constraint", () => {
    it("when maxInstances=1 and one tab exists for that routeId, activates existing (no new tab)", () => {
      RouteRegistry.register([
        makeRoute({
          id: "editor",
          name: "Editor",
          path: "/editor",
          tabConfig: { maxInstances: 1 },
        }),
      ]);

      useTabStore.getState().addTab({
        routeId: "editor",
        path: "/editor",
        title: "Editor",
        instanceId: "inst-1",
      });
      useTabStore.getState().addTab({
        routeId: "editor",
        path: "/editor",
        title: "Editor",
        instanceId: "inst-2",
      });

      expect(useTabStore.getState().tabs).toHaveLength(1);
    });

    it("when maxInstances=2, allows a second instance", () => {
      RouteRegistry.register([
        makeRoute({
          id: "editor",
          name: "Editor",
          path: "/editor",
          tabConfig: { maxInstances: 2 },
        }),
      ]);

      useTabStore.getState().addTab({
        routeId: "editor",
        path: "/editor/1",
        title: "Editor 1",
        instanceId: "inst-1",
      });
      useTabStore.getState().addTab({
        routeId: "editor",
        path: "/editor/2",
        title: "Editor 2",
        instanceId: "inst-2",
      });

      expect(useTabStore.getState().tabs).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // addTab — duplicate by path + instanceId
  // -------------------------------------------------------------------------
  describe("addTab - duplicate by path+instanceId", () => {
    it("adding same path+instanceId twice → activates existing, no duplicate", () => {
      useTabStore.getState().addTab({
        routeId: "r1",
        path: "/doc",
        title: "Doc",
        instanceId: "abc",
      });
      useTabStore.getState().addTab({
        routeId: "r1",
        path: "/doc",
        title: "Doc",
        instanceId: "abc",
      });

      expect(useTabStore.getState().tabs).toHaveLength(1);
    });

    it("same path with different instanceId → creates new tab", () => {
      useTabStore.getState().addTab({
        routeId: "r1",
        path: "/doc",
        title: "Doc",
        instanceId: "abc",
      });
      useTabStore.getState().addTab({
        routeId: "r1",
        path: "/doc",
        title: "Doc",
        instanceId: "xyz",
      });

      expect(useTabStore.getState().tabs).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // addTab — LRU eviction
  // -------------------------------------------------------------------------
  describe("addTab - LRU eviction", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterAll(() => {
      vi.useRealTimers();
    });

    it("when MAX_OPEN_TABS is reached, evicts oldest unpinned non-active tab", () => {
      // Fill up to MAX_OPEN_TABS, each at a different timestamp
      for (let i = 0; i < TABS_CONFIG.MAX_OPEN_TABS; i++) {
        vi.advanceTimersByTime(10);
        useTabStore.getState().addTab({
          routeId: `route-${i}`,
          path: `/path/${i}`,
          title: `Tab ${i}`,
        });
      }

      // At this point we have exactly MAX_OPEN_TABS tabs
      expect(useTabStore.getState().tabs).toHaveLength(TABS_CONFIG.MAX_OPEN_TABS);

      // The active tab is the last one added (index MAX_OPEN_TABS - 1).
      // The oldest unpinned non-active tab should be evicted when we add one more.
      const oldestPath = useTabStore.getState().tabs[0].path;

      vi.advanceTimersByTime(10);
      useTabStore.getState().addTab({
        routeId: "route-new",
        path: "/path/new",
        title: "New Tab",
      });

      const { tabs } = useTabStore.getState();
      // Still capped at MAX_OPEN_TABS
      expect(tabs).toHaveLength(TABS_CONFIG.MAX_OPEN_TABS);
      // The oldest tab was evicted
      expect(tabs.some((t) => t.path === oldestPath)).toBe(false);
      // The new tab is present
      expect(tabs.some((t) => t.path === "/path/new")).toBe(true);
    });

    it("pinned tabs are NOT evicted by LRU", () => {
      // Add first tab and pin it
      vi.advanceTimersByTime(10);
      useTabStore.getState().addTab({
        routeId: "pinned-route",
        path: "/pinned",
        title: "Pinned",
      });
      const pinnedTabId = useTabStore.getState().tabs[0].id;
      useTabStore.getState().pinTab(pinnedTabId);

      // Fill the rest of the slots
      for (let i = 1; i < TABS_CONFIG.MAX_OPEN_TABS; i++) {
        vi.advanceTimersByTime(10);
        useTabStore.getState().addTab({
          routeId: `route-${i}`,
          path: `/path/${i}`,
          title: `Tab ${i}`,
        });
      }

      expect(useTabStore.getState().tabs).toHaveLength(TABS_CONFIG.MAX_OPEN_TABS);

      // Now add one more — LRU should evict the oldest unpinned tab, not the pinned one
      vi.advanceTimersByTime(10);
      useTabStore.getState().addTab({
        routeId: "route-extra",
        path: "/path/extra",
        title: "Extra Tab",
      });

      const { tabs } = useTabStore.getState();
      expect(tabs).toHaveLength(TABS_CONFIG.MAX_OPEN_TABS);
      // Pinned tab must still be there
      expect(tabs.some((t) => t.path === "/pinned")).toBe(true);
    });

    it("active tab is NOT evicted by LRU (evicts next oldest)", () => {
      // Add MAX_OPEN_TABS tabs; the last one added will be the active tab
      for (let i = 0; i < TABS_CONFIG.MAX_OPEN_TABS; i++) {
        vi.advanceTimersByTime(10);
        useTabStore.getState().addTab({
          routeId: `route-${i}`,
          path: `/path/${i}`,
          title: `Tab ${i}`,
        });
      }

      // The oldest tab (index 0) is normally the LRU candidate.
      // Manually activate it to protect it from eviction.
      const oldestTabId = useTabStore.getState().tabs[0].id;
      const oldestTabPath = useTabStore.getState().tabs[0].path;
      vi.advanceTimersByTime(10);
      useTabStore.getState().setActiveTab(oldestTabId);

      // Now index 1 is the new oldest unpinned non-active tab
      const secondOldestPath = useTabStore.getState().tabs[1].path;

      // Adding one more tab should evict index 1 (the new oldest), not index 0 (the active)
      vi.advanceTimersByTime(10);
      useTabStore.getState().addTab({
        routeId: "route-new",
        path: "/path/new",
        title: "New Tab",
      });

      const { tabs } = useTabStore.getState();
      // Still capped at MAX_OPEN_TABS
      expect(tabs).toHaveLength(TABS_CONFIG.MAX_OPEN_TABS);
      // The active-at-eviction-time tab (oldest) was NOT evicted
      expect(tabs.some((t) => t.path === oldestTabPath)).toBe(true);
      // The second-oldest was evicted instead
      expect(tabs.some((t) => t.path === secondOldestPath)).toBe(false);
      // The new tab is present
      expect(tabs.some((t) => t.path === "/path/new")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // addTab — closable flag
  // -------------------------------------------------------------------------
  describe("addTab - closable", () => {
    it("tab created from route with tabConfig.closable=false has isClosable=false", () => {
      RouteRegistry.register([
        makeRoute({
          id: "locked",
          name: "Locked",
          path: "/locked",
          tabConfig: { closable: false },
        }),
      ]);

      useTabStore.getState().addTab({ routeId: "locked", path: "/locked", title: "Locked" });

      const tab = useTabStore.getState().tabs[0];
      expect(tab.isClosable).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // removeTab
  // -------------------------------------------------------------------------
  describe("removeTab", () => {
    it("removes an existing tab", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });

      const tabToRemove = useTabStore.getState().tabs[0];
      useTabStore.getState().removeTab(tabToRemove.id);

      const { tabs } = useTabStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs.some((t) => t.path === "/a")).toBe(false);
    });

    it("does NOT remove the last remaining tab (keeps it)", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });

      const tabId = useTabStore.getState().tabs[0].id;
      useTabStore.getState().removeTab(tabId);

      expect(useTabStore.getState().tabs).toHaveLength(1);
    });

    it("does NOT remove a pinned tab", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });

      const pinnedTabId = useTabStore.getState().tabs[0].id;
      useTabStore.getState().pinTab(pinnedTabId);
      useTabStore.getState().removeTab(pinnedTabId);

      const { tabs } = useTabStore.getState();
      expect(tabs.some((t) => t.id === pinnedTabId)).toBe(true);
    });

    it("does NOT remove a tab with isClosable=false", () => {
      RouteRegistry.register([
        makeRoute({
          id: "locked",
          name: "Locked",
          path: "/locked",
          tabConfig: { closable: false },
        }),
      ]);

      useTabStore.getState().addTab({ routeId: "locked", path: "/locked", title: "Locked" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });

      const lockedTabId = useTabStore.getState().tabs[0].id;
      useTabStore.getState().removeTab(lockedTabId);

      const { tabs } = useTabStore.getState();
      expect(tabs.some((t) => t.id === lockedTabId)).toBe(true);
    });

    it("when removing active tab, activates adjacent tab (next, or prev if last)", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });
      useTabStore.getState().addTab({ routeId: "r3", path: "/c", title: "C" });

      const { tabs } = useTabStore.getState();
      const lastTabId = tabs[2].id;
      const secondTabId = tabs[1].id;

      // Activate the last tab, then remove it — should activate the previous one
      useTabStore.getState().setActiveTab(lastTabId);
      useTabStore.getState().removeTab(lastTabId);

      expect(useTabStore.getState().activeTabId).toBe(secondTabId);
    });
  });

  // -------------------------------------------------------------------------
  // setActiveTab
  // -------------------------------------------------------------------------
  describe("setActiveTab", () => {
    it("sets activeTabId to the given tab", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });

      const firstTabId = useTabStore.getState().tabs[0].id;
      useTabStore.getState().setActiveTab(firstTabId);

      expect(useTabStore.getState().activeTabId).toBe(firstTabId);
    });

    it("tracks activation time for LRU without replacing the tabs array", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      const tabId = useTabStore.getState().tabs[0].id;
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });
      const tabsBefore = useTabStore.getState().tabs;

      vi.setSystemTime(5000);
      useTabStore.getState().setActiveTab(tabId);

      expect(useTabStore.getState().lastActivatedAt[tabId]).toBe(5000);
      // Same array: `tabs` subscribers (explorer, toolbars) don't re-render on a switch.
      expect(useTabStore.getState().tabs).toBe(tabsBefore);

      vi.useRealTimers();
    });

    it("does nothing for non-existent tabId", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      const existingActiveId = useTabStore.getState().activeTabId;

      useTabStore.getState().setActiveTab("non-existent-id");

      expect(useTabStore.getState().activeTabId).toBe(existingActiveId);
    });
  });

  // -------------------------------------------------------------------------
  // updateTab
  // -------------------------------------------------------------------------
  describe("updateTab", () => {
    it("updates specified fields of a tab", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "Original" });
      const tabId = useTabStore.getState().tabs[0].id;

      useTabStore.getState().updateTab(tabId, { title: "Updated", scrollPosition: 42 });

      const tab = useTabStore.getState().tabs[0];
      expect(tab.title).toBe("Updated");
      expect(tab.scrollPosition).toBe(42);
    });

    it("does not affect other tabs", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });

      const firstTabId = useTabStore.getState().tabs[0].id;
      useTabStore.getState().updateTab(firstTabId, { title: "A Updated" });

      const secondTab = useTabStore.getState().tabs[1];
      expect(secondTab.title).toBe("B");
      expect(secondTab.path).toBe("/b");
    });
  });

  // -------------------------------------------------------------------------
  // closeAllTabs
  // -------------------------------------------------------------------------
  describe("closeAllTabs", () => {
    it("keeps only pinned tabs (and sets first pinned as active)", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });
      useTabStore.getState().addTab({ routeId: "r3", path: "/c", title: "C" });

      const firstTabId = useTabStore.getState().tabs[0].id;
      useTabStore.getState().pinTab(firstTabId);

      useTabStore.getState().closeAllTabs();

      const { tabs, activeTabId } = useTabStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].isPinned).toBe(true);
      expect(activeTabId).toBe(firstTabId);
    });

    it("when no pinned tabs, keeps active tab only", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });
      useTabStore.getState().addTab({ routeId: "r3", path: "/c", title: "C" });

      // Active tab is the last one added ('/c')
      const activeId = useTabStore.getState().activeTabId!;

      useTabStore.getState().closeAllTabs();

      const { tabs, activeTabId } = useTabStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe(activeId);
      expect(activeTabId).toBe(activeId);
    });
  });

  // -------------------------------------------------------------------------
  // closeOtherTabs
  // -------------------------------------------------------------------------
  describe("closeOtherTabs", () => {
    it("keeps only the specified tab and pinned tabs", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });
      useTabStore.getState().addTab({ routeId: "r3", path: "/c", title: "C" });

      const [tabA, , tabC] = useTabStore.getState().tabs;
      useTabStore.getState().pinTab(tabA.id);

      useTabStore.getState().closeOtherTabs(tabC.id);

      const { tabs } = useTabStore.getState();
      // Should keep pinned tab A and the target tab C
      expect(tabs).toHaveLength(2);
      expect(tabs.some((t) => t.id === tabA.id)).toBe(true);
      expect(tabs.some((t) => t.id === tabC.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // closeTabsToRight
  // -------------------------------------------------------------------------
  describe("closeTabsToRight", () => {
    it("keeps tabs up to and including the specified tab index, plus pinned tabs", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });
      useTabStore.getState().addTab({ routeId: "r3", path: "/c", title: "C" });
      useTabStore.getState().addTab({ routeId: "r4", path: "/d", title: "D" });

      const [tabA, tabB, , tabD] = useTabStore.getState().tabs;

      // Pin tab D (rightmost) — it should be kept regardless
      useTabStore.getState().pinTab(tabD.id);

      // Close tabs to the right of B (should remove C, keep D because it's pinned)
      useTabStore.getState().closeTabsToRight(tabB.id);

      const { tabs } = useTabStore.getState();
      expect(tabs.some((t) => t.id === tabA.id)).toBe(true);
      expect(tabs.some((t) => t.id === tabB.id)).toBe(true);
      // C was to the right of B and not pinned → removed
      expect(tabs.some((t) => t.path === "/c")).toBe(false);
      // D is pinned → kept
      expect(tabs.some((t) => t.id === tabD.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // pinTab / unpinTab
  // -------------------------------------------------------------------------
  describe("pinTab / unpinTab", () => {
    it("pinTab sets isPinned=true and moves tab after last pinned tab", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });
      useTabStore.getState().addTab({ routeId: "r3", path: "/c", title: "C" });

      // Pin tab C (last one) — after pinning it should be at index 0 (no other pinned before it)
      const tabCId = useTabStore.getState().tabs[2].id;
      useTabStore.getState().pinTab(tabCId);

      const { tabs } = useTabStore.getState();
      const pinnedTab = tabs.find((t) => t.id === tabCId)!;
      expect(pinnedTab.isPinned).toBe(true);

      // It should now be placed at the front (after last pinned which is none → index 0)
      expect(tabs[0].id).toBe(tabCId);
    });

    it("unpinTab sets isPinned=false", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      const tabId = useTabStore.getState().tabs[0].id;

      useTabStore.getState().pinTab(tabId);
      expect(useTabStore.getState().tabs[0].isPinned).toBe(true);

      useTabStore.getState().unpinTab(tabId);
      const tab = useTabStore.getState().tabs.find((t) => t.id === tabId)!;
      expect(tab.isPinned).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // findTabByPath — instanceId disambiguation (W1: path collision regression)
  // -------------------------------------------------------------------------
  describe("findTabByPath", () => {
    it("returns the tab matching path + instanceId", () => {
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "A",
        instanceId: "/ws/a.excalidraw",
      });
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "B",
        instanceId: "/ws/b.excalidraw",
      });

      const found = useTabStore.getState().findTabByPath("/diagram", "/ws/b.excalidraw");

      expect(found).toBeDefined();
      expect(found!.title).toBe("B");
      expect(found!.instanceId).toBe("/ws/b.excalidraw");
    });

    it("returns undefined when instanceId does not match any tab", () => {
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "A",
        instanceId: "/ws/a.excalidraw",
      });

      const found = useTabStore.getState().findTabByPath("/diagram", "/ws/nonexistent.excalidraw");

      expect(found).toBeUndefined();
    });

    it("when two tabs share the same path, never confuses them by returning the wrong one", () => {
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "First",
        instanceId: "/ws/first.excalidraw",
      });
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "Second",
        instanceId: "/ws/second.excalidraw",
      });

      const first = useTabStore.getState().findTabByPath("/diagram", "/ws/first.excalidraw");
      const second = useTabStore.getState().findTabByPath("/diagram", "/ws/second.excalidraw");

      expect(first!.instanceId).toBe("/ws/first.excalidraw");
      expect(second!.instanceId).toBe("/ws/second.excalidraw");
      expect(first!.id).not.toBe(second!.id);
    });

    it("matches tab without instanceId when called with undefined", () => {
      useTabStore.getState().addTab({ routeId: "home", path: "/home", title: "Home" });

      const found = useTabStore.getState().findTabByPath("/home", undefined);

      expect(found).toBeDefined();
      expect(found!.path).toBe("/home");
      expect(found!.instanceId).toBeUndefined();
    });

    it("does NOT match an instanceId tab when called with undefined", () => {
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "A",
        instanceId: "/ws/a.excalidraw",
      });

      const found = useTabStore.getState().findTabByPath("/diagram", undefined);

      expect(found).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // updateTab — metadata.isDirty propagation (W2: dirty dot regression)
  // -------------------------------------------------------------------------
  describe("updateTab - metadata.isDirty", () => {
    it("sets metadata.isDirty to true without mutating the title", () => {
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "file.excalidraw",
        instanceId: "/ws/file.excalidraw",
      });
      const tabId = useTabStore.getState().tabs[0].id;

      useTabStore.getState().updateTab(tabId, { metadata: { isDirty: true } });

      const tab = useTabStore.getState().tabs[0];
      expect(tab.metadata?.isDirty).toBe(true);
      expect(tab.title).toBe("file.excalidraw");
      expect(tab.title).not.toContain("•");
    });

    it("clears metadata.isDirty back to false (simulates autosave)", () => {
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "file.excalidraw",
        instanceId: "/ws/file.excalidraw",
      });
      const tabId = useTabStore.getState().tabs[0].id;

      useTabStore.getState().updateTab(tabId, { metadata: { isDirty: true } });
      useTabStore.getState().updateTab(tabId, { metadata: { isDirty: false } });

      expect(useTabStore.getState().tabs[0].metadata?.isDirty).toBe(false);
    });

    it("isDirty on one tab does not affect sibling tabs", () => {
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "A",
        instanceId: "/ws/a.excalidraw",
      });
      useTabStore.getState().addTab({
        routeId: "diagram",
        path: "/diagram",
        title: "B",
        instanceId: "/ws/b.excalidraw",
      });

      const tabAId = useTabStore.getState().tabs[0].id;
      useTabStore.getState().updateTab(tabAId, { metadata: { isDirty: true } });

      const tabB = useTabStore.getState().tabs[1];
      expect(tabB.metadata?.isDirty).toBeFalsy();
      expect(tabB.title).toBe("B");
    });
  });

  // -------------------------------------------------------------------------
  // BONUS: reorderTabs
  // -------------------------------------------------------------------------
  describe("reorderTabs", () => {
    it("moves tab from fromIndex to toIndex", () => {
      useTabStore.getState().addTab({ routeId: "r1", path: "/a", title: "A" });
      useTabStore.getState().addTab({ routeId: "r2", path: "/b", title: "B" });
      useTabStore.getState().addTab({ routeId: "r3", path: "/c", title: "C" });

      // Move tab at index 0 (A) to index 2 → order should be [B, C, A]
      useTabStore.getState().reorderTabs(0, 2);

      const { tabs } = useTabStore.getState();
      expect(tabs[0].path).toBe("/b");
      expect(tabs[1].path).toBe("/c");
      expect(tabs[2].path).toBe("/a");
    });
  });

  describe("preview tabs", () => {
    const open = (file: string, preview = true) =>
      useTabStore.getState().addTab({
        routeId: "doc",
        path: "/doc",
        title: file,
        instanceId: `/ws/${file}`,
        metadata: { filePath: `/ws/${file}` },
        preview,
      });
    const titles = () =>
      useTabStore.getState().tabs.map((tab) => `${tab.title}${tab.isPreview ? "*" : ""}`);

    it("replaces the current preview tab in place instead of piling tabs up", () => {
      open("kept.md", false);
      open("a.md");
      open("last.md", false);
      expect(titles()).toEqual(["kept.md", "a.md*", "last.md"]);

      const b = open("b.md");
      expect(titles()).toEqual(["kept.md", "b.md*", "last.md"]);
      expect(useTabStore.getState().activeTabId).toBe(b);
    });

    it("keeps a preview tab once it is edited, pinned, moved or reordered", () => {
      const edited = open("edited.md");
      useTabStore.getState().updateTab(edited, { metadata: { isDirty: true } });
      expect(useTabStore.getState().getTab(edited)?.isPreview).toBeUndefined();

      const pinned = open("pinned.md");
      useTabStore.getState().pinTab(pinned);
      const moved = open("moved.md");
      useTabStore.getState().moveTabToGroup(moved, "secondary");
      const reordered = open("reordered.md");
      useTabStore.getState().reorderTabs(
        useTabStore.getState().tabs.findIndex((tab) => tab.id === reordered),
        0
      );

      expect(useTabStore.getState().tabs.every((tab) => !tab.isPreview)).toBe(true);
      expect(titles()).toHaveLength(4);
    });

    it("never replaces a preview tab with unsaved changes", () => {
      const dirty = open("dirty.md");
      // Metadata set directly (not through updateTab) to model a stale flag.
      useTabStore.setState({
        tabs: useTabStore
          .getState()
          .tabs.map((tab) => (tab.id === dirty ? { ...tab, metadata: { isDirty: true } } : tab)),
      });
      open("next.md");
      expect(titles()).toEqual(["dirty.md*", "next.md*"]);
    });

    it("turns a preview into a normal tab when the file is opened for real", () => {
      const tab = open("doc.md");
      expect(open("doc.md", false)).toBe(tab);
      expect(useTabStore.getState().getTab(tab)?.isPreview).toBeUndefined();

      const other = open("other.md");
      useTabStore.getState().keepTab(other);
      open("third.md");
      expect(titles()).toEqual(["doc.md", "other.md", "third.md*"]);
    });

    it("only replaces previews within the same editor group", () => {
      open("left.md");
      useTabStore.getState().addTab({
        routeId: "doc",
        path: "/doc",
        title: "right.md",
        instanceId: "/ws/right.md",
        groupId: "secondary",
        preview: true,
      });
      expect(titles()).toEqual(["left.md*", "right.md*"]);
    });
  });
});
